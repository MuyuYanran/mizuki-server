/**
 * [阶段 P2] infra/backup/backup.service — 唯一备份实现
 * [职责] pre_write / manual / db 三种备份 + manifest（原路径 + sha256）+ 恢复
 *   + pre_write 保留策略（每文件最近 10 份）+ backup.completed 事件发射。
 *   本服务是全项目唯一的备份实现：P3 写管线 pre_write、P5/P7 文件写入
 *   一律调用它，不得另写备份逻辑（MASTER-PLAN §2 决策 6）。
 * [状态] ACTIVE
 *
 * 约定：
 *   - 备份目录：`<backupDir>/<时间戳-nanoid>/`，产物按相对路径镜像存放；
 *   - manifest.files[].path：文件备份为相对 Mizuki 根的 POSIX 风格相对路径，
 *     db 备份为数据库文件绝对路径（恢复时按 scope 分派）；
 *   - 所有涉及 Mizuki 根的路径解析一律经 safeJoin（P1 路径监狱）；
 *   - 备份成功出口恰好一次发射 backup.completed（payload 先过 zod parse）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { nanoid } from 'nanoid';
import { asc, desc, eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { BackupCompletedPayload, EVENTS } from '@mizuki/shared';
import { logger } from '../../common/logger';
import { ForbiddenPathError, safeJoin } from '../../common/security/safe-join';
import { type DrizzleDb, DRIZZLE_DB, SQLITE_CONNECTION } from '../db/db.module';
import { backupRecord } from '../db/schema';

/** BackupService 配置注入 token（infra/backup/backup.module.ts 提供，测试可 override） */
export const BACKUP_OPTIONS = Symbol('BACKUP_OPTIONS');

export interface BackupOptions {
  /** Mizuki 项目根（未初始化为空串） */
  mizukiRoot: string;
  /** 备份根目录（绝对路径，子目录名形如 20260826T120000000-<nanoid>） */
  backupDir: string;
  /** 服务端 SQLite 数据库文件绝对路径（db 备份 / 恢复目标） */
  dbPath: string;
}

/** REST 层备份范围（与记录层 scope 的映射见 manualBackup / dbBackup） */
export type RestBackupScope = 'full' | 'data' | 'content' | 'db';

/** 对外备份记录信息 */
export interface BackupRecordInfo {
  id: string;
  scope: string;
  fileCount: number;
  sizeBytes: number;
  note: string | null;
  createdAt: string;
  manifestPath: string;
}

/** manifest.json 结构（zod 校验，篡改/损坏 → 400） */
const ManifestSchema = z.object({
  id: z.string(),
  scope: z.string(),
  createdAt: z.string(),
  fileCount: z.number(),
  sizeBytes: z.number(),
  note: z.string().optional(),
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
});
type Manifest = z.infer<typeof ManifestSchema>;

/** pre_write 每文件保留份数（MASTER-PLAN §7） */
const PRE_WRITE_KEEP = 10;

@Injectable()
export class BackupService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(SQLITE_CONNECTION) private readonly sqlite: Database.Database,
    private readonly emitter: EventEmitter2,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── 公开 API ──

  /**
   * pre_write 备份：写管线前置快照，只备单个目标文件。
   * @param targetAbsPath 目标文件绝对路径（须位于 mizukiRoot 内，经 safeJoin 校验）
   * @returns 备份记录；目标文件不存在时返回 undefined（无物可备）
   */
  async preWriteBackup(targetAbsPath: string, note?: string): Promise<BackupRecordInfo | undefined> {
    const rel = path.relative(this.requireMizukiRoot(), path.resolve(targetAbsPath));
    const verified = this.joinWithinRoot(rel); // 越界 → ForbiddenException
    if (!fs.existsSync(verified)) {
      logger.info({ target: targetAbsPath }, 'pre_write：目标文件不存在，跳过备份');
      return undefined;
    }
    return this.createFileBackup('pre_write', [{ abs: verified, rel: toPosix(rel) }], note);
  }

  /**
   * manual 备份（REST 触发）。REST scope → 记录层 scope：
   * full/data/content → 'manual'；db 走 dbBackup()。
   */
  async manualBackup(restScope: Exclude<RestBackupScope, 'db'>, note?: string): Promise<BackupRecordInfo> {
    const sources = this.collectSources(restScope);
    return this.createFileBackup('manual', sources, note);
  }

  /** db 备份：better-sqlite3 `.backup()` API（禁止直接复制写入中的 db 文件） */
  async dbBackup(note?: string): Promise<BackupRecordInfo> {
    const dirName = `${formatTimestamp(new Date())}-${nanoid(8)}`;
    const backupDir = path.join(this.options.backupDir, dirName);
    fs.mkdirSync(backupDir, { recursive: true });
    const product = path.join(backupDir, path.basename(this.options.dbPath));
    await this.sqlite.backup(product);

    const sha256 = sha256File(product);
    const sizeBytes = fs.statSync(product).size;
    const id = nanoid();
    const manifest: Manifest = {
      id,
      scope: 'db',
      createdAt: new Date().toISOString(),
      fileCount: 1,
      sizeBytes,
      note,
      files: [{ path: this.options.dbPath, sha256 }],
    };
    const manifestPath = path.join(backupDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const info = await this.insertRecord(id, 'db', manifestPath, manifest);
    logger.info({ id, scope: 'db', fileCount: 1 }, '备份创建完成');
    this.emitCompleted(info);
    return info;
  }

  /**
   * 恢复（MASTER-PLAN §7）：
   * 1. 恢复前先对当前状态做一次备份（可回滚保证）；
   * 2. 校验 manifest 完整性（逐文件 sha256 比对）；
   * 3. 文件按原路径原子回写（临时文件 + rename）；db 用 `.backup()` 逆向；
   * 4. 目标路径经 safeJoin 校验。
   */
  async restore(backupId: string): Promise<{ id: string; restoredFiles: number; safetyBackupId?: string }> {
    const record = await this.getRecordOrThrow(backupId);
    const manifest = this.readManifestOrThrow(record.manifestPath);
    logger.info({ backupId, scope: record.scope }, '恢复开始');

    // 1. 恢复前快照（当前状态，保证可回滚）
    let safetyBackupId: string | undefined;
    let safetyInfo: BackupRecordInfo | undefined;
    if (record.scope === 'db') {
      safetyInfo = await this.dbBackup('恢复前快照（db）');
      safetyBackupId = safetyInfo.id;
    } else {
      const existing = manifest.files
        .map((entry) => ({ entry, abs: this.tryJoinWithinRoot(entry.path) }))
        .filter((item) => item.abs !== null && fs.existsSync(item.abs))
        .map((item) => ({ abs: item.abs as string, rel: item.entry.path }));
      if (existing.length > 0) {
        safetyInfo = await this.createFileBackup('manual', existing, '恢复前快照');
        safetyBackupId = safetyInfo.id;
      }
    }

    // 2. 完整性校验（逐文件 sha256）
    const backupRoot = path.dirname(record.manifestPath);
    for (const entry of manifest.files) {
      const product = this.productPath(backupRoot, record.scope, entry.path);
      if (!fs.existsSync(product)) {
        throw new BadRequestException(`备份产物缺失：${entry.path}`);
      }
      if (sha256File(product) !== entry.sha256) {
        throw new BadRequestException(`备份产物校验失败（sha256 不一致）：${entry.path}`);
      }
    }

    // 3. 回写
    if (record.scope === 'db') {
      // .backup() 逆向：以备份产物为源，写回现场 db 文件路径
      // （better-sqlite3 的 backup 目标只接受文件路径；写回时活动连接须处于空闲）
      const product = this.productPath(backupRoot, record.scope, manifest.files[0]?.path ?? '');
      const source = new Database(product);
      try {
        await source.backup(this.options.dbPath);
      } finally {
        source.close();
      }
      // db 文件已整体回滚到备份时刻：备份时刻之后写入的记录行（恢复前快照记录、
      // 以及被恢复备份自身的记录）随旧文件内容丢失——重新登记（磁盘产物仍在）。
      const restoredSelf = await this.listBackups();
      if (!restoredSelf.some((r) => r.id === backupId)) {
        await this.reinsertRecord({
          id: record.id,
          scope: record.scope,
          manifestPath: record.manifestPath,
          fileCount: manifest.fileCount,
          sizeBytes: manifest.sizeBytes,
          note: manifest.note ?? null,
          createdAt: manifest.createdAt,
        });
      }
      if (safetyInfo && !(await this.listBackups()).some((r) => r.id === safetyInfo.id)) {
        await this.reinsertRecord(safetyInfo);
      }
    } else {
      for (const entry of manifest.files) {
        const target = this.joinWithinRoot(entry.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const product = this.productPath(backupRoot, record.scope, entry.path);
        const tmp = path.join(path.dirname(target), `.restore-${nanoid(8)}`);
        fs.copyFileSync(product, tmp);
        fs.renameSync(tmp, target); // 原子覆盖
      }
    }

    logger.info({ backupId, files: manifest.files.length }, '恢复完成');
    return { id: backupId, restoredFiles: manifest.files.length, safetyBackupId };
  }

  /** 删除备份（目录 + backup_record 行） */
  async deleteBackup(backupId: string): Promise<void> {
    const record = await this.getRecordOrThrow(backupId);
    fs.rmSync(path.dirname(record.manifestPath), { recursive: true, force: true });
    await this.db.delete(backupRecord).where(eq(backupRecord.id, backupId));
    logger.info({ backupId }, '备份已删除');
  }

  /** 备份列表（新 → 旧） */
  async listBackups(): Promise<BackupRecordInfo[]> {
    const rows = await this.db.select().from(backupRecord).orderBy(desc(backupRecord.createdAt));
    return rows.map(rowToInfo);
  }

  // ── 内部实现 ──

  /**
   * manifest 条目 → 备份产物路径。
   * 文件备份：产物按相对路径镜像存放；db 备份：manifest 记录 db 绝对原路径，
   * 产物文件名为其 basename。
   */
  private productPath(backupRoot: string, scope: string, entryPath: string): string {
    if (scope === 'db') {
      return path.join(backupRoot, path.basename(this.options.dbPath));
    }
    return path.join(backupRoot, entryPath);
  }

  private requireMizukiRoot(): string {
    if (this.options.mizukiRoot === '') {
      throw new BadRequestException('Mizuki 项目根目录未配置，无法创建文件备份（请先完成初始化）');
    }
    return path.resolve(this.options.mizukiRoot);
  }

  /** safeJoin 包装：越界抛 ForbiddenException（REST 层 403） */
  private joinWithinRoot(rel: string): string {
    try {
      return safeJoin(this.requireMizukiRoot(), rel);
    } catch (error) {
      if (error instanceof ForbiddenPathError) {
        throw new ForbiddenException(`路径越界，已拒绝：${rel}`);
      }
      throw error;
    }
  }

  /** 同上，但不抛错：路径非法时返回 null（用于恢复前快照的现存文件收集） */
  private tryJoinWithinRoot(rel: string): string | null {
    try {
      return safeJoin(this.requireMizukiRoot(), rel);
    } catch {
      return null;
    }
  }

  /** 收集 REST scope 对应的源文件（相对 Mizuki 根，POSIX 风格） */
  private collectSources(restScope: Exclude<RestBackupScope, 'db'>): { abs: string; rel: string }[] {
    const root = this.requireMizukiRoot();
    const rels = new Set<string>();
    const dataDir = path.join(root, 'src', 'data');
    if (restScope === 'full' || restScope === 'data') {
      // data：仅 src/data/*.ts 数据文件
      if (fs.existsSync(dataDir)) {
        for (const name of fs.readdirSync(dataDir)) {
          if (name.endsWith('.ts') && fs.statSync(path.join(dataDir, name)).isFile()) {
            rels.add(toPosix(path.join('src', 'data', name)));
          }
        }
      }
    }
    if (restScope === 'full' || restScope === 'content') {
      // content：src/content/ 递归
      const contentDir = path.join(root, 'src', 'content');
      if (fs.existsSync(contentDir)) {
        this.walkFiles(contentDir, path.join('src', 'content'), rels);
      }
    }
    return [...rels].map((rel) => ({ abs: this.joinWithinRoot(rel), rel }));
  }

  /** 递归收集目录下全部文件（rel 相对路径，POSIX 风格） */
  private walkFiles(absDir: string, relDir: string, out: Set<string>): void {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = toPosix(path.join(relDir, entry.name));
      if (entry.isDirectory()) {
        this.walkFiles(abs, rel, out);
      } else if (entry.isFile()) {
        out.add(rel);
      }
    }
  }

  /** 文件备份核心：镜像复制 + manifest + 记录 + 事件 +（pre_write）保留策略 */
  private async createFileBackup(
    scope: 'pre_write' | 'manual',
    sources: { abs: string; rel: string }[],
    note?: string,
  ): Promise<BackupRecordInfo> {
    const dirName = `${formatTimestamp(new Date())}-${nanoid(8)}`;
    const backupDir = path.join(this.options.backupDir, dirName);
    fs.mkdirSync(backupDir, { recursive: true });

    const files: { path: string; sha256: string }[] = [];
    let sizeBytes = 0;
    for (const source of sources) {
      if (!fs.existsSync(source.abs)) {
        continue; // 源缺失（如尚未建过的新文件）跳过
      }
      const product = path.join(backupDir, ...source.rel.split('/'));
      fs.mkdirSync(path.dirname(product), { recursive: true });
      fs.copyFileSync(source.abs, product);
      files.push({ path: source.rel, sha256: sha256File(product) });
      sizeBytes += fs.statSync(product).size;
    }

    const id = nanoid();
    const manifest: Manifest = {
      id,
      scope,
      createdAt: new Date().toISOString(),
      fileCount: files.length,
      sizeBytes,
      note,
      files,
    };
    const manifestPath = path.join(backupDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const info = await this.insertRecord(id, scope, manifestPath, manifest);
    logger.info({ id, scope, fileCount: files.length }, '备份创建完成');
    this.emitCompleted(info);

    if (scope === 'pre_write') {
      await this.enforcePreWriteRetention();
    }
    return info;
  }

  /** pre_write 保留策略：同一原路径只保留最近 PRE_WRITE_KEEP 份（含目录与记录清理） */
  private async enforcePreWriteRetention(): Promise<void> {
    const rows = await this.db
      .select()
      .from(backupRecord)
      .where(eq(backupRecord.scope, 'pre_write'))
      .orderBy(asc(backupRecord.createdAt));
    const groups = new Map<string, { id: string; manifestPath: string }[]>();
    for (const row of rows) {
      const manifest = this.tryReadManifest(row.manifestPath);
      const key = manifest?.files[0]?.path ?? `__missing__:${row.id}`;
      const list = groups.get(key) ?? [];
      list.push({ id: row.id, manifestPath: row.manifestPath });
      groups.set(key, list);
    }
    for (const [key, list] of groups) {
      if (key.startsWith('__missing__:') || list.length <= PRE_WRITE_KEEP) {
        continue;
      }
      const excess = list.slice(0, list.length - PRE_WRITE_KEEP);
      for (const item of excess) {
        fs.rmSync(path.dirname(item.manifestPath), { recursive: true, force: true });
        await this.db.delete(backupRecord).where(eq(backupRecord.id, item.id));
        logger.info({ id: item.id, path: key }, '保留策略清理：pre_write 备份超出上限，删除最旧');
      }
    }
  }

  private async insertRecord(
    id: string,
    scope: string,
    manifestPath: string,
    manifest: Manifest,
  ): Promise<BackupRecordInfo> {
    await this.db.insert(backupRecord).values({
      id,
      scope,
      manifestPath,
      fileCount: manifest.fileCount,
      sizeBytes: manifest.sizeBytes,
      note: manifest.note ?? null,
      createdAt: new Date(manifest.createdAt),
    });
    return {
      id,
      scope,
      fileCount: manifest.fileCount,
      sizeBytes: manifest.sizeBytes,
      note: manifest.note ?? null,
      createdAt: manifest.createdAt,
      manifestPath,
    };
  }

  /** 备份成功出口：payload 先过 zod parse 再发射（恰好一次，失败不发） */
  private emitCompleted(info: BackupRecordInfo): void {
    const payload = BackupCompletedPayload.parse({ id: info.id, scope: info.scope, fileCount: info.fileCount });
    this.emitter.emit(EVENTS.BackupCompleted, payload);
  }

  /** 重新登记一条备份记录（db 恢复整体回滚 db 文件后，恢复后仍需可查的记录用它补录） */
  private async reinsertRecord(info: BackupRecordInfo): Promise<void> {
    await this.db
      .insert(backupRecord)
      .values({
        id: info.id,
        scope: info.scope,
        manifestPath: info.manifestPath,
        fileCount: info.fileCount,
        sizeBytes: info.sizeBytes,
        note: info.note,
        createdAt: new Date(info.createdAt),
      })
      .onConflictDoNothing();
  }

  private async getRecordOrThrow(backupId: string): Promise<{ id: string; scope: string; manifestPath: string }> {
    const rows = await this.db.select().from(backupRecord).where(eq(backupRecord.id, backupId));
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`备份不存在：${backupId}`);
    }
    return { id: row.id, scope: row.scope, manifestPath: row.manifestPath };
  }

  private readManifestOrThrow(manifestPath: string): Manifest {
    const manifest = this.tryReadManifest(manifestPath);
    if (!manifest) {
      throw new BadRequestException(`manifest 缺失或损坏：${manifestPath}`);
    }
    return manifest;
  }

  private tryReadManifest(manifestPath: string): Manifest | null {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const parsed = ManifestSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

// ── 纯工具 ──

/** sha256（hex） */
function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** 路径分隔符 → POSIX 风格（manifest 内统一） */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** 目录名时间戳：本地时间 YYYYMMDDTHHmmssSSS（字典序可排序） */
function formatTimestamp(date: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p2(date.getMonth() + 1)}${p2(date.getDate())}` +
    `T${p2(date.getHours())}${p2(date.getMinutes())}${p2(date.getSeconds())}` +
    `${String(date.getMilliseconds()).padStart(3, '0')}`
  );
}

/** 数据库行 → 对外信息 */
function rowToInfo(row: typeof backupRecord.$inferSelect): BackupRecordInfo {
  return {
    id: row.id,
    scope: row.scope,
    fileCount: row.fileCount,
    sizeBytes: row.sizeBytes,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    manifestPath: row.manifestPath,
  };
}
