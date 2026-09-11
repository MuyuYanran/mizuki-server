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
 * [Phase4-D4/S5] posts description 可选（架构师裁定 supersede B2.1/裁决 8 = P5b，
 * 2026-09-04，授权随批提交 + commit 明文披露）。文件名沿用 p5b-description-required
 * 未改（历史必填裁定全案与翻转披露见 SESSIONS supersession 记录）：
 * ① 创建缺 description → 201，读回无 description 键（缺省合法）；
 * ② PATCH description="" → 200，读回 description === ''（空串为合法存储值）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5b-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

describe('Phase4-D4/S5：posts description 可选（supersede P5b/B2.1 裁决 8）e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true }); // fixture 唯一数据源：先 cp 再操作
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  it('①创建缺 description → 201 且读回无 description 键（缺省合法）', async () => {
    const res = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'no-desc', frontmatter: { title: '缺描述' }, content: 'x' });
    expect(res.status).toBe(201);
    // 可选语义下正常创建落盘
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/no-desc/index.md'))).toBe(true);

    const read = await server().get('/api/v1/admin/posts/no-desc');
    expect(read.status).toBe(200);
    expect(
      Object.keys((read.body as { frontmatter: Record<string, unknown> }).frontmatter),
    ).not.toContain('description');
  });

  it('②PATCH description="" → 200 且读回空串（空串为合法存储值）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'has-desc',
        frontmatter: { title: '有描述', description: '原始描述' },
        content: '原始正文。',
      });
    expect(created.status).toBe(201);

    const patched = await server()
      .patch('/api/v1/admin/posts/has-desc')
      .send({ frontmatter: { description: '' } });
    expect(patched.status).toBe(200);

    const read = await server().get('/api/v1/admin/posts/has-desc');
    expect(read.status).toBe(200);
    expect((read.body as { frontmatter: { description?: string } }).frontmatter.description).toBe('');
  });
});
