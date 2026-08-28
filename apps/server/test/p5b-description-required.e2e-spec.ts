import 'reflect-metadata';
import { createHash } from 'node:crypto';
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
 * [B2.1/裁决 8] posts description 服务端必填（SPEC-ALIGNMENT-B4 T4-8）：
 * ① 创建缺 description → 400（ZodValidationPipe 写前校验），文章目录/文件零落盘；
 * ② PATCH description="" → 400，md 文件 sha256 前后相等（字节不变）。
 * 错误形态走既有 pipe → 400 {code, message, detail.issues}（P1 语义），无新造格式。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5b-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

describe('B2.1 裁决 8：posts description 服务端必填 e2e', () => {
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

  it('创建缺 description → 400 且文章目录零落盘（写前校验）', async () => {
    const res = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'no-desc', frontmatter: { title: '缺描述' }, content: 'x' });
    expect(res.status).toBe(400);
    // P1 语义错误形态：detail.issues 指向 frontmatter.description
    const issues = (res.body as { detail?: { issues?: { path: string }[] } }).detail?.issues ?? [];
    expect(issues.some((issue) => issue.path === 'frontmatter.description')).toBe(true);
    // 写前校验：目录与文件均未落盘
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/no-desc'))).toBe(false);
  });

  it('PATCH description="" → 400 且 md 文件 sha256 前后相等（字节不变）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'has-desc',
        frontmatter: { title: '有描述', description: '原始描述' },
        content: '原始正文。',
      });
    expect(created.status).toBe(201);

    const fileAbs = path.join(mizukiRoot, 'src/content/posts/has-desc/index.md');
    const before = createHash('sha256').update(fs.readFileSync(fileAbs), 'utf8').digest('hex');

    const patched = await server()
      .patch('/api/v1/admin/posts/has-desc')
      .send({ frontmatter: { description: '' } });
    expect(patched.status).toBe(400);
    const issues = (patched.body as { detail?: { issues?: { path: string }[] } }).detail?.issues ?? [];
    expect(issues.some((issue) => issue.path === 'frontmatter.description')).toBe(true);

    const after = createHash('sha256').update(fs.readFileSync(fileAbs), 'utf8').digest('hex');
    expect(after).toBe(before);
  });
});
