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
 * [Phase3-C2b/ADR-018] anime 第七集合 e2e：官方 local 模式（title 定位、
 * 无 id 字段——幽灵字段禁令、canonical 文件形状）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4d-anime-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

const ANIME_REL = 'src/data/anime.ts';

function validItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '测试番剧',
    status: 'watching',
    rating: 8.5,
    cover: '/images/anime/test.jpg',
    description: 'e2e 测试条目',
    episodes: '12 episodes',
    year: '2026',
    genre: ['科幻'],
    studio: 'E2E Studio',
    link: 'https://bgm.tv/subject/e2e',
    progress: 3,
    totalEpisodes: 12,
    startDate: '2026-07',
    ...overrides,
  };
}

describe('P4d anime 第七集合 e2e（Phase3-C2b/ADR-018）', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  const diskText = (): string => fs.readFileSync(path.join(mizukiRoot, ANIME_REL), 'utf8');

  it('① anime CRUD 全循环：POST → GET → PATCH（title 定位）→ DELETE（title 定位）', async () => {
    const created = await server().post('/api/v1/admin/collections/anime').send(validItem());
    expect(created.status).toBe(201);
    expect(created.body.title).toBe('测试番剧');

    const list = await server().get('/api/v1/admin/collections/anime');
    expect(list.status).toBe(200);
    expect((list.body as { title: string }[]).some((i) => i.title === '测试番剧')).toBe(true);

    const patched = await server()
      .patch(`/api/v1/admin/collections/anime/${encodeURIComponent('测试番剧')}`)
      .send({ progress: 5, status: 'completed' });
    expect(patched.status).toBe(200);
    expect(patched.body.progress).toBe(5);
    expect(patched.body.status).toBe('completed');

    const deleted = await server().delete(`/api/v1/admin/collections/anime/${encodeURIComponent('测试番剧')}`);
    expect(deleted.status).toBe(200);
    const after = await server().get('/api/v1/admin/collections/anime');
    expect((after.body as { title: string }[]).some((i) => i.title === '测试番剧')).toBe(false);
  });

  it('② 重名 title 创建 → 409（title 为定位键）', async () => {
    const res = await server()
      .post('/api/v1/admin/collections/anime')
      .send(validItem({ title: '葬送的芙莉莲' }));
    expect(res.status).toBe(409);
  });

  it('③ 公开 API：/public/collections/anime 200 且随 registry 白名单自动开放', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/public/collections/anime');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as unknown[]).length).toBe(3);
  });

  it('④ 幽灵字段禁令：读回与磁盘均无 id 键（engine 不注入任何 id 字段）', async () => {
    const list = await server().get('/api/v1/admin/collections/anime');
    expect(list.status).toBe(200);
    for (const item of list.body as Record<string, unknown>[]) {
      expect(Object.keys(item)).not.toContain('id');
    }
    // PATCH 后落盘同样零 id 键
    const text = diskText();
    expect(/\bid\s*:/.test(text)).toBe(false);
  });

  it('⑤ 枚举拒绝：status "binge-watching" → 400', async () => {
    const res = await server()
      .post('/api/v1/admin/collections/anime')
      .send(validItem({ status: 'binge-watching' }));
    expect(res.status).toBe(400);
    expect(res.body.detail.issues.length).toBeGreaterThan(0);
  });

  it('⑥ startDate 格式：YYYY-MM-DD 拒 400，YYYY-MM 过', async () => {
    const bad = await server()
      .post('/api/v1/admin/collections/anime')
      .send(validItem({ title: '日期反例', startDate: '2026-08-29' }));
    expect(bad.status).toBe(400);
    const ok = await server()
      .post('/api/v1/admin/collections/anime')
      .send(validItem({ title: '日期正例', startDate: '2026-08' }));
    expect(ok.status).toBe(201);
    await server().delete('/api/v1/admin/collections/anime/%E6%97%A5%E6%9C%9F%E6%AD%A3%E4%BE%8B');
  });

  it('⑦ canonical 文件形状：localAnimeList 在前、getAnimeList 后缀字节保持', async () => {
    // 写操作（新增 + 删除）后，后缀函数仍位于 initializer 之后且逐字节保持
    await server().post('/api/v1/admin/collections/anime').send(validItem({ title: '形状探针' }));
    await server().delete('/api/v1/admin/collections/anime/%E5%BD%A2%E7%8A%B6%E6%8E%A2%E9%92%88');
    const text = diskText();
    const declIdx = text.indexOf('export const localAnimeList');
    const fnIdx = text.indexOf('export const getAnimeList = () => localAnimeList;');
    expect(declIdx).toBeGreaterThan(-1);
    expect(fnIdx).toBeGreaterThan(declIdx);
    expect(text.trimEnd().endsWith('export const getAnimeList = () => localAnimeList;')).toBe(true);
  });
});
