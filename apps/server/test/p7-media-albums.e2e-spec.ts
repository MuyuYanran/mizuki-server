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
import { ContentChangedPayload, EVENTS, MediaChangedPayload } from '../../../packages/shared/src/events';
import type { MediaReference } from '../../../packages/shared/src/media-reference';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * P7 §6.1–6.8 验收依据（supertest e2e，沿用 P6 装配：先 init + login 取 token）：
 * 伪造扩展名拒绝、合法格式入库、10MB 上限、重编码去 EXIF、被引用删除 409 +
 * 明细、无引用删除成功、四模块注册断言、相册 CRUD 往返（原格式落盘，B2 裁决 2）、
 * 路径防护、事件断言（media.changed / content.changed scope='album'）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 测试事件订阅者（P7 §6.8） */
class MediaEventsSubscriber {
  static mediaChanged: { path: string; op: string }[] = [];
  static contentChanged: ContentChangedPayload[] = [];

  @OnEvent(EVENTS.MediaChanged)
  onMediaChanged(payload: unknown): void {
    MediaEventsSubscriber.mediaChanged.push(MediaChangedPayload.parse(payload));
  }

  @OnEvent(EVENTS.ContentChanged)
  onContentChanged(payload: unknown): void {
    MediaEventsSubscriber.contentChanged.push(ContentChangedPayload.parse(payload));
  }
}

describe('P7 媒体与相册 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  let sqlite: Database.Database;
  const uploadedPaths: string[] = [];

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    MediaEventsSubscriber.mediaChanged = [];
    MediaEventsSubscriber.contentChanged = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [MediaEventsSubscriber],
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

  /** 生成指定格式的测试图片缓冲 */
  async function makeImage(format: 'jpeg' | 'png' | 'webp' | 'gif', size = 12): Promise<Buffer> {
    const base = sharp({
      create: { width: size, height: size, channels: 3, background: { r: 120, g: 200, b: 60 } },
    });
    switch (format) {
      case 'jpeg':
        return base.jpeg().toBuffer();
      case 'png':
        return base.png().toBuffer();
      case 'webp':
        return base.webp().toBuffer();
      case 'gif':
        return base.gif().toBuffer();
    }
  }

  // ── §6.1 伪造扩展名被拒 ──

  it('§6.1 伪造扩展名：文本文件改名 .png → 400（魔数嗅探拒绝）', async () => {
    const fake = Buffer.from('这是纯文本，不是图片。');
    const res = await server().post('/api/v1/admin/media').attach('file', fake, 'fake.png');
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('魔数');
  });

  it('§6.1 合法格式：jpg/png/webp 上传成功且落 media_file', async () => {
    for (const [format, fileName] of [
      ['jpeg', 'a.jpg'],
      ['png', 'b.png'],
      ['webp', 'c.webp'],
    ] as const) {
      const buffer = await makeImage(format);
      const res = await server().post('/api/v1/admin/media').attach('file', buffer, fileName);
      expect(res.status).toBe(201);
      expect(res.body.path).toMatch(/^public\/images\/uploads\/.+$/);
      expect(res.body.width).toBeGreaterThan(0);
      expect(res.body.height).toBeGreaterThan(0);
      expect(typeof res.body.sha256).toBe('string');
      uploadedPaths.push(res.body.path as string);
      // 物理文件存在
      expect(fs.existsSync(path.join(mizukiRoot, res.body.path))).toBe(true);
    }
    const list = await server().get('/api/v1/admin/media');
    expect(list.status).toBe(200);
    const paths = (list.body as { path: string }[]).map((row) => row.path);
    for (const uploaded of uploadedPaths) {
      expect(paths).toContain(uploaded);
    }
  });

  // ── §6.2 10MB 上限 ──

  it('§6.2 大小上限：超限文件 → 413', async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1024);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff; // JPEG 魔数（先过嗅探，再撞大小关）
    const res = await server().post('/api/v1/admin/media').attach('file', oversized, 'big.jpg');
    expect(res.status).toBe(413);
  }, 30_000);

  // ── §6.3 重编码去元数据 ──

  it('§6.3 重编码去元数据：含 EXIF 的 JPEG 上传后产物无 EXIF', async () => {
    const withExif = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { ImageDescription: 'p7-exif-marker' } } })
      .toBuffer();
    const sourceMeta = await sharp(withExif).metadata();
    expect(sourceMeta.exif).toBeDefined(); // 源含 EXIF

    const res = await server().post('/api/v1/admin/media').attach('file', withExif, 'exif.jpg');
    expect(res.status).toBe(201);
    const productMeta = await sharp(path.join(mizukiRoot, res.body.path)).metadata();
    expect(productMeta.exif).toBeUndefined(); // 产物已剥离
  });

  // ── §6.4 被引用图片删除被拒 ──

  it('§6.4 被引用媒体：文章封面引用 → DELETE 409 且响应含引用明细', async () => {
    const buffer = await makeImage('jpeg');
    const uploaded = await server().post('/api/v1/admin/media').attach('file', buffer, 'referenced.jpg');
    expect(uploaded.status).toBe(201);
    const mediaId = uploaded.body.id as string;
    const mediaPath = uploaded.body.path as string;

    // 构造引用：文章 frontmatter.image 指向该媒体路径（相对 Mizuki 根）
    const post = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'ref-cover', frontmatter: { title: '引用封面', image: mediaPath }, content: 'x' });
    expect(post.status).toBe(201);

    const denied = await server().delete(`/api/v1/admin/media/${mediaId}`);
    expect(denied.status).toBe(409);
    const refs = denied.body.detail.references as { refType: string; targetLabel: string }[];
    expect(Array.isArray(refs)).toBe(true);
    expect(refs.some((ref) => ref.refType === 'post-cover' && ref.targetLabel === 'ref-cover')).toBe(true);
    // 文件仍在
    expect(fs.existsSync(path.join(mizukiRoot, mediaPath))).toBe(true);
  });

  it('§6.4 无引用媒体：删除成功（文件与表行均消失）', async () => {
    // 先移除上一条用例的引用（删文章），随后该媒体可删
    const removePost = await server().delete('/api/v1/admin/posts/ref-cover');
    expect(removePost.status).toBe(200);

    const list = await server().get('/api/v1/admin/media');
    const target = (list.body as { id: string; path: string; originalName: string }[]).find(
      (row) => row.originalName === 'referenced.jpg',
    );
    expect(target).toBeDefined();

    const removed = await server().delete(`/api/v1/admin/media/${target!.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    expect(fs.existsSync(path.join(mizukiRoot, target!.path))).toBe(false);
    const after = await server().get('/api/v1/admin/media');
    expect((after.body as { id: string }[]).some((row) => row.id === target!.id)).toBe(false);
  });

  // ── §6.5 四模块注册断言 ──

  it('§6.5 注册表：贡献者含 posts/collections/albums 且 name 唯一；可容纳第 4 插槽', async () => {
    const registry = app.get(MediaReferenceRegistry);
    const names = registry.names();
    for (const expected of ['posts', 'collections', 'albums']) {
      expect(names).toContain(expected);
    }
    expect(new Set(names).size).toBe(names.length);

    // articles 在 P8 注册：用测试贡献者验证机制可容纳第 4 个插槽
    const testRefs: MediaReference[] = [{ refType: 'test-ref', targetLabel: 't1', mediaPath: 'x/y.jpg' }];
    registry.register({ name: 'test-contributor', collectReferences: async () => testRefs });
    expect(registry.names()).toContain('test-contributor');
    const all = await registry.collectAll();
    expect(all.some((ref) => ref.refType === 'test-ref')).toBe(true);
  });

  // ── §6.6 相册 CRUD 往返 ──

  it('§6.6 相册 CRUD：创建（info 全字段）→ 列表 → PATCH → 重读一致', async () => {
    const info = {
      title: '旅行相册',
      description: '二〇二六夏',
      date: '2026-08-26',
      location: '杭州',
      tags: ['风景', '人像'],
      layout: 'grid',
      columns: 3,
    };
    const created = await server().post('/api/v1/admin/albums').send({ name: 'trip-2026', info });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('trip-2026');
    expect(created.body.info).toEqual(info);

    let list = await server().get('/api/v1/admin/albums');
    expect(list.status).toBe(200);
    expect((list.body as { name: string }[]).some((album) => album.name === 'trip-2026')).toBe(true);

    const patched = await server()
      .patch('/api/v1/admin/albums/trip-2026')
      .send({ title: '旅行相册（改）', columns: 4 });
    expect(patched.status).toBe(200);
    expect(patched.body.info.title).toBe('旅行相册（改）');
    expect(patched.body.info.columns).toBe(4);
    // 未修改字段保持
    expect(patched.body.info.location).toBe('杭州');

    list = await server().get('/api/v1/admin/albums');
    const album = (list.body as { name: string; info: { title: string } }[]).find(
      (entry) => entry.name === 'trip-2026',
    );
    expect(album?.info.title).toBe('旅行相册（改）');
  });

  it('§6.6 [B2/裁决 2] 原格式落盘：上传 PNG → 同名 .png 落盘（不再强转 JPG）；删除单张 → 目录与列表更新', async () => {
    const png = await makeImage('png');
    const uploaded = await server()
      .post('/api/v1/admin/albums/trip-2026/images')
      .attach('file', png, 'sunset.png');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.name).toBe('sunset.png'); // 原格式落盘：文件名保持原扩展名
    const abs = path.join(mizukiRoot, uploaded.body.path);
    expect(fs.existsSync(abs)).toBe(true);
    expect((await sharp(abs).metadata()).format).toBe('png'); // 不再强转 JPG

    let album = (await server().get('/api/v1/admin/albums')).body as { name: string; images: string[] }[];
    expect(album.find((entry) => entry.name === 'trip-2026')?.images).toContain('sunset.png');

    const removed = await server().delete('/api/v1/admin/albums/trip-2026/images/sunset.png');
    expect(removed.status).toBe(200);
    expect(fs.existsSync(abs)).toBe(false);
    album = (await server().get('/api/v1/admin/albums')).body as { name: string; images: string[] }[];
    expect(album.find((entry) => entry.name === 'trip-2026')?.images).not.toContain('sunset.png');
  });

  it('§6.6 [B2/裁决 3] tiff 放行层排除：合法 tiff 魔数上传 → 400 白名单拒绝（能力层签名保留见单测）', async () => {
    // 构造真实 TIFF 魔数内容（II*\0 小端头）
    const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const res = await server().post('/api/v1/admin/albums/trip-2026/images').attach('file', tiffHeader, 'a.tiff');
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('白名单');
  });

  // ── §6.7 路径防护 ──

  it('§6.7 路径防护：相册名/图片名含 ../ 被拒（400/403）', async () => {
    const evilCreate = await server()
      .post('/api/v1/admin/albums')
      .send({ name: '../evil', info: { title: 'x' } });
    expect([400, 403]).toContain(evilCreate.status);

    const evilDelete = await server().delete('/api/v1/admin/albums/..%2Fevil');
    expect([400, 403, 404]).toContain(evilDelete.status); // zod 400 优先；解码后 404 亦可接受

    const evilImage = await server().delete('/api/v1/admin/albums/trip-2026/images/..%2F..%2Fx.jpg');
    expect([400, 403]).toContain(evilImage.status);
    expect(fs.existsSync(path.join(mizukiRoot, '..', 'x.jpg'))).toBe(false);
  });

  // ── §6.8 事件断言 ──

  it('§6.8 事件：上传收 media.changed save、删除收 delete（payload 过 parse）', () => {
    const saves = MediaEventsSubscriber.mediaChanged.filter((event) => event.op === 'save');
    const deletes = MediaEventsSubscriber.mediaChanged.filter((event) => event.op === 'delete');
    expect(saves.length).toBeGreaterThanOrEqual(4); // jpg/png/webp/exif/referenced
    expect(deletes.length).toBeGreaterThanOrEqual(2); // referenced 媒体 + sunset.jpg
    for (const event of MediaEventsSubscriber.mediaChanged) {
      expect(typeof event.path).toBe('string');
    }
    expect(saves.some((event) => event.path.startsWith('public/images/uploads/'))).toBe(true);
    expect(deletes.some((event) => event.path.startsWith('public/images/albums/trip-2026/'))).toBe(true);
  });

  it('§6.8 事件：创建/修改相册收 content.changed（scope=album，info.json 路径）', () => {
    const albumEvents = MediaEventsSubscriber.contentChanged.filter((event) => event.scope === 'album');
    expect(albumEvents.length).toBeGreaterThanOrEqual(2); // create + patch
    expect(albumEvents[0]!.filePaths).toEqual(['public/images/albums/trip-2026/info.json']);
  });

  // ── 边界 ──

  it('404/409：不存在的媒体/相册拒绝；相册重名 409', async () => {
    expect((await server().delete('/api/v1/admin/media/not-exists')).status).toBe(404);
    expect((await server().patch('/api/v1/admin/albums/not-exists').send({ title: 'x' })).status).toBe(404);

    const duplicate = await server()
      .post('/api/v1/admin/albums')
      .send({ name: 'trip-2026', info: { title: '重名' } });
    expect(duplicate.status).toBe(409);
  });

  it('相册删除：无引用 → 目录删除且列表更新', async () => {
    const removed = await server().delete('/api/v1/admin/albums/trip-2026');
    expect(removed.status).toBe(200);
    expect(fs.existsSync(path.join(mizukiRoot, 'public/images/albums/trip-2026'))).toBe(false);
    const list = await server().get('/api/v1/admin/albums');
    expect((list.body as { name: string }[]).some((album) => album.name === 'trip-2026')).toBe(false);
  });
});
