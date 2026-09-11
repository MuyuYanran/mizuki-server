import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin, withAuth } from './helpers/admin-auth';
// [Phase4-D2/锚③④ 先例] 引用形态中心为纯函数，跨包直引 web 源码（测试目录不受
// boundaries 约束）；避免为测插入 URL 形态复制实现造成双口径漂移。
import { toSiteReference } from '../../web/src/lib/media-ref';

/**
 * [Phase5-E1/A6b] 富文本位图粘贴直传集成链 e2e（架构师授权 2026-09-08）
 *
 * 前端交互面（真实粘贴/拖拽/占位/toast）为 type 手验 + 截图（docs/audits/phase5-e/），
 * 本 spec 锚定「粘贴直传」的服务端可达语义全链（TipTap 上传消费的同一端点与形态）：
 *   ① [E1-a] 位图直传落盘 + 插入 URL 形态：POST /admin/media（五件套管线）→
 *      path=public/images/uploads/<nanoid>.<ext> → 盘上文件存在 → toSiteReference(path)
 *      = /images/uploads/...（TipTap 插入的 src 形态，跨包直引单源）；
 *   ② [E1-c] URL 插入 + 保存往返 html_cache 零特判：docJson image src=①产物 URL →
 *      POST /admin/articles → 201 → 管理读回 htmlCache 含原样 src → 公开详情 html 同串
 *      （render.ts image case 纯 URL 字符串透传，escapeAttr 不改写合法路径）；
 *   ③ [E1-b] 上限拒绝：真实 PNG >10MB（raw 噪声不可压缩）→ 413 + 零媒体条目 + 零盘上
 *      文件（失败不产生可插入 URL =「失败不插入」的服务端判据）；
 *   ④ [E1-b] 魔数拒绝：文本改名 .png → 400（魔数）+ 零媒体条目 + 零盘上文件。
 */
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-pe1-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

interface MediaInfoLike {
  id: string;
  path: string;
  originalName: string;
  mime: string;
}

/** 直传位图（模拟剪贴板缓冲）：sharp 生成真 PNG */
async function bitmapPng(width = 24, height = 24): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 160, g: 90, b: 200 } },
  })
    .png()
    .toBuffer();
}

/** 超限位图：raw 噪声不可压缩 → PNG > 10MB（2210×1580×3 ≈ 10.5MB 原始，噪声压缩近零损耗） */
async function oversizedPng(): Promise<Buffer> {
  const width = 2210;
  const height = 1580;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 1) {
    raw[i] = Math.floor(Math.random() * 256);
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe('[Phase5-E1] 富文本位图粘贴直传集成链 e2e', () => {
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

  const mediaRowCount = (): number =>
    (sqlite.prepare('SELECT COUNT(*) AS n FROM media_file').get() as { n: number }).n;

  it('① [E1-a] 位图直传落盘 + 插入 URL 形态：uploads 路径、盘上文件、toSiteReference 归一', async () => {
    const png = await bitmapPng();
    const res = await server().post('/api/v1/admin/media').attach('file', png, 'paste-shot.png');
    expect(res.status).toBe(201);

    const media = res.body as MediaInfoLike;
    // 产物路径：public/images/uploads/<nanoid>.<ext>（五件套管线，随机名）
    expect(media.path.startsWith('public/images/uploads/')).toBe(true);
    expect(media.path.endsWith('.png')).toBe(true);
    expect(media.mime).toBe('image/png');

    // 盘上文件存在（重编码产物，路径相对 mizukiRoot）
    const onDisk = path.join(mizukiRoot, media.path);
    expect(fs.existsSync(onDisk)).toBe(true);
    const meta = await sharp(onDisk).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(24);

    // TipTap 插入的 src 形态（前端上传消费点同一单源函数）
    expect(toSiteReference(media.path)).toBe(media.path.replace(/^public/, ''));
  });

  it('② [E1-c] URL 插入 + 保存往返 html_cache 零特判：/images/uploads 原样出现在管理与公开渲染', async () => {
    const png = await bitmapPng(40, 30);
    const upload = await server().post('/api/v1/admin/media').attach('file', png, 'doc-image.png');
    expect(upload.status).toBe(201);
    const src = toSiteReference((upload.body as MediaInfoLike).path);

    // TipTap image 节点形态（粘贴直传成功后编辑器插入的 doc_json 形状）
    const docJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '位图直传往返。' }] },
        { type: 'image', attrs: { src, alt: 'doc-image' } },
      ],
    };
    const created = await server()
      .post('/api/v1/admin/articles')
      .send({ title: 'E1 直传往返', slug: 'pe1-paste-round', docJson, status: 'published' });
    expect(created.status).toBe(201);

    // 管理读回：html_cache 含原样 src（render.ts image case 纯字符串透传，零特判）
    const read = await server().get(`/api/v1/admin/articles/${created.body.id as string}`);
    expect(read.status).toBe(200);
    const cache = read.body.htmlCache as string;
    expect(cache).toContain(`src="${src}"`);
    expect(cache).not.toContain('site-assets'); // 渲染产物不含管理端展示前缀（模型 src 保真）
    expect(cache).toContain('alt="doc-image"');

    // 公开详情：同一 URL 原样（E1-c：公开渲染对图片 URL 零特判）
    const detail = await request(app.getHttpServer()).get('/api/v1/public/articles/pe1-paste-round');
    expect(detail.status).toBe(200);
    expect(detail.body.sourceType).toBe('richtext');
    expect(detail.body.html).toContain(`src="${src}"`);
  });

  it('③ [E1-b] 上限拒绝：>10MB 真位图 → 413，零媒体条目、零盘上文件（失败不产生可插入 URL）', async () => {
    const before = mediaRowCount();
    const png = await oversizedPng();
    expect(png.length).toBeGreaterThan(10 * 1024 * 1024); // 构造自证：确为超限件

    const res = await server().post('/api/v1/admin/media').attach('file', png, 'huge.png');
    expect(res.status).toBe(413);
    expect(String(res.body.message)).toContain('超出上传上限');

    // 失败不插入的服务端判据：无新条目、无残留文件（上传件不落盘）
    expect(mediaRowCount()).toBe(before);
    const uploadsDir = path.join(mizukiRoot, 'public/images/uploads');
    const leftovers = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir).filter((name) => name !== '.gitkeep')
      : [];
    // 本 spec 前序成功上传恰 2 个产物（①一个 + ②一个）；超限件不新增
    expect(leftovers.length).toBe(2);
  });

  it('④ [E1-b] 魔数拒绝：文本改名 .png → 400，零媒体条目、零盘上文件', async () => {
    const before = mediaRowCount();
    const fake = Buffer.from('这不是图片，是纯文本改名件。');
    const res = await server().post('/api/v1/admin/media').attach('file', fake, 'fake.png');
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('魔数');

    expect(mediaRowCount()).toBe(before);
    const uploadsDir = path.join(mizukiRoot, 'public/images/uploads');
    const leftovers = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir).filter((name) => name !== '.gitkeep')
      : [];
    expect(leftovers.length).toBe(2); // 与 ③ 同口径：仍仅前序 2 个成功产物
  });
});
