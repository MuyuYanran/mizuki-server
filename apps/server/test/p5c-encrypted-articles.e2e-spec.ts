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
 * [Phase3-C1] 文章密码锁字段面与公开 API 双泄漏点修复 e2e（REQUIREMENTS-PHASE3 §1.2）：
 * - 泄漏点 A（条件清空）：encrypted === true → 公开详情 html 固定 ''；
 * - 泄漏点 B（无条件剥离）：password 永不出公开 frontmatter（无论 encrypted 与否）；
 * - 管理端读回零改动：password 保留（管理员可编辑）；
 * - PATCH 删键语义：四可删键 incoming null → 从合并结果删除；非 null 改值生效；
 * - 加密态稳定：PATCH 正文不清除加密态（公开面持续不泄露明文）。
 * 写入口纪律：创建体含 description（[B2.1/裁决 8]）；fixture 零变更（全部经 API 创建）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5c-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

describe('P5c 加密文章与公开 API 泄漏点修复 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  let sqlite: Database.Database;

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
    sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    sqlite.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  it('§1 加密文章公开详情：html 为空串、frontmatter 无 password、其余字段保留', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'enc-article',
        frontmatter: {
          title: '加密文章',
          description: '加密文章描述',
          encrypted: true,
          password: 'your-secret-password',
          pubDate: '2026-08-29',
        },
        content: '机密正文，不应出现在公开面。',
      });
    expect(created.status).toBe(201);

    const detail = await request(app.getHttpServer()).get('/api/v1/public/articles/enc-article');
    expect(detail.status).toBe(200);
    expect(detail.body.sourceType).toBe('markdown');
    expect(detail.body.html).toBe(''); // 泄漏点 A：加密文章正文不出公开面
    expect(Object.keys(detail.body.frontmatter)).not.toContain('password'); // 泄漏点 B
    expect(detail.body.frontmatter.encrypted).toBe(true);
    expect(detail.body.frontmatter.title).toBe('加密文章');
    expect(detail.body.title).toBe('加密文章');
  });

  it('§2 非加密文章手写 password：公开详情 html 明文非空且 frontmatter 无 password（无条件剥离）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'plain-with-password',
        frontmatter: {
          title: '非加密带密码字段',
          description: '非加密描述',
          password: 'leaked-if-visible',
          pubDate: '2026-08-29',
        },
        content: '普通正文',
      });
    expect(created.status).toBe(201);

    const detail = await request(app.getHttpServer()).get('/api/v1/public/articles/plain-with-password');
    expect(detail.status).toBe(200);
    expect(detail.body.sourceType).toBe('markdown');
    expect(detail.body.html).toContain('<p>'); // 非加密文章 html 行为不变（明文渲染）
    expect(detail.body.html).toContain('普通正文');
    expect(Object.keys(detail.body.frontmatter)).not.toContain('password'); // 剥离不限于加密文章
  });

  it('§3 管理端读回加密文章：password 保留（管理员可编辑）', async () => {
    const read = await server().get('/api/v1/admin/posts/enc-article');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter.password).toBe('your-secret-password');
    expect(read.body.frontmatter.encrypted).toBe(true);
    expect(read.body.content).toBe('机密正文，不应出现在公开面。');
  });

  it('§4 comment:false + permalink 创建：管理端读回两键保真（已知字段往返）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'comment-permalink',
        frontmatter: {
          title: '评论与固定链接',
          description: '评论固定链接描述',
          comment: false,
          permalink: 'encrypted-example',
          pubDate: '2026-08-29',
        },
        content: 'x',
      });
    expect(created.status).toBe(201);
    expect(created.body.frontmatter.comment).toBe(false);
    expect(created.body.frontmatter.permalink).toBe('encrypted-example');

    const read = await server().get('/api/v1/admin/posts/comment-permalink');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter.comment).toBe(false);
    expect(read.body.frontmatter.permalink).toBe('encrypted-example');
  });

  it('§5 PATCH 删键与改值：comment:null → 读回无该键；permalink 改新值生效', async () => {
    const patched = await server()
      .patch('/api/v1/admin/posts/comment-permalink')
      .send({ frontmatter: { comment: null } }); // null 哨兵 = 删除指令
    expect(patched.status).toBe(200);
    expect(Object.keys(patched.body.frontmatter)).not.toContain('comment');

    const rePatched = await server()
      .patch('/api/v1/admin/posts/comment-permalink')
      .send({ frontmatter: { permalink: 'new-fixed-link' } });
    expect(rePatched.status).toBe(200);
    expect(rePatched.body.frontmatter.permalink).toBe('new-fixed-link');

    const read = await server().get('/api/v1/admin/posts/comment-permalink');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter.permalink).toBe('new-fixed-link');
  });

  it('[Phase4-D4/A3] §5b lang:null → 读回无 lang 键（C1 删键哨兵扩展至 lang，draft 不受牵连）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'lang-draft-delete',
        frontmatter: {
          title: '语言与草稿字段',
          description: '语言与草稿字段描述',
          lang: 'zh-CN',
          draft: true,
          pubDate: '2026-08-29',
        },
        content: 'x',
      });
    expect(created.status).toBe(201);
    expect(created.body.frontmatter.lang).toBe('zh-CN');
    expect(created.body.frontmatter.draft).toBe(true);

    const patched = await server()
      .patch('/api/v1/admin/posts/lang-draft-delete')
      .send({ frontmatter: { lang: null } }); // null 哨兵 = 删除指令
    expect(patched.status).toBe(200);
    expect(Object.keys(patched.body.frontmatter)).not.toContain('lang');
    expect(patched.body.frontmatter.draft).toBe(true); // 邻键零牵连

    const read = await server().get('/api/v1/admin/posts/lang-draft-delete');
    expect(read.status).toBe(200);
    expect(Object.keys(read.body.frontmatter)).not.toContain('lang');
    expect(read.body.frontmatter.draft).toBe(true);
  });

  it('[Phase4-D4/A3] §5c draft:null → 读回无 draft 键（可空性为入口通行前提）', async () => {
    const patched = await server()
      .patch('/api/v1/admin/posts/lang-draft-delete')
      .send({ frontmatter: { draft: null } });
    expect(patched.status).toBe(200);
    expect(Object.keys(patched.body.frontmatter)).not.toContain('draft');

    const read = await server().get('/api/v1/admin/posts/lang-draft-delete');
    expect(read.status).toBe(200);
    expect(Object.keys(read.body.frontmatter)).not.toContain('draft');
  });

  it('§6 加密文章 PATCH 正文：公开详情仍 html 为空串（修改不清除加密态）', async () => {
    const patched = await server()
      .patch('/api/v1/admin/posts/enc-article')
      .send({ content: '修改后的机密正文。' });
    expect(patched.status).toBe(200);

    const detail = await request(app.getHttpServer()).get('/api/v1/public/articles/enc-article');
    expect(detail.status).toBe(200);
    expect(detail.body.html).toBe('');
    expect(detail.body.frontmatter.encrypted).toBe(true);
    expect(Object.keys(detail.body.frontmatter)).not.toContain('password');
  });
});
