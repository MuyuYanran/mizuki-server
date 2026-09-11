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
 * [Wave-2 / B2] slug 全局唯一护栏（缺陷闭合锚）
 *
 * 缺陷原状：`article.slug` 为 UNIQUE 列且富文本与 markdown 共用；markdown 侧
 *   只查文件系统不查库。序列「先建富文本 slug=X → 再建同 slug markdown 文章」
 *   会走到 insert → SQLite UNIQUE 违约 → 未捕获异常 → **500**，
 *   且此时源文件**已落盘**（createPost 先写盘后插索引）→ 盘上残留孤儿文章。
 *
 * 修复后语义（本文件即锚）：
 *   ① 富文本占用 slug → markdown 创建 **409**（原 500）；
 *   ② **盘上零残留**（守卫在落盘之前执行）——半成功状态不再可能；
 *   ③ sync 对占用 slug **跳过并告警**，不整批中断（sync 属对账语义，非用户操作）；
 *   ④ 对照组：未被占用的 slug 仍正常 201（确证 409 是定向拦截而非普遍性拦截）。
 */
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5d-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** markdown 目录式落盘路径（断言「零残留」用） */
const postDir = (slug: string): string => path.join(mizukiRoot, 'src/content/posts', slug);

describe('[Wave-2/B2] posts × articles slug 唯一性护栏 e2e', () => {
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  /** 建一篇富文本文章（占用 slug） */
  async function createRichText(slug: string): Promise<void> {
    const res = await server()
      .post('/api/v1/admin/articles')
      .send({ title: `富文本 ${slug}`, docJson: { type: 'doc' }, slug });
    expect(res.status).toBe(201);
  }

  it('①富文本已占用 slug → markdown 创建 409（原为 500）', async () => {
    await createRichText('clash-slug');

    const res = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'clash-slug', frontmatter: { title: '同名文章' }, content: '正文' });

    expect(res.status).toBe(409);
    expect(String(res.body.message)).toContain('已被富文本文章占用');
  });

  it('②盘上零残留：守卫在落盘之前生效，不产生半成功孤儿文件', () => {
    expect(fs.existsSync(postDir('clash-slug'))).toBe(false);
    expect(fs.existsSync(path.join(postDir('clash-slug'), 'index.md'))).toBe(false);
  });

  it('③sync 遇占用 slug 跳过而不整批中断（响应形状不变）', async () => {
    // 在盘上放一篇与富文本同 slug 的文件式文章，制造 sync 冲突
    const postsDir = path.join(mizukiRoot, 'src/content/posts');
    fs.mkdirSync(postsDir, { recursive: true });
    fs.writeFileSync(
      path.join(postsDir, 'clash-slug.md'),
      '---\ntitle: 盘上同名\n---\n正文\n',
      'utf8',
    );

    const res = await server().post('/api/v1/admin/posts/sync');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      scanned: expect.any(Number),
      inserted: expect.any(Number),
      updated: expect.any(Number),
      softDeleted: expect.any(Number),
    });
  });

  it('④对照组：未被占用的 slug 仍正常创建 201 + 落盘', async () => {
    const res = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'free-slug', frontmatter: { title: '自由 slug' }, content: '正文' });

    expect(res.status).toBe(201);
    expect(fs.existsSync(path.join(postDir('free-slug'), 'index.md'))).toBe(true);
  });
});
