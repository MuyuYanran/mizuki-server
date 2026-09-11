import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [Phase5-E1b/T1] 新建 slug 契约 e2e（+2 申报制，架构师授权 2026-09-08）
 *
 * 根因铁证（浏览器复现，127.0.0.1:21560 Chrome DevTools 抓包）：
 *   Markdown 面板（PostEditPage onSave）新建分支 slug: newSlug.value 空串直发（B3
 *   491aeff 引入面板起即缺必填拦截）→ POST /admin/posts 400，detail.issues 两条：
 *     {"path":"slug","message":"Too small: expected string to have >=1 characters"}
 *     {"path":"slug","message":"slug 不得包含路径分隔符"}
 *   （singleSegmentName min(1) 与 regex(/^[^\\/]+$/) 的 + 量词对空串双重触发）
 *   对照：富文本面板（RichArticleEditPage slug || undefined 丢键）+ schema
 *   .optional() + 服务端自动生成 → 201，无此缺陷（覆盖面先确认，不赌「两个方式」语义）。
 *
 * 修复：面板侧 slug 必填拦截 + 字段级错误展示（web/PostEditPage.vue）；server schema
 *   零改动（空 slug 400 为正确行为，posts slug 为文件系统主键无自动生成机制）。
 *
 * 锚定：
 *   T1-① Markdown 面板新建体空 slug（buildFrontmatter 缺省形态逐字复刻）→ 400 +
 *        两条 slug issues 原文逐字断言（path+message 与根因逐条对应）；
 *   T1-② 富文本面板新建体省 slug 键（onSave `slug || undefined` 丢键语义复刻）
 *        → 201 + slug 自动生成（「两个方式」行为差异对照锚）。
 */
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-pe1b-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

describe('[Phase5-E1b] 新建 slug 契约 e2e', () => {
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
    // Windows 句柄释放延迟，重试后放弃（p1-security / app.e2e 同款模式；os.tmpdir 已出仓库）
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  function server(): request.SuperTest<request.Test> {
    return withAuth(request(app.getHttpServer()), () => accessToken);
  }

  it('T1-① Markdown 面板新建体空 slug → 400 + 两条 slug issues 原文（根因锚）', async () => {
    // PostEditPage buildFrontmatter 缺省形态逐字复刻（slug 空串 = 修复前面板直发体）
    const body = {
      slug: '',
      frontmatter: {
        title: 'E1b 锚定标题',
        description: '',
        pinned: false,
        draft: false,
        date: '2026-09-11',
        pubDate: '2026-09-11',
        lang: null,
        encrypted: null,
        password: null,
        comment: null,
        permalink: null,
      },
      content: '',
      form: 'dir',
    };
    const res = await server().post('/api/v1/admin/posts').send(body);
    expect(res.status).toBe(400);
    expect(res.body['code']).toBe('BadRequestException');
    const issues = (res.body['detail'] as { issues: { path: string; message: string }[] }).issues;
    // 根因逐条对应：min(1) 与 regex `+` 量词对空串双重触发，path 全为 slug
    // （path 为点号拼接字符串——zod-issues.spec 前端契约形状，非数组）
    expect(issues.map((i) => i.path)).toEqual(['slug', 'slug']);
    expect(issues.map((i) => i.message)).toEqual([
      'Too small: expected string to have >=1 characters',
      'slug 不得包含路径分隔符',
    ]);
  });

  it('T1-② 富文本面板新建体省 slug 键 → 201 + slug 自动生成（对照锚）', async () => {
    // RichArticleEditPage onSave `slug: meta.slug || undefined` 丢键语义复刻
    const body = {
      title: 'E1b 对照富文本',
      docJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      status: 'draft',
      pinned: false,
    };
    const res = await server().post('/api/v1/admin/articles').send(body);
    expect(res.status).toBe(201);
    // 服务端自动生成 slug（浏览器实测「浏览器复现富文本」→ '浏览器复现富文本' 同构）
    expect(typeof res.body['slug']).toBe('string');
    expect((res.body['slug'] as string).length).toBeGreaterThan(0);
  });
});
