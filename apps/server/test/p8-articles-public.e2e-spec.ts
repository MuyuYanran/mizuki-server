import 'reflect-metadata';
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
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { MediaReferenceRegistry } from '../src/common/registry/media-reference.registry';
import {
  ArticlePublishedPayload,
  ContentChangedPayload,
  EVENTS,
} from '../../../packages/shared/src/events';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * P8 §6.1–6.10 验收依据（supertest e2e，沿用 P6 装配 init + login）：
 * 两源交错分页、<script> 注入清除、未发布不可见、post.changed 增量索引、
 * article.published 缓存失效、公开免认证 + 守卫仍在、公开集合/相册、
 * 混合详情渲染、settings CRUD、articles 媒体引用注册。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p8-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 测试事件订阅者（P8 §6.5 / §6.9） */
class P8EventsSubscriber {
  static articlePublished: ArticlePublishedPayload[] = [];
  static contentChanged: ContentChangedPayload[] = [];

  @OnEvent(EVENTS.ArticlePublished)
  onArticlePublished(payload: unknown): void {
    P8EventsSubscriber.articlePublished.push(ArticlePublishedPayload.parse(payload));
  }

  @OnEvent(EVENTS.ContentChanged)
  onContentChanged(payload: unknown): void {
    P8EventsSubscriber.contentChanged.push(ContentChangedPayload.parse(payload));
  }
}

describe('P8 富文本与公开 API e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  let sqlite: Database.Database;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    P8EventsSubscriber.articlePublished = [];
    P8EventsSubscriber.contentChanged = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [P8EventsSubscriber],
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

  /** 简单 doc_json 构造器 */
  function doc(text: string): Record<string, unknown> {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
  }

  /** 轮询断言（订阅者为异步事件，给 2 秒窗口） */
  async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error('waitFor 超时：条件未成立');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // ── 预置：两源交错数据（§6.1） ──

  it('§6.1 预置：markdown 与 richtext 各 3 篇，发布时间交错', async () => {
    const mdDates: [string, string][] = [
      ['pub-md-a', '2026-03-01'],
      ['pub-md-b', '2026-05-01'],
      ['pub-md-c', '2026-07-01'],
    ];
    for (const [slug, date] of mdDates) {
      const res = await server()
        .post('/api/v1/admin/posts')
        .send({ slug, frontmatter: { title: `MD ${slug}`, description: `${slug} 描述`, pubDate: date }, content: `${slug} 正文` }); // [B2.1/裁决 8]
      expect(res.status).toBe(201);
    }
    const rtDates: [string, string][] = [
      ['pub-rt-a', '2026-04-01'],
      ['pub-rt-b', '2026-06-01'],
      ['pub-rt-c', '2026-08-01'],
    ];
    for (const [slug, date] of rtDates) {
      const res = await server()
        .post('/api/v1/admin/articles')
        .send({ title: `RT ${slug}`, slug, docJson: doc(`${slug} 正文`), status: 'published', pubDate: `${date}T00:00:00.000Z` });
      expect(res.status).toBe(201);
      expect(res.body.sourceType).toBeUndefined(); // 管理视图无该字段（source_type 恒定）
    }
  });

  it('§6.1 混合分页：降序、两源交错、翻页不重不漏', async () => {
    const page1 = await server().get('/api/v1/public/articles?page=1&limit=4');
    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBe(4);
    expect(page1.body.total).toBeGreaterThanOrEqual(6);

    const types = new Set((page1.body.items as { sourceType: string }[]).map((item) => item.sourceType));
    expect(types.has('markdown')).toBe(true); // 两源交错
    expect(types.has('richtext')).toBe(true);

    // pub_date 严格降序
    const dates = (page1.body.items as { pubDate: string }[]).map((item) => item.pubDate);
    for (const pubDate of dates) {
      expect(pubDate).not.toBeNull();
    }
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);

    // 翻页不重不漏
    const page2 = await server().get('/api/v1/public/articles?page=2&limit=4');
    expect(page2.status).toBe(200);
    const slugs1 = (page1.body.items as { slug: string }[]).map((item) => item.slug);
    const slugs2 = (page2.body.items as { slug: string }[]).map((item) => item.slug);
    for (const slug of slugs2) {
      expect(slugs1).not.toContain(slug);
    }
    expect(slugs1.length + slugs2.length).toBeGreaterThanOrEqual(6);
  });

  it('§6.1 分页参数：limit 超上限 50 → 400；默认参数可用', async () => {
    expect((await server().get('/api/v1/public/articles?limit=51')).status).toBe(400);
    const defaults = await server().get('/api/v1/public/articles');
    expect(defaults.status).toBe(200);
    expect(defaults.body.page).toBe(1);
    expect(defaults.body.limit).toBe(10);
  });

  // ── §6.2 XSS ──

  it('§6.2 <script> 注入被清除：html_cache 与公开详情均无 script/事件属性/javascript:', async () => {
    const evilDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert(1)</script> ' },
            { type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
        { type: 'image', attrs: { src: '" onerror="alert(1)', alt: 'inject' } },
      ],
    };
    const created = await server()
      .post('/api/v1/admin/articles')
      .send({ title: 'XSS 测试', slug: 'xss-test', docJson: evilDoc, status: 'published', pubDate: '2026-08-20T00:00:00.000Z' });
    expect(created.status).toBe(201);

    // 管理读回：html_cache 无危险内容
    const read = await server().get(`/api/v1/admin/articles/${created.body.id}`);
    expect(read.status).toBe(200);
    const cache = read.body.htmlCache as string;
    expect(cache).not.toContain('<script');
    expect(cache).not.toContain('onerror="');
    expect(cache).not.toContain('javascript:');

    // 公开详情：同样安全
    const detail = await request(app.getHttpServer()).get('/api/v1/public/articles/xss-test');
    expect(detail.status).toBe(200);
    expect(detail.body.html).not.toContain('<script');
    expect(detail.body.html).not.toContain('onerror="');
    expect(detail.body.html).not.toContain('javascript:');
  });

  it('§6.2 markdown 渲染同样过 sanitize：<script> 不出现在公开详情', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'xss-md',
        frontmatter: { title: 'XSS MD', description: 'XSS 描述', pubDate: '2026-08-21' },
        content: '正常段落。\n\n<script>alert(1)</script>',
      });
    expect(created.status).toBe(201);
    const detail = await request(app.getHttpServer()).get('/api/v1/public/articles/xss-md');
    expect(detail.status).toBe(200);
    expect(detail.body.sourceType).toBe('markdown');
    expect(detail.body.html).not.toContain('<script');
    expect(detail.body.html).toContain('<p>'); // 渲染标记存在
  });

  // ── §6.3 未发布不可见 ──

  it('§6.3 未发布不可见：draft（两源）与软删文章在公开列表/详情均不可见', async () => {
    // draft markdown
    await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'draft-md', frontmatter: { title: '草稿 MD', description: '草稿描述', draft: true }, content: 'x' }); // [B2.1/裁决 8]
    // draft richtext
    const draftRt = await server()
      .post('/api/v1/admin/articles')
      .send({ title: '草稿 RT', slug: 'draft-rt', docJson: doc('x'), status: 'draft' });
    expect(draftRt.status).toBe(201);
    // 已发布后软删的 richtext
    const softRt = await server()
      .post('/api/v1/admin/articles')
      .send({ title: '待软删 RT', slug: 'soft-rt', docJson: doc('x'), status: 'published', pubDate: '2026-08-22T00:00:00.000Z' });
    await server().delete(`/api/v1/admin/articles/${softRt.body.id}`);

    const list = await server().get('/api/v1/public/articles?limit=50');
    const slugs = (list.body.items as { slug: string }[]).map((item) => item.slug);
    expect(slugs).not.toContain('draft-md');
    expect(slugs).not.toContain('draft-rt');
    expect(slugs).not.toContain('soft-rt');

    expect((await request(app.getHttpServer()).get('/api/v1/public/articles/draft-md')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/api/v1/public/articles/draft-rt')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/api/v1/public/articles/soft-rt')).status).toBe(404);
  });

  // ── §6.4 post.changed 增量索引 ──

  it('§6.4 post.changed：新建/修改/删除触发索引增量维护（无需 sync）', async () => {
    // 新建 → 行出现（订阅者增量插入，未调用 sync）
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'inc-post', frontmatter: { title: '增量', description: '增量描述', pubDate: '2026-08-23' }, content: 'v1' }); // [B2.1/裁决 8]
    expect(created.status).toBe(201);
    await waitFor(() => {
      const row = sqlite.prepare("SELECT * FROM article WHERE slug = 'inc-post' AND source_type = 'markdown'").get();
      return row !== undefined;
    });
    const row = sqlite.prepare("SELECT * FROM article WHERE slug = 'inc-post'").get() as { file_hash: string; deleted_at: number | null };
    const hashV1 = row.file_hash;
    expect(hashV1).toMatch(/^[0-9a-f]{64}$/);

    // 修改 → 哈希变化
    await server().patch('/api/v1/admin/posts/inc-post').send({ content: 'v2 内容更长了' });
    await waitFor(() => {
      const updated = sqlite.prepare("SELECT file_hash FROM article WHERE slug = 'inc-post'").get() as { file_hash: string };
      return updated.file_hash !== hashV1;
    });

    // 删除 → 软删
    await server().delete('/api/v1/admin/posts/inc-post');
    await waitFor(() => {
      const deleted = sqlite.prepare("SELECT deleted_at FROM article WHERE slug = 'inc-post'").get() as { deleted_at: number | null };
      return deleted.deleted_at !== null;
    });
  });

  // ── §6.5 article.published 缓存失效 ──

  it('§6.5 缓存：公开列表建立缓存后，发布新富文本 → 再次请求出现新文章', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/public/articles');
    expect(before.status).toBe(200);
    expect((before.body.items as { slug: string }[]).some((item) => item.slug === 'cache-buster')).toBe(false);

    const created = await server()
      .post('/api/v1/admin/articles')
      .send({ title: '缓存破坏者', slug: 'cache-buster', docJson: doc('boom'), status: 'published', pubDate: '2026-08-25T00:00:00.000Z' });
    expect(created.status).toBe(201);

    const after = await request(app.getHttpServer()).get('/api/v1/public/articles');
    expect(after.status).toBe(200);
    expect((after.body.items as { slug: string }[]).some((item) => item.slug === 'cache-buster')).toBe(true);

    // article.published 事件断言（含 richtext 发射方）
    const published = P8EventsSubscriber.articlePublished.filter((e) => e.slug === 'cache-buster');
    expect(published.length).toBe(1);
    expect(published[0]!.sourceType).toBe('richtext');
  });

  // ── §6.6 公开免认证 + 守卫仍在 ──

  it('§6.6 公开路由免认证；/admin/articles 无 Token 仍 401', async () => {
    const bare = request(app.getHttpServer());
    expect((await bare.get('/api/v1/public/articles')).status).toBe(200);
    expect((await bare.get('/api/v1/public/articles/pub-md-a')).status).toBe(200);
    expect((await bare.get('/api/v1/admin/articles')).status).toBe(401);
  });

  // ── §6.7 公开集合与相册 ──

  it('§6.7 公开集合：diary 返回文件缓存数据；未知 type 400', async () => {
    const bare = request(app.getHttpServer());
    const diary = await bare.get('/api/v1/public/collections/diary');
    expect(diary.status).toBe(200);
    expect(Array.isArray(diary.body)).toBe(true);
    expect((await bare.get('/api/v1/public/collections/unknown')).status).toBe(400);
  });

  it('§6.7 公开相册：返回相册元信息与图片列表', async () => {
    // 先经 admin 建一个相册（含图片）
    const created = await server().post('/api/v1/admin/albums').send({ name: 'pub-album', info: { title: '公开相册' } });
    expect(created.status).toBe(201);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 9, b: 9 } } })
      .png()
      .toBuffer();
    const uploaded = await server().post('/api/v1/admin/albums/pub-album/images').attach('file', png, 'one.png');
    expect(uploaded.status).toBe(201);

    const bare = request(app.getHttpServer());
    const albums = await bare.get('/api/v1/public/albums');
    expect(albums.status).toBe(200);
    const album = (albums.body as { name: string; info: { title: string }; images: string[] }[]).find(
      (entry) => entry.name === 'pub-album',
    );
    expect(album?.info.title).toBe('公开相册');
    // [B2/裁决 2] 相册上传移除非 JPG 强转 JPG：png 原格式落盘，文件名不再是 one.jpg
    expect(album?.images).toContain('one.png');
  });

  // ── §6.8 混合详情渲染 ──

  it('§6.8 混合详情：markdown 返回渲染后 sanitized HTML + frontmatter；richtext 返回 html_cache', async () => {
    const md = await request(app.getHttpServer()).get('/api/v1/public/articles/pub-md-a');
    expect(md.status).toBe(200);
    expect(md.body.sourceType).toBe('markdown');
    expect(md.body.html).toContain('<p>');
    expect(md.body.frontmatter.title).toBe('MD pub-md-a');

    const rtRead = await server().get('/api/v1/admin/articles');
    const rtItem = (rtRead.body as { id: string; slug: string }[]).find((item) => item.slug === 'pub-rt-a');
    expect(rtItem).toBeDefined();
    const adminView = await server().get(`/api/v1/admin/articles/${rtItem!.id}`);
    const rt = await request(app.getHttpServer()).get('/api/v1/public/articles/pub-rt-a');
    expect(rt.status).toBe(200);
    expect(rt.body.sourceType).toBe('richtext');
    expect(rt.body.html).toBe(adminView.body.htmlCache);
  });

  // ── §6.9 settings ──

  it('§6.9 settings：PUT/GET/DELETE 往返一致 + content.changed(scope=settings)', async () => {
    const put = await server().put('/api/v1/admin/settings/theme').send({ value: { mode: 'dark', accent: '#3b82f6' } });
    expect(put.status).toBe(200);

    const all = await server().get('/api/v1/admin/settings');
    expect(all.status).toBe(200);
    expect(all.body['theme']).toEqual({ mode: 'dark', accent: '#3b82f6' });

    const removed = await server().delete('/api/v1/admin/settings/theme');
    expect(removed.status).toBe(200);
    const afterDelete = await server().get('/api/v1/admin/settings');
    expect(afterDelete.body['theme']).toBeUndefined();
    expect((await server().delete('/api/v1/admin/settings/theme')).status).toBe(404);

    const settingsEvents = P8EventsSubscriber.contentChanged.filter((e) => e.scope === 'settings');
    expect(settingsEvents.length).toBeGreaterThanOrEqual(2); // PUT + DELETE
    expect(settingsEvents[0]!.filePaths).toEqual([]);
  });

  // ── §6.10 articles 媒体引用注册 ──

  it('§6.10 articles 贡献者就位：带 cover 引用删媒体 → 409', async () => {
    const registry = app.get(MediaReferenceRegistry);
    expect(registry.names()).toContain('articles');

    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 10, b: 10 } } })
      .png()
      .toBuffer();
    const uploaded = await server().post('/api/v1/admin/media').attach('file', png, 'cover-src.png');
    expect(uploaded.status).toBe(201);
    const mediaId = uploaded.body.id as string;

    const created = await server()
      .post('/api/v1/admin/articles')
      .send({ title: '带封面', slug: 'with-cover', docJson: doc('x'), status: 'draft', cover: uploaded.body.path });
    expect(created.status).toBe(201);

    const denied = await server().delete(`/api/v1/admin/media/${mediaId}`);
    expect(denied.status).toBe(409);
    const refs = denied.body.detail.references as { refType: string; targetLabel: string }[];
    expect(refs.some((ref) => ref.refType === 'article-cover' && ref.targetLabel === 'with-cover')).toBe(true);
  });
});
