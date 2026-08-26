import 'reflect-metadata';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OnEvent } from '@nestjs/event-emitter';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS, BackupService } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import {
  ArticlePublishedPayload,
  ContentChangedPayload,
  EVENTS,
  PostChangedPayload,
} from '../../../packages/shared/src/events';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * P5 §6.1–6.8 验收依据（supertest e2e，数据源 = fixture 假 Mizuki 项目临时副本）：
 * CRUD、路径穿越拒绝、frontmatter 往返保真、封面转 JPG、删除经备份恢复、
 * sync 幂等、事件断言（post.changed / article.published / content.changed）、about。
 * [P6 守卫适配] beforeAll 中 init + login 取得 access token，
 * 全部请求经 withAuth 代理自动附加（适配方式见 P6 交付报告 §6.11）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 测试事件订阅者（P5 §6.6）：三个事件的 payload 均过 zod parse 后收集 */
class PostEventsSubscriber {
  static postChanged: PostChangedPayload[] = [];
  static articlePublished: ArticlePublishedPayload[] = [];
  static contentChanged: ContentChangedPayload[] = [];

  @OnEvent(EVENTS.PostChanged)
  onPostChanged(payload: unknown): void {
    PostEventsSubscriber.postChanged.push(PostChangedPayload.parse(payload));
  }

  @OnEvent(EVENTS.ArticlePublished)
  onArticlePublished(payload: unknown): void {
    PostEventsSubscriber.articlePublished.push(ArticlePublishedPayload.parse(payload));
  }

  @OnEvent(EVENTS.ContentChanged)
  onContentChanged(payload: unknown): void {
    PostEventsSubscriber.contentChanged.push(ContentChangedPayload.parse(payload));
  }
}

describe('P5 Markdown 文章 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    PostEventsSubscriber.postChanged = [];
    PostEventsSubscriber.articlePublished = [];
    PostEventsSubscriber.contentChanged = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [PostEventsSubscriber],
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
    // [P6] 守卫适配：初始化 + 登录取得 access token
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  const fullFrontmatter: Record<string, unknown> = {
    title: '保真验收',
    published: true,
    description: 'SEO 摘要文本',
    tags: ['标签甲', '标签乙'],
    category: '随笔',
    author: '暮雨',
    permalink: '/posts/fm-round',
    pinned: true,
    draft: false,
    image: 'old.png',
    date: '2026-08-26',
    pubDate: '2026-08-26',
    customExtra: '自定义额外字段',
  };

  it('§6.1 CRUD：创建文章 → 读回断言', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'e2e-first', frontmatter: { title: '第一篇', tags: ['x'] }, content: '初始正文。' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('e2e-first');

    const read = await server().get('/api/v1/admin/posts/e2e-first');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter.title).toBe('第一篇');
    expect(read.body.content).toBe('初始正文。');
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/e2e-first/index.md'))).toBe(true);
  });

  it('§6.1 CRUD：修改（frontmatter 与正文）→ 读回断言', async () => {
    const patched = await server()
      .patch('/api/v1/admin/posts/e2e-first')
      .send({ frontmatter: { title: '改后标题', pinned: true }, content: '改后正文。' });
    expect(patched.status).toBe(200);
    expect(patched.body.frontmatter.title).toBe('改后标题');
    // 未提供的字段保持（增量合并）
    expect(patched.body.frontmatter.tags).toEqual(['x']);

    const read = await server().get('/api/v1/admin/posts/e2e-first');
    expect(read.body.frontmatter.title).toBe('改后标题');
    expect(read.body.frontmatter.pinned).toBe(true);
    expect(read.body.content).toBe('改后正文。');
  });

  it('§6.1 CRUD：删除 → 目录不存在 → GET 404', async () => {
    const removed = await server().delete('/api/v1/admin/posts/e2e-first');
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/e2e-first'))).toBe(false);
    expect((await server().get('/api/v1/admin/posts/e2e-first')).status).toBe(404);
  });

  it('§6.1 路径穿越：slug 含 ../ 的请求被拒（400/403）', async () => {
    const viaBody = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: '../evil', frontmatter: { title: 'x' }, content: 'x' });
    expect([400, 403]).toContain(viaBody.status);
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/evil'))).toBe(false);

    const viaParam = await server().get('/api/v1/admin/posts/..%2Fevil');
    expect([400, 403]).toContain(viaParam.status);

    const viaDelete = await server().delete('/api/v1/admin/posts/..%2Fevil');
    expect([400, 403]).toContain(viaDelete.status);
  });

  it('§6.3 frontmatter 往返：12 已知字段 + 自定义字段，集合一致、类型不变', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'fm-round', frontmatter: fullFrontmatter, content: '保真正文。' });
    expect(created.status).toBe(201);

    const read = await server().get('/api/v1/admin/posts/fm-round');
    expect(read.status).toBe(200);
    const fm = read.body.frontmatter as Record<string, unknown>;
    // 字段集合一致（自定义字段保留，不增不减）
    expect(Object.keys(fm).sort()).toEqual(Object.keys(fullFrontmatter).sort());
    // 类型不变
    expect(fm['published']).toBe(true);
    expect(fm['pinned']).toBe(true);
    expect(fm['draft']).toBe(false);
    expect(Array.isArray(fm['tags'])).toBe(true);
    expect(fm['tags']).toEqual(['标签甲', '标签乙']);
    expect(typeof fm['title']).toBe('string');
    expect(typeof fm['description']).toBe('string');
    // 自定义额外字段原样保留
    expect(fm['customExtra']).toBe('自定义额外字段');
    expect(read.body.content).toBe('保真正文。');
  });

  it('§6.4 封面上传：PNG → cover.jpg 为 JPEG 且 frontmatter.image 更新', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 60, b: 60 } },
    })
      .png()
      .toBuffer();
    const res = await server().post('/api/v1/admin/posts/fm-round/cover').attach('file', png, 'cover.png');
    expect(res.status).toBe(201);

    const coverAbs = path.join(mizukiRoot, 'src/content/posts/fm-round/cover.jpg');
    expect(fs.existsSync(coverAbs)).toBe(true);
    const meta = await sharp(coverAbs).metadata();
    expect(meta.format).toBe('jpeg');

    const read = await server().get('/api/v1/admin/posts/fm-round');
    expect(read.body.frontmatter.image).toBe('cover.jpg');
  });

  it('§6.4 封面上传：伪造扩展名（文本改名 .png）被拒', async () => {
    const fake = Buffer.from('这不是图片，是纯文本。');
    const res = await server().post('/api/v1/admin/posts/fm-round/cover').attach('file', fake, 'fake.png');
    expect(res.status).toBe(400);
  });

  it('§6.2 删除可恢复：删除后经备份恢复，目录与内容完整回来', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'restore-me', frontmatter: { title: '待恢复' }, content: '恢复验收正文。' });
    expect(created.status).toBe(201);

    const removed = await server().delete('/api/v1/admin/posts/restore-me');
    expect(removed.status).toBe(200);
    const backupIds = removed.body.backupIds as string[];
    expect(backupIds.length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/restore-me'))).toBe(false);

    for (const id of backupIds) {
      const restored = await server().post(`/api/v1/admin/backups/${id}/restore`).send({ confirm: true });
      expect(restored.status).toBe(200);
    }
    const fileAbs = path.join(mizukiRoot, 'src/content/posts/restore-me/index.md');
    expect(fs.existsSync(fileAbs)).toBe(true);
    const read = await server().get('/api/v1/admin/posts/restore-me');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter.title).toBe('待恢复');
    expect(read.body.content).toBe('恢复验收正文。');
  });

  it('§6.5 sync：3 篇文章入库，file_hash 为 sha256', async () => {
    // 预置第 3 篇（直接写盘，无索引行，覆盖 sync 的 insert 路径）
    const manualDir = path.join(mizukiRoot, 'src/content/posts/manual-post');
    fs.mkdirSync(manualDir, { recursive: true });
    fs.writeFileSync(
      path.join(manualDir, 'index.md'),
      '---\ntitle: 手动预置\ndraft: true\ndate: 2026-08-20\n---\n\n手动预置正文。\n',
    );

    const res = await server().post('/api/v1/admin/posts/sync');
    expect(res.status).toBe(201);
    expect(res.body.scanned).toBeGreaterThanOrEqual(3);

    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const rows = sqlite
      .prepare("SELECT slug, file_hash, status, file_path FROM article WHERE source_type = 'markdown' AND deleted_at IS NULL ORDER BY slug")
      .all() as { slug: string; file_hash: string; status: string; file_path: string }[];
    const slugs = rows.map((row) => row.slug);
    for (const expected of ['hello-world', 'manual-post', 'fm-round']) {
      expect(slugs).toContain(expected);
    }
    for (const row of rows) {
      const fileAbs = path.join(mizukiRoot, row.file_path);
      const expectedHash = createHash('sha256').update(fs.readFileSync(fileAbs, 'utf8')).digest('hex');
      expect(row.file_hash).toBe(expectedHash);
    }
    // 手动预置（draft: true）状态推导正确
    expect(rows.find((row) => row.slug === 'manual-post')?.status).toBe('draft');
  });

  it('§6.5 sync 幂等：第二次执行不产生任何写', async () => {
    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const snapshot = JSON.stringify(
      sqlite.prepare("SELECT * FROM article WHERE source_type = 'markdown' ORDER BY slug").all(),
    );

    const res = await server().post('/api/v1/admin/posts/sync');
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(0);
    expect(res.body.updated).toBe(0);
    expect(res.body.softDeleted).toBe(0);

    const after = JSON.stringify(
      sqlite.prepare("SELECT * FROM article WHERE source_type = 'markdown' ORDER BY slug").all(),
    );
    expect(after).toBe(snapshot);
  });

  it('§6.6 事件：创建/修改后收到 post.changed（deleted:false）与 content.changed（scope=post）', () => {
    const created = PostEventsSubscriber.postChanged.filter((e) => e.slug === 'e2e-first' && !e.deleted);
    expect(created.length).toBeGreaterThanOrEqual(2); // create + update
    for (const event of created) {
      expect(typeof event.fileHash).toBe('string');
      expect(event.frontmatter['title']).toBeDefined();
    }
    const contentEvents = PostEventsSubscriber.contentChanged.filter(
      (e) => e.scope === 'post' && e.filePaths.includes('src/content/posts/e2e-first/index.md'),
    );
    expect(contentEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('§6.6 事件：删除后收到 post.changed 且 deleted:true', () => {
    const deleted = PostEventsSubscriber.postChanged.filter((e) => e.slug === 'e2e-first' && e.deleted);
    expect(deleted.length).toBe(1);
    // 删除场景：frontmatter 为删除前的值、fileHash 为删除前哈希
    expect(deleted[0]!.frontmatter['title']).toBe('改后标题');
    expect(deleted[0]!.fileHash.length).toBe(64);
  });

  it('§6.6 事件：草稿转发布收到 article.published（sourceType=markdown）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'draft-flip', frontmatter: { title: '草稿转正', draft: true }, content: 'x' });
    expect(created.status).toBe(201);
    expect(PostEventsSubscriber.articlePublished.some((e) => e.slug === 'draft-flip')).toBe(false);

    const patched = await server()
      .patch('/api/v1/admin/posts/draft-flip')
      .send({ frontmatter: { draft: false } });
    expect(patched.status).toBe(200);

    const published = PostEventsSubscriber.articlePublished.filter((e) => e.slug === 'draft-flip');
    expect(published.length).toBe(1);
    expect(published[0]!.sourceType).toBe('markdown');
    expect(published[0]!.title).toBe('草稿转正');
    expect(published[0]!.id.length).toBeGreaterThan(0);
  });

  it('§6.7 about：写入/读回/备份/恢复回到旧内容', async () => {
    expect((await server().get('/api/v1/admin/about')).status).toBe(404);

    const put1 = await server().put('/api/v1/admin/about').send({ content: '# About\n\nv1 内容' });
    expect(put1.status).toBe(200);
    expect((await server().get('/api/v1/admin/about')).body.content).toBe('# About\n\nv1 内容');

    const put2 = await server().put('/api/v1/admin/about').send({ content: '# About\n\nv2 内容' });
    expect(put2.status).toBe(200);
    expect((await server().get('/api/v1/admin/about')).body.content).toBe('# About\n\nv2 内容');

    // pre_write 快照存在（manifest 含 about.md 原路径）
    const backups = await app.get(BackupService).listBackups();
    const aboutBackup = backups.find((b) => b.scope === 'pre_write' && readManifestPaths(b.manifestPath).includes('src/content/spec/about.md'));
    expect(aboutBackup).toBeDefined();

    // 经备份恢复 → 回到旧内容（v1）
    const restored = await server()
      .post(`/api/v1/admin/backups/${aboutBackup!.id}/restore`)
      .send({ confirm: true });
    expect(restored.status).toBe(200);
    expect((await server().get('/api/v1/admin/about')).body.content).toBe('# About\n\nv1 内容');
  });

  it('§6.6 事件：PUT about 后收到 content.changed（scope=about）', () => {
    const aboutEvents = PostEventsSubscriber.contentChanged.filter((e) => e.scope === 'about');
    expect(aboutEvents.length).toBeGreaterThanOrEqual(2);
    expect(aboutEvents[0]!.filePaths).toEqual(['src/content/spec/about.md']);
  });

  it('404/409：不存在的文章读写拒绝、重复 slug 拒绝', async () => {
    expect((await server().get('/api/v1/admin/posts/not-exists')).status).toBe(404);
    expect((await server().patch('/api/v1/admin/posts/not-exists').send({ content: 'x' })).status).toBe(404);
    expect((await server().delete('/api/v1/admin/posts/not-exists')).status).toBe(404);

    const duplicate = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'fm-round', frontmatter: { title: '重复' }, content: 'x' });
    expect(duplicate.status).toBe(409);
  });

  it('§6.1 列表：含全部现存文章与 frontmatter 摘要', async () => {
    const list = await server().get('/api/v1/admin/posts');
    expect(list.status).toBe(200);
    const slugs = (list.body as { slug: string }[]).map((item) => item.slug);
    expect(slugs).toContain('hello-world');
    expect(slugs).toContain('fm-round');
    const round = (list.body as { slug: string; status: string }[]).find((item) => item.slug === 'fm-round');
    expect(round?.status).toBe('published');
  });
});

/** 读 manifest.json 的原路径列表（测试辅助） */
function readManifestPaths(manifestPath: string): string[] {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      files?: { path: string }[];
    };
    return (manifest.files ?? []).map((entry) => entry.path);
  } catch {
    return [];
  }
}
