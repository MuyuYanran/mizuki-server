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
 * [Phase4-D4/B2] 追加文件形态四规则 e2e（B2-①~④）：sync 识别（filePath 实路径投影）/
 * 列表详情往返 / 写面 400 指引（删③·改·封④）/ 同名冲突目录式优先（②）。
 * fixture 增 standalone.md 单文件样例（授权项；全 spec 断言均为 >=/toContain 加法安全）。
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
      .send({ slug: 'e2e-first', frontmatter: { title: '第一篇', description: '首篇描述', tags: ['x'] }, content: '初始正文。' }); // [B2.1/裁决 8] 创建必填 description
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
      .send({ slug: 'restore-me', frontmatter: { title: '待恢复', description: '恢复描述' }, content: '恢复验收正文。' }); // [B2.1/裁决 8]
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
      .send({ slug: 'draft-flip', frontmatter: { title: '草稿转正', description: '转正描述', draft: true }, content: 'x' }); // [B2.1/裁决 8]
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
      .send({ slug: 'fm-round', frontmatter: { title: '重复', description: '重复描述' }, content: 'x' }); // [B2.1/裁决 8]（409 用例须先过 pipe 校验）
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

  // ── [Phase4-D4/B2] 文件形态四规则 e2e（fixture 增 standalone.md 单文件样例） ──

  it('B2-① sync 识别文件形态：standalone.md 入库且 filePath 为 .md 实路径、哈希与状态正确', async () => {
    // fixture 单文件样例已在 §6.5 sync 入库；此处复跑 sync 验证幂等 + 文件形态投影
    const res = await server().post('/api/v1/admin/posts/sync');
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(0); // 幂等零新增（已入库）

    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const row = sqlite
      .prepare(
        "SELECT file_path, file_hash, status FROM article WHERE slug = 'standalone' AND source_type = 'markdown' AND deleted_at IS NULL",
      )
      .get() as { file_path: string; file_hash: string; status: string } | undefined;
    expect(row).toBeDefined();
    // 规则①：slug = 文件名去 .md 直取；article.filePath = 文件形态 .md 实路径（禁目录形态硬编码）
    expect(row!.file_path).toBe('src/content/posts/standalone.md');
    const actual = fs.readFileSync(path.join(mizukiRoot, 'src/content/posts/standalone.md'), 'utf8');
    expect(row!.file_hash).toBe(createHash('sha256').update(actual).digest('hex'));
    expect(row!.status).toBe('published');
  });

  it('B2-② 列表/详情往返：文件形态文章在列表可见、GET 详情返回原文', async () => {
    const list = await server().get('/api/v1/admin/posts');
    expect(list.status).toBe(200);
    const item = (list.body as { slug: string; frontmatter: Record<string, unknown> }[]).find(
      (p) => p.slug === 'standalone',
    );
    expect(item).toBeDefined();
    expect(item!.frontmatter['title']).toBe('单文件样例');

    const detail = await server().get('/api/v1/admin/posts/standalone');
    expect(detail.status).toBe(200);
    expect(detail.body.frontmatter['description']).toBe('文件形态样例文章（无同名目录与 index.md）');
    expect(String(detail.body.content)).toContain('文件形态正文');
  });

  it('B2-③ 文件形态写面限制（C2 后剩余）：封面上传 400 指引（规则④；删除拒绝移交 C2-②）', async () => {
    // [Phase4-D4/C2] 原本锚的「PATCH 400 指引请直接编辑源文件」与「删除 400」两段：
    // PATCH 随编辑解除（supersede B2 只读分派）翻转为 200 往返（见 C2-①）；删除 400
    // 保留并扩断言（见 C2-②）。本锚剩余职责 = 规则④ 封面上传拒绝。
    const cover = await server()
      .post('/api/v1/admin/posts/standalone/cover')
      .attach('file', Buffer.from('fake-image-bytes'), 'cover.png');
    expect(cover.status).toBe(400);

    // 拒绝路径零副作用：盘上源文件仍在
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/standalone.md'))).toBe(true);
  });

  it('C2-① [Phase4-D4/C2] 文件形态编辑解除：PATCH frontmatter+内容往返、盘上字节正确、无影子分叉', async () => {
    // 编辑解除（产品裁定 supersede B2 只读分派，架构师授权 2026-09-08）：
    // file-form 与目录式共用读写管线，写回定位 = resolvePostFile 既有产物（.md 实路径）。
    const patch = await server()
      .patch('/api/v1/admin/posts/standalone')
      .send({
        frontmatter: { description: 'C2 编辑解除改写样例', published: '2026-09-08' },
        content: 'C2 往返正文（file-form 编辑解除验证）',
      });
    expect(patch.status).toBe(200);

    // 无影子分叉：原 .md 实路径被改写、不产生目录式复本
    const fileAbs = path.join(mizukiRoot, 'src/content/posts/standalone.md');
    expect(fs.existsSync(fileAbs)).toBe(true);
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/standalone/index.md'))).toBe(false);

    // 盘上字节正确：frontmatter 增量合并落盘（published 裸日期无引号 = S3 语义）
    const onDisk = fs.readFileSync(fileAbs, 'utf8');
    expect(onDisk).toContain('description: C2 编辑解除改写样例');
    expect(onDisk).toContain('published: 2026-09-08');
    expect(onDisk).toContain('C2 往返正文（file-form 编辑解除验证）');

    // 索引投影：filePath 恒 .md 实路径（禁目录形态硬编码）、哈希与盘上一致
    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const row = sqlite
      .prepare(
        "SELECT file_path, file_hash FROM article WHERE slug = 'standalone' AND source_type = 'markdown' AND deleted_at IS NULL",
      )
      .get() as { file_path: string; file_hash: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.file_path).toBe('src/content/posts/standalone.md');
    expect(row!.file_hash).toBe(createHash('sha256').update(onDisk).digest('hex'));

    // GET 回读往返一致
    const detail = await server().get('/api/v1/admin/posts/standalone');
    expect(detail.status).toBe(200);
    expect(detail.body.frontmatter['description']).toBe('C2 编辑解除改写样例');
    expect(String(detail.body.content)).toContain('C2 往返正文（file-form 编辑解除验证）');
  });

  it('C2-② [Phase4-D4/C2] 文件形态删除仍拒：400 指引 + 源文件/索引行零副作用（规则③保留）', async () => {
    const del = await server().delete('/api/v1/admin/posts/standalone');
    expect(del.status).toBe(400);
    expect(JSON.stringify(del.body)).toContain('请在文件系统删除源文件');

    // 零副作用：盘上源文件仍在、索引行未软删
    expect(fs.existsSync(path.join(mizukiRoot, 'src/content/posts/standalone.md'))).toBe(true);
    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const row = sqlite
      .prepare(
        "SELECT deleted_at FROM article WHERE slug = 'standalone' AND source_type = 'markdown'",
      )
      .get() as { deleted_at: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.deleted_at).toBeNull();
  });

  it('B2-④ 同名冲突：目录式优先、文件式跳过（规则②），读取面恒解析到目录式', async () => {
    // 构造冲突：文件式与 fixture 目录式 hello-world 并存
    const conflictAbs = path.join(mizukiRoot, 'src/content/posts/hello-world.md');
    fs.writeFileSync(
      conflictAbs,
      '---\ntitle: 冲突文件形态\ndescription: 冲突样例\n---\n\n冲突正文。\n',
    );
    try {
      const list = await server().get('/api/v1/admin/posts');
      expect(list.status).toBe(200);
      const matches = (list.body as { slug: string; frontmatter: Record<string, unknown> }[]).filter(
        (p) => p.slug === 'hello-world',
      );
      expect(matches.length).toBe(1); // 目录式胜出，文件式跳过 + pino warn（日志面不进断言）
      expect(matches[0]!.frontmatter['title']).toBe('Hello World');

      const detail = await server().get('/api/v1/admin/posts/hello-world');
      expect(detail.status).toBe(200);
      expect(detail.body.frontmatter['title']).toBe('Hello World');
    } finally {
      try {
        fs.rmSync(conflictAbs, { force: true });
      } catch {
        // 沙箱 shim 可能拦截删除：冲突文件位于 spec 私有 tmp（mizukiRoot），残留不影响其他 spec
      }
    }
  });

  it('§6.8 [Phase4-D4/B1] deriveStatus 优先链钉版：draft:true 优先 / published:false 遗留按 draft / published 日期形态不误伤', async () => {
    const base = { description: 'B1 优先链验收' };
    // ① draft:true 与 published 日期并存 → draft（draft 布尔开关优先于一切 published 形态）
    const a = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'b1-draft-wins',
        frontmatter: { title: 'B1甲', ...base, draft: true, published: '2026-01-01' },
        content: 'x',
      });
    expect(a.status).toBe(201);

    // ② published:false（历史面板误写布尔，ADR-025 安全向保留分支）→ draft + pino warn
    const b = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'b1-published-false',
        frontmatter: { title: 'B1乙', ...base, published: false },
        content: 'x',
      });
    expect(b.status).toBe(201);

    // ③ published:'2026-01-01'（官方日期语义）且无 draft → published（日期形态不得误伤为草稿）
    const c = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'b1-published-date',
        frontmatter: { title: 'B1丙', ...base, published: '2026-01-01' },
        content: 'x',
      });
    expect(c.status).toBe(201);

    // status 为派生值，PostView/详情响应零投影（§6.1 同源）——经 sync 入库后以
    // DB article 行为权威载体断言（§6.5 同通道）
    const synced = await server().post('/api/v1/admin/posts/sync');
    expect(synced.status).toBe(201);
    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const rows = sqlite
      .prepare("SELECT slug, status FROM article WHERE source_type = 'markdown' AND deleted_at IS NULL")
      .all() as { slug: string; status: string }[];
    expect(rows.find((row) => row.slug === 'b1-draft-wins')?.status).toBe('draft');
    expect(rows.find((row) => row.slug === 'b1-published-false')?.status).toBe('draft');
    expect(rows.find((row) => row.slug === 'b1-published-date')?.status).toBe('published');
  });

  // ── [Phase4-D4/S3/S4] 补充波次锚 ──

  it('[Phase4-D4/S3/B1b] published 裸日期落盘：创建含日期 → 文件无引号 yyyy-mm-dd + 再写幂等', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 's3-bare-date',
        frontmatter: { title: 'S3 裸日期', description: 'S3 断言载体', published: '2026-01-02' },
        content: 'x',
      });
    expect(created.status).toBe(201);

    const fileAbs = path.join(mizukiRoot, 'src/content/posts/s3-bare-date/index.md');
    const text1 = fs.readFileSync(fileAbs, 'utf8');
    // 官方裸日期形态（无引号）：js-yaml 对日期形字符串恒带引号、对 Date 恒输出完整 ISO，
    // 两路皆非官方形态 —— stringifyPostMarkdown 自拼归一（S3 实证注记见实现处）
    expect(text1).toContain('published: 2026-01-02\n');
    expect(text1).not.toContain("published: '2026-01-02'");
    expect(text1).not.toContain('published: 2026-01-02T');

    // 再写幂等：PATCH 其他键 → published 解析为 Date（UTC 零点）→ 重写仍归一为裸日期
    const patched = await server()
      .patch('/api/v1/admin/posts/s3-bare-date')
      .send({ frontmatter: { category: 'e2e' } });
    expect(patched.status).toBe(200);
    const text2 = fs.readFileSync(fileAbs, 'utf8');
    expect(text2).toContain('published: 2026-01-02\n');
    expect(text2).not.toContain('2026-01-02T');
  });

  it('[Phase4-D4/S4/B2b] source 形态标志：文件式 standalone 读回 source=\'file\'、目录式 source=\'dir\'（零路径面）', async () => {
    const detail = await server().get('/api/v1/admin/posts/standalone');
    expect(detail.status).toBe(200);
    const detailBody = detail.body as { slug: string; source: string };
    expect(detailBody.source).toBe('file');
    // R1 注记：source 为字面量枚举，响应不含 relPath/fileAbs 等路径面
    expect(JSON.stringify(detailBody)).not.toContain('src/content/posts');

    const list = await server().get('/api/v1/admin/posts');
    expect(list.status).toBe(200);
    const rows = list.body as { slug: string; source: string }[];
    expect(rows.find((row) => row.slug === 'standalone')?.source).toBe('file');
    expect(rows.find((row) => row.slug === 'hello-world')?.source).toBe('dir');
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
