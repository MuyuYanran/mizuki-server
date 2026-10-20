import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin } from './helpers/admin-auth';

/**
 * [U3-P3/K1] R2-2 向导目录点选器 e2e（supertest）。
 *
 * 端点：GET /api/v1/admin/system/browse-dirs?path=<绝对路径>
 * 鉴权形态（架构师再裁 A）：**@Public + 未初始化门**——
 *   初始化前可用（200）；系统已初始化 → 409。
 *   （R2-2 原文「需认证 / 无 Token 401」与向导 pre-auth 流程自矛盾，
 *    规格修订注记见 U3-P3 指令包 T6。）
 *
 * 覆盖（8 例）：
 *   ① 根列表（平台分支断言）；
 *   ② 子目录枚举：仅目录、排文件；
 *   ③ isMizuki 真假两态；
 *   ④ `.` / `$` 前缀目录跳过；
 *   ⑤ 201 目录 → truncated 且恰 200 条；
 *   ⑥ 相对路径 → 400；
 *   ⑦ 目录不存在 → 404；
 *   ⑧ init 前可调 200 → initAndLogin 后 409（同 spec 两阶段）。
 *
 * fixture 全 mkdtemp + env 注入，真实主题目录零写入。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p0a-browse-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 浏览器目录树（测试内自建，全部落在 mkdtemp 临时域内） */
const browseRoot = path.join(tmp, 'browse');
/** 含 201 个子目录的压测目录（触发 200 上限截断） */
const manyRoot = path.join(tmp, 'many');

interface BrowseItem {
  name: string;
  isMizuki: boolean;
}

interface BrowseResult {
  parent: string | null;
  items: BrowseItem[];
  truncated: boolean;
}

describe('P0a [U3-P3/K1] 目录浏览端点 e2e', () => {
  let app: INestApplication;
  let sqlite: Database.Database;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });

    // 目录树：普通目录 / Mizuki 候选（package.json）/ astro.config.mjs 候选 /
    // 隐藏目录（. / $ 前缀）/ 纯文件（应被排除）
    fs.mkdirSync(path.join(browseRoot, 'plain-dir'), { recursive: true });
    fs.mkdirSync(path.join(browseRoot, 'mizuki-pkg'), { recursive: true });
    fs.writeFileSync(path.join(browseRoot, 'mizuki-pkg', 'package.json'), '{"name":"x"}', 'utf8');
    fs.mkdirSync(path.join(browseRoot, 'mizuki-astro'), { recursive: true });
    fs.writeFileSync(path.join(browseRoot, 'mizuki-astro', 'astro.config.mjs'), 'export default {};', 'utf8');
    fs.mkdirSync(path.join(browseRoot, '.hidden-dot'), { recursive: true });
    fs.mkdirSync(path.join(browseRoot, '$hidden-dollar'), { recursive: true });
    fs.writeFileSync(path.join(browseRoot, 'a-file.txt'), 'x', 'utf8');

    // 201 子目录（超出 200 上限 → truncated）
    fs.mkdirSync(manyRoot, { recursive: true });
    for (let i = 0; i < 201; i += 1) {
      fs.mkdirSync(path.join(manyRoot, `dir-${String(i).padStart(3, '0')}`), { recursive: true });
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BACKUP_OPTIONS)
      .useValue({
        mizukiRoot,
        backupDir: path.join(tmp, 'backups'),
        dbPath: process.env['MIZUKI_DB_PATH'] as string,
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
  });

  afterAll(async () => {
    await app.close();
    sqlite.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const bare = (): request.SuperTest<request.Test> => request(app.getHttpServer());

  it('① 无 path → 根列表（Windows 盘符 / POSIX 单 "/"）', async () => {
    const res = await bare().get('/api/v1/admin/system/browse-dirs');
    expect(res.status).toBe(200);
    const body = res.body as BrowseResult;
    expect(body.parent).toBeNull();
    expect(body.truncated).toBe(false);
    if (process.platform === 'win32') {
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.name).toMatch(/^[A-Z]:\\$/);
      }
    } else {
      expect(body.items).toEqual([{ name: '/', isMizuki: false }]);
    }
  });

  it('② 有 path → 子目录枚举：仅目录、排除文件', async () => {
    const res = await bare().get(`/api/v1/admin/system/browse-dirs?path=${encodeURIComponent(browseRoot)}`);
    expect(res.status).toBe(200);
    const body = res.body as BrowseResult;
    expect(body.truncated).toBe(false);
    const names = body.items.map((item) => item.name);
    expect(names).toContain('plain-dir');
    expect(names).not.toContain('a-file.txt');
    // 排序：name.localeCompare 升序
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('③ isMizuki 真假两态（package.json / astro.config.mjs → true）', async () => {
    const res = await bare().get(`/api/v1/admin/system/browse-dirs?path=${encodeURIComponent(browseRoot)}`);
    expect(res.status).toBe(200);
    const items = (res.body as BrowseResult).items;
    const byName = new Map(items.map((item) => [item.name, item.isMizuki]));
    expect(byName.get('mizuki-pkg')).toBe(true);
    expect(byName.get('mizuki-astro')).toBe(true);
    expect(byName.get('plain-dir')).toBe(false);
  });

  it('④ `.` / `$` 前缀目录跳过', async () => {
    const res = await bare().get(`/api/v1/admin/system/browse-dirs?path=${encodeURIComponent(browseRoot)}`);
    expect(res.status).toBe(200);
    const names = (res.body as BrowseResult).items.map((item) => item.name);
    expect(names).not.toContain('.hidden-dot');
    expect(names).not.toContain('$hidden-dollar');
  });

  it('⑤ 201 个子目录 → truncated=true 且 items 恰 200 条', async () => {
    const res = await bare().get(`/api/v1/admin/system/browse-dirs?path=${encodeURIComponent(manyRoot)}`);
    expect(res.status).toBe(200);
    const body = res.body as BrowseResult;
    expect(body.truncated).toBe(true);
    expect(body.items.length).toBe(200);
  });

  it('⑥ 相对路径 → 400（不回显原文）', async () => {
    const res = await bare().get('/api/v1/admin/system/browse-dirs?path=not-absolute');
    expect(res.status).toBe(400);
    expect(String(res.body.message)).not.toContain('not-absolute');
  });

  it('⑦ 目录不存在 → 404（不回显绝对路径）', async () => {
    const missing = path.join(tmp, 'no-such-dir');
    const res = await bare().get(`/api/v1/admin/system/browse-dirs?path=${encodeURIComponent(missing)}`);
    expect(res.status).toBe(404);
    expect(String(res.body.message)).not.toContain(missing);
  });

  it('⑧ 初始化前 200 → initAndLogin 后 409（仅向导期可用）', async () => {
    // 初始化前：可用
    const before = await bare().get(`/api/v1/admin/system/browse-dirs?path=${encodeURIComponent(browseRoot)}`);
    expect(before.status).toBe(200);

    // 初始化后：未初始化门关闭 → 409
    await initAndLogin(request(app.getHttpServer()), mizukiRoot);
    const after = await bare().get(`/api/v1/admin/system/browse-dirs?path=${encodeURIComponent(browseRoot)}`);
    expect(after.status).toBe(409);
    expect(String(after.body.message)).toContain('已初始化');
  });
});
