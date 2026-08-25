import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from '../../../src/infra/db/migrate';
import * as schema from '../../../src/infra/db/schema';
import { BackupService } from '../../../src/infra/backup/backup.service';
import { DataFileService } from '../../../src/modules/data-files/data-file.service';
import { FileLock } from '../../../src/modules/data-files/file-lock';
import { ValueCache } from '../../../src/modules/data-files/value-cache';
import { getVariableDeclarationOrThrow, loadSourceFile } from '../../../src/modules/data-files/evaluator';

/**
 * P3 §6.5 / 验收 §6.1 / §6.2 golden-file 测试：
 * ① 往返：读 → 改 → 写 → 再读，值正确；
 * ② 外部字节不变：写后初始化表达式以外的字节与原文件完全一致；
 * ③ （可选）写后 tsc --noEmit 通过。
 * 全部操作作用于 fixture 的临时副本（复制到 os.tmpdir）。
 */

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/mizuki');

interface Harness {
  service: DataFileService;
  root: string;
  tmp: string;
  sqlite: Database.Database;
}

function createHarness(): Harness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p3-golden-'));
  const root = path.join(tmp, 'mizuki');
  fs.cpSync(FIXTURE_DIR, root, { recursive: true });

  const dbPath = path.join(tmp, 'mizuki.db');
  runMigrations(dbPath);
  const sqlite = new Database(dbPath);
  const backup = new BackupService(drizzle(sqlite, { schema }), sqlite, new EventEmitter2(), {
    mizukiRoot: root,
    backupDir: path.join(tmp, 'backups'),
    dbPath,
  });
  const service = new DataFileService(new FileLock(), new ValueCache(), backup, {
    mizukiRoot: root,
    backupDir: path.join(tmp, 'backups'),
    dbPath,
  });
  return { service, root, tmp, sqlite };
}

function cleanup(h: Harness): void {
  h.sqlite.close();
  fs.rmSync(h.tmp, { recursive: true, force: true });
}

/** 取文件中指定变量初始化表达式的 [start, end) 偏移 */
function initializerSpan(absPath: string, varName: string): { start: number; end: number } {
  const sf = loadSourceFile(absPath);
  const init = getVariableDeclarationOrThrow(sf, varName).getInitializer();
  if (!init) {
    throw new Error(`无初始化表达式：${absPath}`);
  }
  return { start: init.getStart(), end: init.getEnd() };
}

/**
 * golden 断言 ②：写后文件与原文件相比，初始化表达式以外的字节逐字节一致
 * （前缀 + 后缀分别比对）。
 */
function assertOutsideInitializerByteIdentical(
  originalPath: string,
  writtenPath: string,
  varName: string,
): void {
  const before = fs.readFileSync(originalPath, 'utf8');
  const after = fs.readFileSync(writtenPath, 'utf8');
  const spanBefore = initializerSpan(originalPath, varName);
  const spanAfter = initializerSpan(writtenPath, varName);
  expect(after.slice(0, spanAfter.start)).toBe(before.slice(0, spanBefore.start));
  expect(after.slice(spanAfter.end)).toBe(before.slice(spanBefore.end));
}

describe('P3 golden-file：六个数据文件往返 + 外部字节不变', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
  });
  afterEach(() => cleanup(h));

  it('diary（数组）：改一条 content + 删一条 → 再读值正确；外部字节不变', async () => {
    const rel = 'src/data/diary.ts';
    const before = h.service.readCollection<{ id: string; content: string }[]>(rel, 'diaryData');
    expect(before).toHaveLength(2);
    expect(before[0]!.content).toContain('超级');

    await h.service.mutateCollection<typeof before>(rel, 'diaryData', (list) => {
      const next = [...list];
      next[0] = { ...next[0]!, content: '改写后的正文\n含换行与 "引号"' };
      next.pop(); // 删除一条
      return next;
    });

    const after = h.service.readCollection<typeof before>(rel, 'diaryData');
    expect(after).toHaveLength(1);
    expect(after[0]!.content).toBe('改写后的正文\n含换行与 "引号"');
    expect(after[0]!.id).toBe('d-001');
    assertOutsideInitializerByteIdentical(
      path.join(FIXTURE_DIR, rel),
      path.join(h.root, rel),
      'diaryData',
    );
  });

  it('friends（as const）：新增一条 → 再读值正确；外部字节不变', async () => {
    const rel = 'src/data/friends.ts';
    const added = {
      id: 'f-003',
      title: '新增友链',
      imgurl: 'https://example.com/a.png',
      siteurl: 'https://example.com',
      tags: ['新'],
    };
    await h.service.mutateCollection<{ id: string }[]>(rel, 'friendsData', (list) => [...list, added]);

    const after = h.service.readCollection<{ id: string }[]>(rel, 'friendsData');
    expect(after).toHaveLength(3);
    expect(after[2]).toEqual(added);
    assertOutsideInitializerByteIdentical(
      path.join(FIXTURE_DIR, rel),
      path.join(h.root, rel),
      'friendsData',
    );
  });

  it('projects（satisfies）：改 featured 字段 → 再读值正确；外部字节不变', async () => {
    const rel = 'src/data/projects.ts';
    await h.service.mutateCollection<{ id: string; featured?: boolean }[]>(rel, 'projectsData', (list) =>
      list.map((item) => (item.id === 'p-002' ? { ...item, featured: true } : item)),
    );
    const after = h.service.readCollection<{ id: string; featured?: boolean }[]>(rel, 'projectsData');
    expect(after.find((item) => item.id === 'p-002')?.featured).toBe(true);
    expect(after.find((item) => item.id === 'p-001')?.featured).toBe(true);
    assertOutsideInitializerByteIdentical(
      path.join(FIXTURE_DIR, rel),
      path.join(h.root, rel),
      'projectsData',
    );
  });

  it('timeline（模板字符串）：新增一条（保留原有模板字符串条目）→ 值正确；外部字节不变', async () => {
    const rel = 'src/data/timeline.ts';
    const before = h.service.readCollection<{ id: string; description?: string }[]>(rel, 'timelineData');
    expect(before[0]!.description).toContain('\n');

    await h.service.mutateCollection<{ id: string; type: string; title: string; startDate: string }[]>(
      rel,
      'timelineData',
      (list) => [
        ...list,
        { id: 't-100', title: '新事件', type: 'other', startDate: '2026-08-26' },
      ],
    );

    const after = h.service.readCollection<{ id: string; description?: string }[]>(rel, 'timelineData');
    expect(after).toHaveLength(3);
    expect(after[0]!.description).toBe(before[0]!.description); // 模板字符串值往返无损
    expect(after[2]!.id).toBe('t-100');
    assertOutsideInitializerByteIdentical(
      path.join(FIXTURE_DIR, rel),
      path.join(h.root, rel),
      'timelineData',
    );
  });

  it('skills（嵌套对象/负数）：改嵌套 experience → 值正确；外部字节不变', async () => {
    const rel = 'src/data/skills.ts';
    const before = h.service.readCollection<{ id: string; level?: number; experience?: unknown }[]>(
      rel,
      'skillsData',
    );
    expect(before.find((s) => s.id === 's-003')?.level).toBe(-3);

    await h.service.mutateCollection<typeof before>(rel, 'skillsData', (list) =>
      list.map((item) =>
        item.id === 's-001' ? { ...item, experience: { years: 5, months: 1 } } : item,
      ),
    );

    const after = h.service.readCollection<typeof before>(rel, 'skillsData');
    expect(after.find((s) => s.id === 's-001')?.experience).toEqual({ years: 5, months: 1 });
    expect(after.find((s) => s.id === 's-003')?.level).toBe(-3);
    assertOutsideInitializerByteIdentical(
      path.join(FIXTURE_DIR, rel),
      path.join(h.root, rel),
      'skillsData',
    );
  });

  it('devices（grouped 对象）：分组内增删改 → 值正确；外部字节不变', async () => {
    const rel = 'src/data/devices.ts';
    const before = h.service.readCollection<Record<string, { name: string }[]>>(rel, 'devicesData');
    expect(Object.keys(before)).toEqual(['电脑', '外设']);

    await h.service.mutateCollection<Record<string, { name: string }[]>>(rel, 'devicesData', (data) => {
      const next: Record<string, { name: string }[]> = {
        ...data,
        电脑: [...data['电脑']!, { name: '显示器' }],
      };
      next['外设'] = data['外设']!.filter((device) => device.name !== 'MX Master 3S');
      next['新分组'] = [{ name: '手机' }];
      return next;
    });

    const after = h.service.readCollection<Record<string, { name: string }[]>>(rel, 'devicesData');
    expect(after['电脑']).toHaveLength(2);
    expect(after['外设']).toHaveLength(1);
    expect(after['新分组']).toEqual([{ name: '手机' }]);
    assertOutsideInitializerByteIdentical(
      path.join(FIXTURE_DIR, rel),
      path.join(h.root, rel),
      'devicesData',
    );
  });

  it('（可选集成）写后 fixture 副本对 diary.ts 执行 tsc --noEmit 通过', () => {
    const file = path.join(h.root, 'src', 'data', 'diary.ts');
    const tscBin = path.resolve(__dirname, '../../../node_modules/typescript/bin/tsc');
    execFileSync(
      process.execPath,
      [tscBin, '--noEmit', '--target', 'ES2022', '--moduleResolution', 'node', '--module', 'ESNext', file],
      { stdio: 'pipe' },
    );
    // tsc 无输出且退出码 0 即通过（execFileSync 非 0 会抛错）
  });
});
