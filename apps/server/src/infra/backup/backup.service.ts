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
 *   - manifest.files[].path：文件备份为**相对受管根**的 POSIX 风格相对路径，
 *     db 备份为数据库文件绝对路径（恢复时按 scope 分派）；
 *   - **受管根是闭集双根**（`theme` = mizukiRoot；`content` = 内容分离的本地持久内容仓根）：
 *     条目用可选 `root: 'theme' | 'content'` 标识；**缺省即 `theme`**（存量备份逐字节兼容）。
 *     归档布局：无标签 ⇒ `<rel>`（与历史一致）；有标签 ⇒ `<root>/<rel>`。
 *     详见 `common/fs/backup-roots.ts`（含「为何不放开任意绝对路径」的理由）。
 *   - 所有路径解析一律经 `resolveManifestEntryPath`（拒绝绝对路径与 `..`，拼后二次校验）；
 *   - **manifest 永不写入宿主机绝对路径**（仓规红线 6）；
 *   - 备份成功出口恰好一次发射 backup.completed（payload 先过 zod parse）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { nanoid } from 'nanoid';
import { asc, desc, eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { BackupCompletedPayload, EVENTS } from '@mizuki/shared';
import { sha256File } from '../../common/crypto/hash';
// [跨根备份] 受管根闭集（theme / content）+ manifest 条目落点解析（L0 单源）
import {
  type BackupRootTag,
  type ManagedRoots,
  type ManifestPathFailure,
  archiveSubPath,
  classifyManagedTarget,
  resolveManagedRoots,
  resolveManifestEntryPath,
} from '../../common/fs/backup-roots';
import { atomicReplace, tempPathFor } from '../../common/fs/atomic-write';
import { requireMizukiRoot, toMizukiAbs } from '../../common/fs/mizuki-root';
import { toPosixPath } from '../../common/fs/posix';
import { logger } from '../../common/logger';
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

/**
 * manifest.json 结构（zod 校验，篡改/损坏 → 400）
 *
 * [跨根备份] `files[].root` 为**可选**新增字段（additive，向后兼容）：
 *   - 省略 / `'theme'` ⇒ 相对 Mizuki 根（**存量备份全是这种**，逐字节原样可读可恢复）；
 *   - `'content'`     ⇒ 相对内容分离的本地持久内容仓根。
 * 只存**根标签 + 相对路径**，绝不存宿主机绝对路径（红线 6）。
 */
const ManifestSchema = z.object({
  id: z.string(),
  scope: z.string(),
  createdAt: z.string(),
  fileCount: z.number(),
  sizeBytes: z.number(),
  note: z.string().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      sha256: z.string(),
      root: z.enum(['theme', 'content']).optional(),
    }),
  ),
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
   *
   * [跨根备份] 目标可以在**两个受管根**之一：
   *   - 主题根内（含其下的 `content/` 等路径）—— 旧行为逐字不变；
   *   - 内容分离的**本地持久内容仓根**内（可能在主题根之外）—— 新增能力，
   *     manifest 条目带 `root: 'content'`，归档落到 `content/<rel>` 子目录。
   * 其它位置 ⇒ **明确拒绝**（400 + 指路），不再静默跳过：写盘无备份是数据安全缺口，
   * 必须让调用方知道「这里备份不了」，而不是让用户以为有悔棋。
   *
   * @param targetAbsPath 目标文件绝对路径（必须落在某个受管根内）
   * @returns 备份记录；目标文件不存在时返回 undefined（无物可备）
   */
  async preWriteBackup(targetAbsPath: string, note?: string): Promise<BackupRecordInfo | undefined> {
    // [语义分轴·第一道] 主题根**未配置**是**配置问题** ⇒ 400 + 「未配置」文案
    // （与 manualBackup / 既有契约一致）。必须先判这一条：若先走分类，
    // 空主题根会让任何路径都落进「不在受管根内」，于是把配置问题误报成路径越界。
    this.requireMizukiRoot();

    const roots = resolveManagedRoots(this.options.mizukiRoot);
    const classified = classifyManagedTarget(roots, path.resolve(targetAbsPath));
    if (classified === null) {
      // [语义分轴·第二道] 根**已配置**但仍不在任何受管根内 = **路径越界** ⇒ 403，
      // 沿用既有契约（与 safeJoin 同码），不改成 400：403 表达「这里不许写」，
      // 400 会被误读成「请求体写错了」。
      logger.warn({ target: targetAbsPath }, 'pre_write：目标不在任何受管根内，拒绝备份');
      throw new ForbiddenException(
        '该路径不在任何受管根内，拒绝备份：可备份的位置只有主题根与（内容分离启用时的）本地内容仓根。下一步：确认主题根/内容仓配置正确，或把文件放到这两个目录之一。',
      );
    }
    const verified = resolveManifestEntryPath(roots, { root: classified.root, path: classified.rel });
    if (!verified.ok) {
      throw new ForbiddenException(`备份目标路径非法：${verified.reason}`);
    }
    if (!fs.existsSync(verified.abs)) {
      logger.info({ target: targetAbsPath }, 'pre_write：目标文件不存在，跳过备份');
      return undefined;
    }
    // [布局] 单条目备份只在**内容根**时打标签：
    //   纯 theme ⇒ 无标签 ⇒ 扁平布局，与存量 manifest 逐字节一致（向下兼容硬约束）；
    //   content ⇒ 打标签 ⇒ 归档落到 `content/` 子目录，恢复时据标签选根。
    return this.createFileBackup(
      'pre_write',
      [
        classified.root === 'content'
          ? { abs: verified.abs, rel: classified.rel, root: classified.root }
          : { abs: verified.abs, rel: classified.rel },
      ],
      note,
      roots,
    );
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

    // [跨根恢复] 先一次性解析当前受管根，并**在写盘前**校验全部目标可落
    // ——「恢复到一半才发现内容仓已切走」是最坏的失败方式（半成品现场）。
    const roots = resolveManagedRoots(this.options.mizukiRoot);
    if (record.scope !== 'db') {
      const blocker = this.findRestoreBlocker(roots, manifest.files);
      if (blocker !== null) {
        logger.warn({ backupId, reason: blocker.reason }, '恢复被拒绝：受管根不可用或清单被篡改');
        this.blockerToException(blocker);
      }
    }

    // 1. 恢复前快照（当前状态，保证可回滚）
    let safetyBackupId: string | undefined;
    let safetyInfo: BackupRecordInfo | undefined;
    if (record.scope === 'db') {
      safetyInfo = await this.dbBackup('恢复前快照（db）');
      safetyBackupId = safetyInfo.id;
    } else {
      const existing = manifest.files
        .map((entry) => {
          const resolved = resolveManifestEntryPath(roots, entry);
          return { entry, abs: resolved.ok ? resolved.abs : null };
        })
        .filter((item) => item.abs !== null && fs.existsSync(item.abs))
        .map((item) => ({
          abs: item.abs as string,
          rel: item.entry.path,
          root: item.entry.root,
        }));
      if (existing.length > 0) {
        safetyInfo = await this.createFileBackup('manual', existing, '恢复前快照', roots);
        safetyBackupId = safetyInfo.id;
      }
    }

    // 2. 完整性校验（逐文件 sha256）
    const backupRoot = path.dirname(record.manifestPath);
    for (const entry of manifest.files) {
      const product = this.productPath(backupRoot, record.scope, entry);
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
      const product = this.productPath(backupRoot, record.scope, manifest.files[0] ?? { path: '' });
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
        const resolved = resolveManifestEntryPath(roots, entry);
        if (!resolved.ok) {
          // 已在 findRestoreBlocker 前置拦过，这里是纵深防御（不可达）
          throw new BadRequestException(`恢复目标路径非法：${resolved.reason}`);
        }
        const target = resolved.abs;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const product = this.productPath(backupRoot, record.scope, entry);
        // 原子覆盖（单源）：临时文件与目标同目录 → rename 即原子提交
        const tmp = tempPathFor(target, '.restore-');
        fs.copyFileSync(product, tmp);
        atomicReplace(tmp, target);
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
  /**
   * [跨根恢复] 恢复前的**安全闸门**：逐条目解析当前落点，任一不可落即整批拒绝。
   *
   * 为什么必须整批、不能跳过个别条目：恢复是「把时间倒回去」的原子语义。
   * 若受管根已变（用户从 external 切回 local / 切到 git 源 / 内容仓目录被移走），
   * 悄悄跳过 content 条目会让用户以为「恢复成功了」，而实际上内容仓那部分根本没回来
   * —— 这比直接失败更危险。故一律 400 + 指路。
   *
   * @returns null ⇒ 全部可落；否则给出拒绝原因与文案（文案零绝对路径，红线 6）
   */
  private findRestoreBlocker(
    roots: ManagedRoots,
    files: { path: string; root?: BackupRootTag }[],
  ): { reason: ManifestPathFailure; message: string } | null {
    for (const entry of files) {
      const resolved = resolveManifestEntryPath(roots, entry);
      if (resolved.ok) continue;
      if (resolved.reason === 'content-root-unavailable') {
        return {
          reason: resolved.reason,
          message:
            '该备份包含内容仓文件，但当前配置下没有可用的本地内容仓根（可能已切回本地模式、切到 git 源，或内容仓目录不存在）：为避免把内容文件倾倒到主题代码仓，本次恢复被拒绝。下一步：先恢复「内容分离 + 本地 path 源」的配置并确认内容仓目录存在，然后重试。',
        };
      }
      if (resolved.reason === 'theme-root-uninitialized') {
        return {
          reason: resolved.reason,
          message: '主题根未初始化，无法恢复文件：请先完成初始化，或确认 config.json 里的主题根配置正确。',
        };
      }
      return {
        reason: resolved.reason,
        message: `备份清单里有非法路径条目（${entry.path}）：恢复被拒绝。下一步：该备份可能已损坏或被篡改，请从其他备份恢复。`,
      };
    }
    return null;
  }

  /**
   * [跨根恢复] 把 blocker 映射为 HTTP 异常。
   *
   * 语义分轴（两类失败**不可混同**）：
   *   - `rel-path-invalid` ⇒ **403 ForbiddenException**：manifest 里的 `..`/绝对路径是
   *     **路径篡改/越界**，与 `safeJoin` 的拒绝同源、同码（沿用既有安全契约，勿改成 400）；
   *   - 其余（受管根不可用 / 主题根未初始化）⇒ **400 BadRequestException**：这是
   *     **配置态问题**，用户改配置即可解决，文案必须带「下一步」指路。
   */
  private blockerToException(blocker: { reason: ManifestPathFailure; message: string }): never {
    if (blocker.reason === 'rel-path-invalid') {
      throw new ForbiddenException(blocker.message);
    }
    throw new BadRequestException(blocker.message);
  }

  private productPath(
    backupRoot: string,
    scope: string,
    entry: { path: string; root?: BackupRootTag },
  ): string {
    if (scope === 'db') {
      return path.join(backupRoot, path.basename(this.options.dbPath));
    }
    return path.join(backupRoot, ...archiveSubPath(entry).split('/'));
  }

  /** 未配置 root → 400（备份专属文案，逐字保留） */
  private requireMizukiRoot(): string {
    return requireMizukiRoot(this.options.mizukiRoot, {
      missingMessage: 'Mizuki 项目根目录未配置，无法创建文件备份（请先完成初始化）',
    });
  }

  /** safeJoin 包装：越界抛 ForbiddenException（REST 层 403）；单源见 common/fs/mizuki-root */
  private joinWithinRoot(rel: string): string {
    return toMizukiAbs(this.options.mizukiRoot, rel, {
      missingMessage: 'Mizuki 项目根目录未配置，无法创建文件备份（请先完成初始化）',
    });
  }

  /**
   * [跨根备份] 原先此处有 `tryJoinWithinRoot()`（单根、不抛错的 safeJoin 包装）。
   * 双根改造后「条目 → 落点」统一走 L0 的 `resolveManifestEntryPath()`（返回 Result 形态，
   * 天然带失败原因），该包装失去唯一调用点，已删除（勿复活：两套路径解析就是事故来源）。
   */

  /** 收集 REST scope 对应的源文件（相对 Mizuki 根，POSIX 风格） */
  private collectSources(restScope: Exclude<RestBackupScope, 'db'>): { abs: string; rel: string }[] {
    const root = this.requireMizukiRoot();
    const rels = new Set<string>();
    const dataDir = path.join(root, 'src', 'data');
    if (restScope === 'full' || restScope === 'data') {
      // data：src/data/*.ts 数据文件 + *.json（bilibili-data.json 番剧 API 缓存）。
      // [U3-D/DEF-03] 补 *.json：官方 special/08 的 BiliBili 模式缓存落 src/data/bilibili-data.json，
      // 此前只收 *.ts → data/full 备份双双漏收（恢复通道无需改动：manifest 按原路径回灌）。
      if (fs.existsSync(dataDir)) {
        for (const name of fs.readdirSync(dataDir)) {
          if (
            (name.endsWith('.ts') || name.endsWith('.json')) &&
            fs.statSync(path.join(dataDir, name)).isFile()
          ) {
            rels.add(toPosixPath(path.join('src', 'data', name)));
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
      const rel = toPosixPath(path.join(relDir, entry.name));
      if (entry.isDirectory()) {
        this.walkFiles(abs, rel, out);
      } else if (entry.isFile()) {
        out.add(rel);
      }
    }
  }

  /**
   * 文件备份核心：镜像复制 + manifest + 记录 + 事件 +（pre_write）保留策略
   *
   * [跨根备份] `sources[].root` 可选。**布局一致性铁律**（见 `archiveSubPath` 注释）：
   * 只要**任一**条目带 root 标签，就给**全部**条目打标签（无标签的补 `'theme'`），
   * 从而 `theme/<rel>` 与 `content/<rel>` 永不撞名；纯 theme 备份则一个标签都不打
   * —— 存量归档布局与 manifest 形状**逐字节不变**。
   */
  private async createFileBackup(
    scope: 'pre_write' | 'manual',
    sources: { abs: string; rel: string; root?: BackupRootTag }[],
    note?: string,
    roots?: ManagedRoots,
  ): Promise<BackupRecordInfo> {
    const dirName = `${formatTimestamp(new Date())}-${nanoid(8)}`;
    const backupDir = path.join(this.options.backupDir, dirName);
    fs.mkdirSync(backupDir, { recursive: true });

    const anyTagged = sources.some((source) => source.root !== undefined);
    const effectiveRoots: ManagedRoots = roots ?? resolveManagedRoots(this.options.mizukiRoot);

    const files: { path: string; sha256: string; root?: BackupRootTag }[] = [];
    let sizeBytes = 0;
    for (const source of sources) {
      if (!fs.existsSync(source.abs)) {
        continue; // 源缺失（如尚未建过的新文件）跳过
      }
      const tag: BackupRootTag | undefined = anyTagged ? (source.root ?? 'theme') : undefined;
      const subPath = archiveSubPath(
        tag === undefined ? { path: source.rel } : { root: tag, path: source.rel },
      );
      const product = path.join(backupDir, ...subPath.split('/'));
      fs.mkdirSync(path.dirname(product), { recursive: true });
      fs.copyFileSync(source.abs, product);
      files.push(
        tag === undefined
          ? { path: source.rel, sha256: sha256File(product) }
          : { path: source.rel, sha256: sha256File(product), root: tag },
      );
      sizeBytes += fs.statSync(product).size;
    }
    // effectiveRoots 目前仅用于将来扩展（如按根统计）；保留参数以免调用方反复解析
    void effectiveRoots;

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
      // [Wave-2/E1] 对外只给定位线索（备份目录绝对路径仅入日志）
      logger.warn({ manifestPath }, '备份 manifest 缺失或损坏');
      throw new BadRequestException(`manifest 缺失或损坏（备份目录：${path.basename(path.dirname(manifestPath))}）`);
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
