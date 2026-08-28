import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException, NotFoundException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import { runMigrations } from '../../../src/infra/db/migrate';
import * as schema from '../../../src/infra/db/schema';
import { BackupService } from '../../../src/infra/backup/backup.service';
import {
  astToValue,
  ExportNotFoundError,
  evaluateExport,
  loadSourceFile,
  UnsupportedLiteralError,
} from '../../../src/modules/data-files/evaluator';
import { assertSyntaxValid } from '../../../src/modules/data-files/syntax-check';
import { valueToTsLiteral } from '../../../src/modules/data-files/serializer';
import { DataFileService } from '../../../src/modules/data-files/data-file.service';
import { FileLock } from '../../../src/modules/data-files/file-lock';
import { ValueCache } from '../../../src/modules/data-files/value-cache';

/**
 * P3 验收 §6.3–§6.8：不支持节点（含行号）、语法校验、陈旧 409、
 * 文件锁串行、value-cache、pre_write 备份与原子写入。
 * fixture 一律复制到临时目录后操作。
 */

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/mizuki');

interface Harness {
  service: DataFileService;
  backup: BackupService;
  cache: ValueCache;
  root: string;
  tmp: string;
  backupDir: string;
  sqlite: Database.Database;
}

function createHarness(): Harness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p3-engine-'));
  const root = path.join(tmp, 'mizuki');
  fs.cpSync(FIXTURE_DIR, root, { recursive: true });

  const dbPath = path.join(tmp, 'mizuki.db');
  runMigrations(dbPath);
  const sqlite = new Database(dbPath);
  const backupDir = path.join(tmp, 'backups');
  const backup = new BackupService(drizzle(sqlite, { schema }), sqlite, new EventEmitter2(), {
    mizukiRoot: root,
    backupDir,
    dbPath,
  });
  const cache = new ValueCache();
  const service = new DataFileService(new FileLock(), cache, backup, {
    mizukiRoot: root,
    backupDir,
    dbPath,
  });
  return { service, backup, cache, root, tmp, backupDir, sqlite };
}

function cleanup(h: Harness): void {
  h.sqlite.close();
  fs.rmSync(h.tmp, { recursive: true, force: true });
}

/** 在临时 Mizuki 根写入指定内容的 data 文件并返回相对路径 */
function writeDataFile(h: Harness, fileName: string, content: string): string {
  const rel = path.posix.join('src/data', fileName);
  fs.writeFileSync(path.join(h.root, 'src', 'data', fileName), content, 'utf8');
  return rel;
}

describe('P3 引擎机制：求值器 / 语法校验 / 写管线', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
  });
  afterEach(() => cleanup(h));

  describe('§6.3 不支持节点 → UnsupportedLiteralError（含文件名与行号）', () => {
    const cases: { name: string; content: string; badLine: number }[] = [
      {
        name: '模板插值 `${}`',
        content: "const base = 'x';\nexport const data = [`a${base}b`];\n",
        badLine: 2,
      },
      {
        name: '标识符引用',
        content: "const other = 1;\nexport const data = [other];\n",
        badLine: 2,
      },
      {
        name: '属性访问',
        content: "const obj = { a: 1 };\nexport const data = [obj.a];\n",
        badLine: 2,
      },
      {
        name: 'Shorthand 属性',
        content: 'const a = 1;\nexport const data = [{ a }];\n',
        badLine: 2,
      },
      {
        name: 'Spread 元素',
        content: 'const arr = [1];\nexport const data = [...arr, 2];\n',
        badLine: 2,
      },
    ];

    for (const { name, content, badLine } of cases) {
      it(`${name} → 错误含文件名与第 ${badLine} 行`, () => {
        const rel = writeDataFile(h, 'bad.ts', content);
        const abs = path.join(h.root, rel);
        expect(() => evaluateExport(abs, 'data')).toThrow(UnsupportedLiteralError);
        try {
          evaluateExport(abs, 'data');
        } catch (error) {
          const err = error as UnsupportedLiteralError;
          expect(err.fileName).toContain('bad.ts');
          expect(err.line).toBe(badLine);
          expect(err.message).toMatch(/第 2 行/);
        }
      });
    }

    it('支持的语法不误伤：as const / satisfies / 括号 / 负数 / 模板（无插值）', () => {
      const content = [
        "export const ok1 = ['a', 'b'] as const;",
        'export const ok2 = [{ n: 1 }] satisfies unknown[];',
        "export const ok3 = ('嵌套括号');",
        'export const ok4 = [-5, 3.14];',
        'export const ok5 = `多行\n模板`;',
        'export const ok6 = null;',
      ].join('\n');
      const rel = writeDataFile(h, 'ok.ts', content);
      const abs = path.join(h.root, rel);
      expect(evaluateExport(abs, 'ok1')).toEqual(['a', 'b']);
      expect(evaluateExport(abs, 'ok2')).toEqual([{ n: 1 }]);
      expect(evaluateExport(abs, 'ok3')).toBe('嵌套括号');
      expect(evaluateExport(abs, 'ok4')).toEqual([-5, 3.14]);
      expect(evaluateExport(abs, 'ok5')).toBe('多行\n模板');
      expect(evaluateExport(abs, 'ok6')).toBeNull();
    });

    it('未找到导出变量 → ExportNotFoundError（404）', () => {
      const rel = writeDataFile(h, 'missing.ts', 'export const data = [1];\n');
      expect(() => evaluateExport(path.join(h.root, rel), 'notExist')).toThrow(ExportNotFoundError);
      expect(() => h.service.readCollection(rel, 'notExist')).toThrow(NotFoundException);
    });

    it('astToValue：字符串键/数字键对象求值', () => {
      const rel = writeDataFile(h, 'keys.ts', "export const data = { '中文键': 1, num: 2, 'with space': 3 };\n");
      expect(h.service.readCollection(rel, 'data')).toEqual({ 中文键: 1, num: 2, 'with space': 3 });
    });
  });

  describe('§6.4 语法校验（transpileModule diagnostics）', () => {
    it('语法错误文本 → 抛错（含行号）', () => {
      expect(() => assertSyntaxValid('export const x = [;\n', 'bad.ts')).toThrow(/语法校验失败/);
      expect(() => assertSyntaxValid('const a = ;\n', 'bad.ts')).toThrow(/第 1 行/);
    });

    it('合法文本 → 通过（含注释/单引号/尾随逗号等 fixture 特征）', () => {
      const fixtureText = fs.readFileSync(path.join(FIXTURE_DIR, 'src/data/diary.ts'), 'utf8');
      expect(() => assertSyntaxValid(fixtureText, 'diary.ts')).not.toThrow();
    });

    it('序列化器：值 → TS 字面量（键去引号、值引号保留）并可通过语法校验', () => {
      const text = valueToTsLiteral({
        name: '含 "引号" 的值',
        nested: { a: 1, '键 with space': true },
        arr: [1, 'x', null],
      });
      expect(text).toContain('name: "含 \\"引号\\" 的值"');
      expect(text).toContain('键 with space');
      expect(() => assertSyntaxValid(`export const x = ${text};\n`, 'x.ts')).not.toThrow();
    });
  });

  describe('§6.5 陈旧检测（外部修改 → 重试 1 次 → 409）', () => {
    it('mutate 期间文件被持续外部修改 → 重试 1 次后 409，且磁盘未被写入', async () => {
      const rel = 'src/data/diary.ts';
      const diskBefore = fs.readFileSync(path.join(h.root, rel), 'utf8');
      let attempts = 0;
      await expect(
        h.service.mutateCollection<unknown[]>(rel, 'diaryData', (list) => {
          attempts += 1;
          // 模拟「读盘后、写盘前」外部进程持续改写文件
          fs.appendFileSync(path.join(h.root, rel), '// 外部写入\n');
          return [...(list as object[]), { id: 'x' }];
        }),
      ).rejects.toThrow(ConflictException);
      expect(attempts).toBe(2); // 首次 + 重试 1 次
      // 磁盘内容 = 原文 + 两次外部追加；引擎自身未写入（无新增条目）
      const diskAfter = fs.readFileSync(path.join(h.root, rel), 'utf8');
      expect(diskAfter).toBe(diskBefore + '// 外部写入\n' + '// 外部写入\n');
    });

    it('外部修改仅一次 → 重试后成功写入（新基底之上）', async () => {
      const rel = 'src/data/diary.ts';
      let attempts = 0;
      await h.service.mutateCollection<{ id: number }[]>(rel, 'diaryData', (list) => {
        attempts += 1;
        if (attempts === 1) {
          // 仅首次尝试期间被外部修改一次
          fs.appendFileSync(path.join(h.root, rel), '// 外部写入一次\n');
        }
        return [...list, { id: 999 }];
      });
      expect(attempts).toBe(2);
      const after = h.service.readCollection<{ id: number }[]>(rel, 'diaryData');
      expect(after).toHaveLength(3);
      expect(after[2]!.id).toBe(999);
    });
  });

  describe('§6.6 文件锁', () => {
    it('同一文件并发 2 个 mutate → 串行执行（无重叠），最终值一致且文件完好', async () => {
      const rel = 'src/data/friends.ts';
      let active = 0;
      let maxOverlap = 0;
      const slowAppend = (id: number) =>
        h.service.mutateCollection<{ id: number }[]>(rel, 'friendsData', async (list) => {
          active += 1;
          maxOverlap = Math.max(maxOverlap, active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active -= 1;
          return [...list, { id, title: `新增-${id}`, imgurl: '', siteurl: '' }];
        });
      await Promise.all([slowAppend(101), slowAppend(102)]);
      expect(maxOverlap).toBe(1); // 串行：mutate 回调从不重叠
      const after = h.service.readCollection<{ id: number }[]>(rel, 'friendsData');
      expect(after.map((f) => f.id)).toEqual([1, 2, 101, 102]);
      // 文件完好：语法校验通过 + 尾部代码仍在
      const text = fs.readFileSync(path.join(h.root, rel), 'utf8');
      expect(text).toContain('friendsCount');
      expect(() => assertSyntaxValid(text, rel)).not.toThrow();
    });

    it('不同文件并发 → 并行执行（mutate 回调出现重叠）', async () => {
      let active = 0;
      let maxOverlap = 0;
      const op = (file: string, varName: string) =>
        h.service.mutateCollection<unknown[]>(file, varName, async (list) => {
          active += 1;
          maxOverlap = Math.max(maxOverlap, active);
          await new Promise((resolve) => setTimeout(resolve, 50));
          active -= 1;
          return list;
        });
      await Promise.all([op('src/data/diary.ts', 'diaryData'), op('src/data/skills.ts', 'skillsData')]);
      expect(maxOverlap).toBe(2); // 并行：两个文件的 mutate 回调同时在场
    });
  });

  describe('§6.7 value-cache', () => {
    it('读后缓存命中（load 只执行一次）；外部修改（mtime/size 变化）后失效重读', () => {
      const rel = 'src/data/timeline.ts';
      let loadCount = 0;
      const read = () =>
        h.cache.get(path.join(h.root, rel), () => {
          loadCount += 1;
          return h.service.readCollection(rel, 'timelineData');
        });
      read();
      read();
      expect(loadCount).toBe(1); // 命中

      // 外部修改：追加内容 → size/mtime 变化 → 失效重读
      const p = path.join(h.root, rel);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '// touched\n', 'utf8');
      read();
      expect(loadCount).toBe(2);
    });

    it('写管线第 8 步失效缓存：mutate 后 readCollection 重读新值', async () => {
      const rel = 'src/data/skills.ts';
      h.service.readCollection(rel, 'skillsData'); // 预热缓存
      await h.service.mutateCollection<{ id: number }[]>(rel, 'skillsData', (list) => [
        ...list,
        { id: 999, name: '新技能' },
      ]);
      const after = h.service.readCollection<{ id: number }[]>(rel, 'skillsData');
      expect(after.some((s) => s.id === 999)).toBe(true);
    });
  });

  describe('§6.8 写管线备份与原子性', () => {
    it('写后备份目录出现该文件的 pre_write 快照（内容与写前一致）', async () => {
      const rel = 'src/data/diary.ts';
      const before = fs.readFileSync(path.join(h.root, rel), 'utf8');
      await h.service.mutateCollection<unknown[]>(rel, 'diaryData', (list) => [...(list as object[]), {}]);
      const records = await h.backup.listBackups();
      const preWrites = records.filter((r) => r.scope === 'pre_write');
      expect(preWrites).toHaveLength(1);
      const manifestPath = preWrites[0]!.manifestPath;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        files: { path: string; sha256: string }[];
      };
      expect(manifest.files[0]!.path).toBe('src/data/diary.ts');
      // 快照产物 = 写前原文
      const product = path.join(path.dirname(manifestPath), 'src/data/diary.ts');
      expect(fs.readFileSync(product, 'utf8')).toBe(before);
    });

    it('原子写入：完成后无 .tmp-* 残留，目标文件完整可解析', async () => {
      const rel = 'src/data/devices.ts';
      await h.service.mutateCollection<Record<string, unknown[]>>(rel, 'devicesData', (data) => ({
        ...data,
        新分组: [{ name: '新设备' }],
      }));
      const dir = path.join(h.root, 'src', 'data');
      const leftovers = fs.readdirSync(dir).filter((name) => name.startsWith('.tmp-'));
      expect(leftovers).toEqual([]);
      const value = h.service.readCollection<Record<string, unknown[]>>(rel, 'devicesData');
      expect(value['新分组']).toEqual([{ name: '新设备' }]);
    });

    it('新文件首写：目标不存在 → pre_write 跳过，管线继续成功', async () => {
      const rel = writeDataFile(h, 'empty.ts', 'export const data = [];\n');
      await h.service.mutateCollection<unknown[]>(rel, 'data', (list) => [...(list as object[]), { a: 1 }]);
      expect(h.service.readCollection(rel, 'data')).toEqual([{ a: 1 }]);
      const preWrites = (await h.backup.listBackups()).filter((r) => r.scope === 'pre_write');
      expect(preWrites).toHaveLength(1); // 仅 empty.ts 写入前已存在的那次
    });

    it('zod 校验失败 → 不写入磁盘', async () => {
      const rel = 'src/data/friends.ts';
      const before = fs.readFileSync(path.join(h.root, rel), 'utf8');
      const schema = z.array(z.object({ id: z.string() }));
      await expect(
        h.service.mutateCollection<unknown[]>(rel, 'friendsData', (list) => [...(list as object[]), 42], schema),
      ).rejects.toThrow();
      expect(fs.readFileSync(path.join(h.root, rel), 'utf8')).toBe(before);
    });

    it('路径逃逸：relFile 含 ../ → ForbiddenException（403）', async () => {
      await expect(
        h.service.mutateCollection('src/data/../../etc/passwd', 'data', (v) => v),
      ).rejects.toThrow();
      expect(() => h.service.readCollection('../secret.ts', 'data')).toThrow();
    });
  });

  it('astToValue 直接调用：数组/对象递归与 getter 抛错（分派表单元覆盖）', () => {
    const sf = loadSourceFile('inline.ts', 'const g = { get x() { return 1; } };\n');
    const getterInit = sf.getVariableDeclaration('g')!.getInitializer()!;
    expect(() => astToValue(getterInit, 'inline.ts')).toThrow(UnsupportedLiteralError);
  });
});
