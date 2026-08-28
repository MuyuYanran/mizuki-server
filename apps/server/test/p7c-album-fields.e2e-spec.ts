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

/**
 * [Phase3-C2a] 相册字段面对齐官方 e2e（supertest，沿用 P7/P7b 装配）：
 * b1/b2/b3 三落地的验收证据链：
 *  - b1 通用字段：hidden（公开列表过滤 + PATCH 恢复）、layout/columns（保真 + 越界 400）；
 *  - b2 外链照片收紧：官方 14 字段保真往返、settings 非法形状 400（字符串 / 未知子键）；
 *  - b3 白名单重裁决（ADR-017）：bmp/tiff 原格式落盘 201、伪造 .bmp 魔数拒绝 400。
 * 未复用 fixture 靶点：所需相册一律测试内经 admin 端点自建（fixture 零变更）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7c-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

interface ExternalPhotoLike {
  src: string;
  [key: string]: unknown;
}

interface AlbumViewLike {
  name: string;
  info: {
    title?: string;
    hidden?: boolean;
    layout?: string;
    columns?: number;
    mode?: string;
    photos?: ExternalPhotoLike[];
    [key: string]: unknown;
  };
  images: string[];
}

/** 读磁盘上的 info.json（断言落盘形状用） */
function readInfoJson(album: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(mizukiRoot, 'public/images/albums', album, 'info.json'), 'utf8'),
  ) as Record<string, unknown>;
}

/** 官方外链照片全 14 字段样例（§2 供料逐字） */
function fullPhoto(): ExternalPhotoLike {
  return {
    id: 'alpine-01',
    src: 'https://cdn.example.com/alpine/01.jpg',
    thumbnail: 'https://cdn.example.com/thumbs/alpine-01.jpg',
    alt: '阿尔卑斯晨光',
    title: '晨光',
    description: '山顶日出',
    tags: ['山脉', '日出'],
    date: '2024-07-15',
    location: '瑞士阿尔卑斯山',
    width: 1920,
    height: 1080,
    camera: 'Canon EOS R5',
    lens: 'RF 24-70mm f/2.8L IS USM',
    settings: { aperture: 'f/8', shutter: '1/125', iso: '200', focal: '35mm' },
  };
}

describe('P7c [Phase3-C2a] 相册字段面对齐官方 e2e', () => {
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
  const bare = (): request.SuperTest<request.Test> => request(app.getHttpServer());

  // ── b1 通用字段：hidden ──

  it('b1-① hidden:true 创建 → 管理端列表含、公开列表不含（官方 hidden 语义）', async () => {
    const created = await server().post('/api/v1/admin/albums').send({
      name: 'hidden-album',
      info: { title: '隐藏相册', hidden: true },
    });
    expect(created.status).toBe(201);
    expect(created.body.info.hidden).toBe(true);
    // 落盘保真
    expect(readInfoJson('hidden-album')['hidden']).toBe(true);

    const admin = await server().get('/api/v1/admin/albums');
    expect(
      (admin.body as AlbumViewLike[]).some((a) => a.name === 'hidden-album'),
    ).toBe(true);

    const pub = await bare().get('/api/v1/public/albums');
    expect(pub.status).toBe(200);
    expect(
      (pub.body as AlbumViewLike[]).some((a) => a.name === 'hidden-album'),
    ).toBe(false);
  });

  it('b1-② hidden 改回 false（PATCH）→ 公开列表恢复可见，管理端仍含', async () => {
    const patched = await server()
      .patch('/api/v1/admin/albums/hidden-album')
      .send({ hidden: false });
    expect(patched.status).toBe(200);
    expect(patched.body.info.hidden).toBe(false);

    const pub = await bare().get('/api/v1/public/albums');
    expect(
      (pub.body as AlbumViewLike[]).some((a) => a.name === 'hidden-album'),
    ).toBe(true);
  });

  // ── b1 通用字段：layout / columns ──

  it('b1-③ layout/columns 创建 → 管理端读回保真（passthrough 往返 + 落盘）', async () => {
    const created = await server().post('/api/v1/admin/albums').send({
      name: 'layout-album',
      info: { title: '布局相册', layout: 'masonry', columns: 4 },
    });
    expect(created.status).toBe(201);
    expect(created.body.info.layout).toBe('masonry');
    expect(created.body.info.columns).toBe(4);
    expect(readInfoJson('layout-album')['layout']).toBe('masonry');
    expect(readInfoJson('layout-album')['columns']).toBe(4);

    const list = await server().get('/api/v1/admin/albums');
    const album = (list.body as AlbumViewLike[]).find((a) => a.name === 'layout-album');
    expect(album?.info.layout).toBe('masonry');
    expect(album?.info.columns).toBe(4);
  });

  it('b1-④ layout 非法值（如 "list"）→ 400', async () => {
    const res = await server().post('/api/v1/admin/albums').send({
      name: 'bad-layout',
      info: { title: '非法布局', layout: 'list' },
    });
    expect(res.status).toBe(400);
  });

  it('b1-⑤ columns 越界（0 / 7 / 小数）→ 400', async () => {
    for (const columns of [0, 7, 1.5]) {
      const res = await server().post('/api/v1/admin/albums').send({
        name: `bad-columns-${columns}`,
        info: { title: '非法列数', columns },
      });
      expect(res.status).toBe(400);
    }
  });

  // ── b2 外链照片收紧 ──

  it('b2-① 外链 photos 含完整官方 14 字段（含 settings 四子键）→ 创建与读回保真', async () => {
    const created = await server().post('/api/v1/admin/albums').send({
      name: 'full-ext',
      info: {
        mode: 'external',
        title: '外链全字段',
        cover: 'https://cdn.example.com/full-ext/cover.jpg',
        photos: [fullPhoto()],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.info.photos).toEqual([fullPhoto()]);

    const list = await server().get('/api/v1/admin/albums');
    const album = (list.body as AlbumViewLike[]).find((a) => a.name === 'full-ext');
    expect(album?.info.photos).toEqual([fullPhoto()]);
    expect((readInfoJson('full-ext')['photos'] as ExternalPhotoLike[])[0]).toEqual(fullPhoto());
  });

  it('b2-② settings 非法形状：字符串 → 400；未知子键 → 400', async () => {
    const asString = await server().post('/api/v1/admin/albums').send({
      name: 'bad-settings-str',
      info: {
        mode: 'external',
        title: 'settings 字符串',
        cover: 'https://cdn.example.com/x/cover.jpg',
        photos: [{ src: 'https://cdn.example.com/x/1.jpg', settings: 'f/8' }],
      },
    });
    expect(asString.status).toBe(400);

    const unknownKey = await server().post('/api/v1/admin/albums').send({
      name: 'bad-settings-key',
      info: {
        mode: 'external',
        title: 'settings 未知键',
        cover: 'https://cdn.example.com/y/cover.jpg',
        photos: [{ src: 'https://cdn.example.com/y/1.jpg', settings: { unknownKey: 1 } }],
      },
    });
    expect(unknownKey.status).toBe(400);
  });

  // ── b3 白名单重裁决（ADR-017）：bmp / tiff ──

  it('b3-① bmp 上传（BM 魔数 + .bmp）→ 201，原格式 .bmp 落盘（跳过 sharp probe）', async () => {
    // 构造满足魔数嗅探的最小 BMP 头（sharp 无法解码 bmp，本批跳过 probe 直落盘）
    const bmp = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const res = await server()
      .post('/api/v1/admin/albums/layout-album/images')
      .attach('file', bmp, 'shot.bmp');
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('shot.bmp');
    const abs = path.join(mizukiRoot, String(res.body.path));
    expect(fs.existsSync(abs)).toBe(true);
    const disk = fs.readFileSync(abs);
    expect(disk[0]).toBe(0x42); // 'B'
    expect(disk[1]).toBe(0x4d); // 'M'
  });

  it('b3-② tiff 上传（sharp 生成真实 tiff）→ 201，原格式 .tiff 落盘（放行层准入后行为）', async () => {
    const tiff = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .tiff()
      .toBuffer();
    const res = await server()
      .post('/api/v1/admin/albums/layout-album/images')
      .attach('file', tiff, 'scan.tiff');
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('scan.tiff');
    const abs = path.join(mizukiRoot, String(res.body.path));
    expect(fs.existsSync(abs)).toBe(true);
    expect((await sharp(abs).metadata()).format).toBe('tiff');
  });

  it('b3-③ 伪造扩展名回归：文本改名 .bmp → 400（魔数嗅探仍生效）', async () => {
    const fake = Buffer.from('this is definitely not an image file', 'utf8');
    const res = await server()
      .post('/api/v1/admin/albums/layout-album/images')
      .attach('file', fake, 'fake.bmp');
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('魔数');
  });
});
