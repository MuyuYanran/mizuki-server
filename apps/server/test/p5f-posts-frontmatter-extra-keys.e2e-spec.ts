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
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [U3-P2/K2+K3+T5] frontmatter 补键 e2e（A-GAP-09）
 *
 * 覆盖面（七键：updated / priority / alias / passwordHint / licenseName /
 * licenseUrl / sourceLink）：
 * ① 七键创建往返：POST 后落盘 YAML 含七键 + GET 回读值一致；
 * ② PATCH 单键合并：只送 priority → 其余六键存量保留（增量合并语义）；
 * ③ null 删键逐键：alias / priority / passwordHint 送 null → 盘上键消失 + 其余键存活；
 * ④ updated 无删键路径：PATCH 送 updated 缺键 → 存量值保留（与 date/pubDate 同口径）；
 * ⑤ 类型错 400×2：priority 送字符串 / updated 送非法类型；
 * ⑥ passthrough 未知键回归：非七键未知键仍原样保留（既有 passthrough 语义零破坏）；
 * ⑦ deriveStatus 回归锚：七键不影响发布态推导（draft:false 仍 published）。
 *
 * 注：本 spec 自建 mkdtemp 临时域（fixture cpSync 副本），真实主题目录零触碰。
 * 用例按文件序执行且共享后端实例/数据库状态。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5f-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const postsDir = path.join(mizukiRoot, 'src', 'content', 'posts');
const postFile = (slug: string): string => path.join(postsDir, slug, 'index.md');

describe('[U3-P2] frontmatter 七键（A-GAP-09）e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
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
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  const readFile = (slug: string): string => fs.readFileSync(postFile(slug), 'utf8');

  type PostBody = {
    slug: string;
    frontmatter: Record<string, unknown>;
    content: string;
    source: string;
  };

  const SEVEN_KEYS = {
    updated: '2026-05-06',
    priority: 7,
    alias: 'old-slug-path',
    passwordHint: '提示：生日',
    licenseName: 'CC BY-NC-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    sourceLink: 'https://example.com/origin',
  };

  it('① 七键创建往返：落盘 YAML 含七键 + GET 回读值一致', async () => {
    const res = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'u3p2-extra',
        frontmatter: {
          title: '补键往返',
          published: '2026-05-01',
          description: '覆盖七键',
          draft: false,
          ...SEVEN_KEYS,
        },
        content: '# 正文\n',
      });
    expect(res.status).toBe(201);

    const text = readFile('u3p2-extra');
    // 日期键裸形态（js-yaml 对日期形字符串恒加引号 → 写路径统一归一为裸日期，
    // 否则主题 z.date() 校验会收到 string 而构建失败）
    expect(text).toContain('updated: 2026-05-06');
    expect(text).toContain('priority: 7');
    expect(text).toContain('alias: old-slug-path');
    expect(text).toContain('passwordHint: 提示：生日');
    expect(text).toContain('licenseName: CC BY-NC-SA 4.0');
    // 含 ':' 的 URL 由 js-yaml 加单引号保护（合法 YAML，语义不变）——以回读为准断言
    expect(text).toContain('licenseUrl:');
    expect(text).toContain('https://creativecommons.org/licenses/by-nc-sa/4.0/');
    expect(text).toContain('sourceLink:');
    expect(text).toContain('https://example.com/origin');

    const get = await server().get('/api/v1/admin/posts/u3p2-extra');
    expect(get.status).toBe(200);
    const body = get.body as PostBody;
    expect(body.frontmatter['priority']).toBe(7);
    expect(body.frontmatter['alias']).toBe('old-slug-path');
    expect(body.frontmatter['passwordHint']).toBe('提示：生日');
    expect(body.frontmatter['licenseName']).toBe('CC BY-NC-SA 4.0');
    expect(body.frontmatter['licenseUrl']).toBe(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    );
    expect(body.frontmatter['sourceLink']).toBe('https://example.com/origin');
  });

  it('② PATCH 单键合并：只送 priority=9 → 其余六键存量保留', async () => {
    const patch = await server()
      .patch('/api/v1/admin/posts/u3p2-extra')
      .send({ frontmatter: { priority: 9 } });
    expect(patch.status).toBe(200);

    const get = await server().get('/api/v1/admin/posts/u3p2-extra');
    const fm = (get.body as PostBody).frontmatter;
    expect(fm['priority']).toBe(9);
    expect(fm['alias']).toBe('old-slug-path'); // 缺键保留
    expect(fm['passwordHint']).toBe('提示：生日');
    expect(fm['licenseName']).toBe('CC BY-NC-SA 4.0');
    expect(fm['licenseUrl']).toBe('https://creativecommons.org/licenses/by-nc-sa/4.0/');
    expect(fm['sourceLink']).toBe('https://example.com/origin');
    expect(String(fm['updated'])).toContain('2026-05-06');
    expect(readFile('u3p2-extra')).toContain('priority: 9');
  });

  it('③ null 删键逐键：alias / priority / passwordHint → 盘上键消失，其余存活', async () => {
    const patch = await server()
      .patch('/api/v1/admin/posts/u3p2-extra')
      .send({ frontmatter: { alias: null, priority: null, passwordHint: null } });
    expect(patch.status).toBe(200);

    const text = readFile('u3p2-extra');
    expect(text).not.toContain('alias:');
    expect(text).not.toContain('priority:');
    expect(text).not.toContain('passwordHint:');
    // 其余四键存活（删键只作用于 NULL_DELETE_KEYS 命中项）
    expect(text).toContain('licenseName: CC BY-NC-SA 4.0');
    expect(text).toContain('https://creativecommons.org/licenses/by-nc-sa/4.0/');
    expect(text).toContain('https://example.com/origin');

    const get = await server().get('/api/v1/admin/posts/u3p2-extra');
    const fm = (get.body as PostBody).frontmatter;
    expect(fm['alias']).toBeUndefined();
    expect(fm['priority']).toBeUndefined();
    expect(fm['passwordHint']).toBeUndefined();
  });

  it('④ updated 无删键路径：PATCH 缺 updated 键 → 存量保留（与 date/pubDate 同口径）', async () => {
    const patch = await server()
      .patch('/api/v1/admin/posts/u3p2-extra')
      .send({ frontmatter: { licenseName: 'MIT' } });
    expect(patch.status).toBe(200);
    const text = readFile('u3p2-extra');
    expect(text).toContain('licenseName: MIT');
    expect(text).toContain('updated: 2026-05-06'); // 缺键不删
  });

  it('⑤ 类型错 → 400×2 且零落盘（priority 字符串 / updated 非法类型）', async () => {
    const before = readFile('u3p2-extra');
    const bad1 = await server()
      .patch('/api/v1/admin/posts/u3p2-extra')
      .send({ frontmatter: { priority: 'high' } });
    expect(bad1.status).toBe(400);
    const bad2 = await server()
      .patch('/api/v1/admin/posts/u3p2-extra')
      .send({ frontmatter: { updated: { nope: true } } });
    expect(bad2.status).toBe(400);
    expect(readFile('u3p2-extra')).toBe(before); // 失败路径零物化
  });

  it('⑥ passthrough 未知键回归：非七键的未知键仍原样保留', async () => {
    const create = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'u3p2-passthrough',
        frontmatter: {
          title: '未知键保真',
          published: '2026-05-02',
          draft: false,
          customUndeclaredKey: { nested: [1, 2, 3] },
          priority: 3,
        },
        content: 'x\n',
      });
    expect(create.status).toBe(201);
    const text = readFile('u3p2-passthrough');
    expect(text).toContain('customUndeclaredKey:');

    const get = await server().get('/api/v1/admin/posts/u3p2-passthrough');
    const fm = (get.body as PostBody).frontmatter;
    expect(fm['customUndeclaredKey']).toEqual({ nested: [1, 2, 3] });
    expect(fm['priority']).toBe(3);
  });

  it('⑦ deriveStatus 回归锚：七键不影响发布态推导（draft:false → published）', async () => {
    const list = await server().get('/api/v1/admin/posts');
    expect(list.status).toBe(200);
    const rows = list.body as { items?: { slug: string; status: string }[] } | { slug: string; status: string }[];
    const items = Array.isArray(rows) ? rows : (rows.items ?? []);
    const target = items.find((item) => item.slug === 'u3p2-extra');
    expect(target).toBeDefined();
    expect(target?.status).toBe('published'); // draft:false + published 日期 → published
  });
});
