import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from '../../src/infra/db/migrate';
import * as schema from '../../src/infra/db/schema';
import { BackupService } from '../../src/infra/backup/backup.service';
import { BackupCompletedPayload, EVENTS } from '../../../../packages/shared/src/events';

/**
 * P2 §6.1–6.4 / §6.6 / §6.7 验收依据（全部在临时目录操作，不触碰真实 Mizuki 目录）：
 * 备份→篡改→恢复→哈希一致；保留策略 11→10；manifest 完整性；db 备份恢复 + 恢复前快照；
 * backup.completed 事件；路径逃逸拒绝。
 */

interface Harness {
  service: BackupService;
  mizukiRoot: string;
  backupDir: string;
  dbPath: string;
  sqlite: Database.Database;
  events: { id: string; scope: string; fileCount: number }[];
  tmp: string;
}

function createHarness(): Harness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p2-'));
  const mizukiRoot = path.join(tmp, 'mizuki');
  const backupDir = path.join(tmp, 'backups');
  fs.mkdirSync(path.join(mizukiRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(mizukiRoot, 'src', 'content', 'posts', 'hello'), { recursive: true });
  fs.writeFileSync(path.join(mizukiRoot, 'src', 'data', 'diary.ts'), 'export const diaryData = [1];\n');
  fs.writeFileSync(path.join(mizukiRoot, 'src', 'data', 'friends.ts'), 'export const friendsData = [];\n');
  fs.writeFileSync(
    path.join(mizukiRoot, 'src', 'content', 'posts', 'hello', 'index.md'),
    '---\ntitle: hello\n---\n\nworld\n',
  );

  const dbPath = path.join(tmp, 'mizuki.db');
  runMigrations(dbPath);
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  const emitter = new EventEmitter2();
  const events: { id: string; scope: string; fileCount: number }[] = [];
  emitter.on(EVENTS.BackupCompleted, (payload: unknown) => {
    events.push(BackupCompletedPayload.parse(payload));
  });
  const service = new BackupService(db, sqlite, emitter, { mizukiRoot, backupDir, dbPath });
  return { service, mizukiRoot, backupDir, dbPath, sqlite, events, tmp };
}

function cleanup(h: Harness): void {
  h.sqlite.close();
  fs.rmSync(h.tmp, { recursive: true, force: true });
}

function sha256(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

describe('P2 BackupService（唯一备份实现）', () => {
  let h: Harness;
  // 全量并行跑时 15+ worker 争抢磁盘，Windows 下 rmSync 清理可超 10s 默认钩子上限（B2 实测）→ 放宽到 60s
  afterEach(() => cleanup(h), 60_000);
  beforeEach(() => {
    h = createHarness();
  });

  it('§6.1a pre_write：备份→篡改→恢复→内容哈希与原始一致', async () => {
    const target = path.join(h.mizukiRoot, 'src', 'data', 'diary.ts');
    const originalHash = sha256(target);
    const backup = await h.service.preWriteBackup(target);
    expect(backup?.scope).toBe('pre_write');
    expect(backup?.fileCount).toBe(1);

    fs.writeFileSync(target, 'export const diaryData = [TAMPERED];\n'); // 篡改
    expect(sha256(target)).not.toBe(originalHash);

    await h.service.restore(backup!.id);
    expect(sha256(target)).toBe(originalHash);
  });

  it('§6.1b manual(content)：备份→篡改（含嵌套目录文件）→恢复→哈希一致', async () => {
    const target = path.join(h.mizukiRoot, 'src', 'content', 'posts', 'hello', 'index.md');
    const originalHash = sha256(target);
    const backup = await h.service.manualBackup('content');
    expect(backup.scope).toBe('manual');
    expect(backup.fileCount).toBe(1); // 仅 content，不含 src/data

    fs.writeFileSync(target, 'tampered');
    await h.service.restore(backup.id);
    expect(sha256(target)).toBe(originalHash);
  });

  it('§6.1b manual 范围：full = src/data/*.ts + src/content/**（ADR-003）；data 仅 src/data/*.ts', async () => {
    const backup = await h.service.manualBackup('full');
    expect(backup.scope).toBe('manual');
    expect(backup.fileCount).toBe(3); // diary.ts + friends.ts + index.md
    const dataBackup = await h.service.manualBackup('data');
    expect(dataBackup.fileCount).toBe(2);
  });

  it('§6.2 保留策略：同一文件连续 11 份 pre_write，仅剩最近 10 份（目录与记录同删）', async () => {
    const target = path.join(h.mizukiRoot, 'src', 'data', 'diary.ts');
    const created: { id: string; manifestPath: string }[] = [];
    for (let i = 0; i < 11; i++) {
      fs.writeFileSync(target, `v${i}\n`);
      const backup = await h.service.preWriteBackup(target);
      created.push({ id: backup!.id, manifestPath: backup!.manifestPath });
      await new Promise((resolve) => setTimeout(resolve, 4)); // 保证 createdAt 严格递增
    }
    const list = await h.service.listBackups();
    const preWrites = list.filter((r) => r.scope === 'pre_write');
    expect(preWrites).toHaveLength(10);
    expect(preWrites.some((r) => r.id === created[0]!.id)).toBe(false); // 最旧已删
    expect(preWrites.some((r) => r.id === created[1]!.id)).toBe(true); // 次旧保留
    expect(preWrites.some((r) => r.id === created[10]!.id)).toBe(true); // 最新保留
    // 最旧备份目录已物理删除
    expect(fs.existsSync(path.dirname(created[0]!.manifestPath))).toBe(false);
    // 记录行已删：恢复最旧 → 404
    await expect(h.service.restore(created[0]!.id)).rejects.toThrow(NotFoundException);
  });

  it('§6.3 manifest 完整性：每条目含原路径 + sha256，且与产物实际哈希一致', async () => {
    const backup = await h.service.manualBackup('full');
    const manifest = JSON.parse(fs.readFileSync(backup.manifestPath, 'utf8')) as {
      id: string;
      scope: string;
      createdAt: string;
      fileCount: number;
      sizeBytes: number;
      files: { path: string; sha256: string }[];
    };
    expect(manifest.id).toBe(backup.id);
    expect(manifest.scope).toBe('manual');
    expect(manifest.files).toHaveLength(3);
    for (const entry of manifest.files) {
      expect(entry.path).toMatch(/^(src\/data\/|src\/content\/)/);
      const product = path.join(path.dirname(backup.manifestPath), entry.path);
      expect(sha256(product)).toBe(entry.sha256);
    }
  });

  it('§6.3 恢复时产物被篡改 → sha256 校验失败拒绝恢复', async () => {
    const target = path.join(h.mizukiRoot, 'src', 'data', 'diary.ts');
    const backup = await h.service.preWriteBackup(target);
    const product = path.join(path.dirname(backup!.manifestPath), 'src', 'data', 'diary.ts');
    fs.writeFileSync(product, 'tampered-product');
    await expect(h.service.restore(backup!.id)).rejects.toThrow(BadRequestException);
  });

  it('§6.4 db 备份：写入→备份→改库→恢复→回到备份时刻，且恢复前自动生成快照记录', async () => {
    h.sqlite.exec('CREATE TABLE t (v TEXT)');
    h.sqlite.prepare('INSERT INTO t (v) VALUES (?)').run('before');
    const backup = await h.service.dbBackup();
    expect(backup.scope).toBe('db');

    h.sqlite.prepare('UPDATE t SET v = ?').run('after'); // 改库
    expect(h.sqlite.prepare('SELECT v FROM t').get()).toEqual({ v: 'after' });

    const result = await h.service.restore(backup.id);
    expect(result.restoredFiles).toBe(1);
    // 恢复后经新连接读取：回到备份时刻
    const check = new Database(h.dbPath, { readonly: true });
    try {
      expect(check.prepare('SELECT v FROM t').get()).toEqual({ v: 'before' });
    } finally {
      check.close();
    }
    // 恢复前快照（当前状态备份）记录可查（db 恢复后重新登记，磁盘产物仍在）
    const list = await h.service.listBackups();
    const snapshot = list.find((r) => r.id === result.safetyBackupId);
    expect(snapshot?.scope).toBe('db');
    expect(snapshot?.note).toContain('恢复前快照');
    // 被恢复备份自身的记录同样重新登记（可再次恢复/删除）
    expect(list.some((r) => r.id === backup.id)).toBe(true);
    // 快照产物目录真实存在（可用于回滚本次恢复）
    expect(fs.existsSync(path.dirname(snapshot!.manifestPath))).toBe(true);
  });

  it('§6.6 事件：每次备份成功后发射 backup.completed，payload 过 BackupCompletedPayload.parse', async () => {
    await h.service.preWriteBackup(path.join(h.mizukiRoot, 'src', 'data', 'diary.ts'));
    await h.service.manualBackup('data');
    await h.service.dbBackup();
    expect(h.events).toHaveLength(3);
    expect(h.events.map((e) => e.scope)).toEqual(['pre_write', 'manual', 'db']);
    for (const event of h.events) {
      expect(typeof event.id).toBe('string');
      expect(typeof event.fileCount).toBe('number');
    }
  });

  it('无源文件时 manual 备份为 0 文件空备份（流程成功，事件 fileCount=0）', async () => {
    const emptyRoot = path.join(h.tmp, 'empty-mizuki');
    fs.mkdirSync(emptyRoot);
    const events: { fileCount: number }[] = [];
    const emitter = new EventEmitter2();
    emitter.on(EVENTS.BackupCompleted, (payload: unknown) => {
      events.push(BackupCompletedPayload.parse(payload));
    });
    const service2 = new BackupService(drizzle(h.sqlite, { schema }), h.sqlite, emitter, {
      mizukiRoot: emptyRoot,
      backupDir: path.join(h.tmp, 'backups2'),
      dbPath: h.dbPath,
    });
    const backup = await service2.manualBackup('content');
    expect(backup.fileCount).toBe(0);
    expect(events[0]?.fileCount).toBe(0);
  });

  it('§6.7 路径防护：preWriteBackup 目标逃逸 mizukiRoot → 403 ForbiddenException', async () => {
    const outside = path.join(h.tmp, 'outside.txt');
    fs.writeFileSync(outside, 'x');
    await expect(h.service.preWriteBackup(outside)).rejects.toThrow(ForbiddenException);
    await expect(h.service.preWriteBackup(path.join(h.mizukiRoot, '..', 'evil.ts'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('§6.7 路径防护：manifest 篡改为 ../ 路径 → 恢复被拒（safeJoin 拦截）', async () => {
    const target = path.join(h.mizukiRoot, 'src', 'data', 'diary.ts');
    const backup = await h.service.preWriteBackup(target);
    // 篡改 manifest：原路径改为逃逸路径，并在对应位置放置同名产物使完整性校验通过
    const manifestPath = backup!.manifestPath;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      files: { path: string; sha256: string }[];
    };
    const backupRoot = path.dirname(manifestPath);
    const product = path.join(backupRoot, 'src', 'data', 'diary.ts');
    manifest.files[0]!.path = '../../evil-restore.txt';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.copyFileSync(product, path.join(backupRoot, '..', '..', 'evil-restore.txt'));
    await expect(h.service.restore(backup!.id)).rejects.toThrow(ForbiddenException);
  });

  it('mizukiRoot 未配置：文件备份 400 + 明确错误信息', async () => {
    const service2 = new BackupService(drizzle(h.sqlite, { schema }), h.sqlite, new EventEmitter2(), {
      mizukiRoot: '',
      backupDir: path.join(h.tmp, 'backups3'),
      dbPath: h.dbPath,
    });
    await expect(service2.manualBackup('data')).rejects.toThrow(/未配置/);
    await expect(service2.preWriteBackup(path.join(h.tmp, 'whatever.ts'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pre_write 目标文件不存在 → 跳过（返回 undefined，不产生记录）', async () => {
    const result = await h.service.preWriteBackup(path.join(h.mizukiRoot, 'src', 'data', 'new.ts'));
    expect(result).toBeUndefined();
    expect((await h.service.listBackups()).filter((r) => r.scope === 'pre_write')).toHaveLength(0);
  });

  it('deleteBackup：目录与记录一并删除；恢复已删备份 404', async () => {
    const backup = await h.service.manualBackup('data');
    expect(fs.existsSync(path.dirname(backup.manifestPath))).toBe(true);
    await h.service.deleteBackup(backup.id);
    expect(fs.existsSync(path.dirname(backup.manifestPath))).toBe(false);
    expect((await h.service.listBackups()).some((r) => r.id === backup.id)).toBe(false);
    await expect(h.service.restore(backup.id)).rejects.toThrow(NotFoundException);
  });
});
