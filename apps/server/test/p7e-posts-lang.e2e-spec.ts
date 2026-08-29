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
 * [Phase3-C5] posts lang 字段（i18n Server 侧收口，官方 frontmatter 可选字段，
 * other-structure.md 快照示例 zh-CN；C1 对齐疏漏收口）：
 * ① POST 带 lang='en' → 201 且回读一致（管理端 + 公开详情随对象自然返回）；
 * ② POST 带 lang='e n'（内嵌空白）→ 400（BCP-47 简码字符集）；
 * ③ POST 带 lang 超长（'zh-Hant-TW-extra-long'，21 > max 16）→ 400；
 * ④ POST 不带 lang → 201 且字段缺省（optional 锚：落盘 frontmatter 无 lang 键）。
 * 语义注记：trim 剪缘空白、空串归一为未设置、不 enum 化（C2b 教训）；错误形态走
 * 既有 ZodValidationPipe → 400 {code, message, detail.issues}（P1 语义）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7e-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

describe('Phase3-C5：posts lang 字段 e2e', () => {
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
    // Windows 句柄释放延迟：重试清理，最终失败不阻塞套件（.tmpvitest 已 gitignore）
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

  const issuesOf = (res: { body: unknown }): { path: string }[] => {
    const body = res.body as { detail?: { issues?: { path: string }[] } };
    return body.detail?.issues ?? [];
  };

  it('① POST 带 lang="en" → 201 且回读一致（管理端 + 公开详情自然返回）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'lang-en',
        frontmatter: { title: '语言文章', description: '有语言', lang: 'en' },
        content: '正文。',
      });
    expect(created.status).toBe(201);
    expect(created.body.frontmatter).toMatchObject({ lang: 'en' });

    const read = await server().get('/api/v1/admin/posts/lang-en');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter).toMatchObject({ lang: 'en' });

    // 公开 API 路径与形状零变化：lang 属内容面随对象自然返回（架构师授权 additive 例外）
    const pub = await request(app.getHttpServer()).get('/api/v1/public/articles/lang-en');
    expect(pub.status).toBe(200);
    expect((pub.body as { frontmatter?: Record<string, unknown> }).frontmatter?.['lang']).toBe('en');
  });

  it('② POST 带 lang="e n"（内嵌空白）→ 400 且目录零落盘', async () => {
    const res = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'lang-bad-space',
        frontmatter: { title: '非法语言', description: '描述', lang: 'e n' },
        content: 'x',
      });
    expect(res.status).toBe(400);
    expect(issuesOf(res).some((issue) => issue.path === 'frontmatter.lang')).toBe(true);
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/lang-bad-space'))).toBe(false);
  });

  it('③ POST 带 lang 超长（21 字符 > max 16）→ 400', async () => {
    const res = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'lang-too-long',
        frontmatter: { title: '超长语言', description: '描述', lang: 'zh-Hant-TW-extra-long' },
        content: 'x',
      });
    expect(res.status).toBe(400);
    expect(issuesOf(res).some((issue) => issue.path === 'frontmatter.lang')).toBe(true);
  });

  it('④ POST 不带 lang → 201 且字段缺省（落盘 frontmatter 无 lang 键）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'lang-absent', frontmatter: { title: '无语言', description: '描述' }, content: 'x' });
    expect(created.status).toBe(201);
    expect(created.body.frontmatter).not.toHaveProperty('lang');

    const read = await server().get('/api/v1/admin/posts/lang-absent');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter).not.toHaveProperty('lang');
  });
});
