import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { setupSiteAssets } from '../src/main';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [Phase3-C4] p7d — 上传缩略图变体 e2e（相册面管线，ADR-019）：
 *  ⑦ jpg 上传 → 同目录 -thumb.webp 生成且原图字节保真、变体经既有
 *     /site-assets 公开路径可达（ADR-012 零新路径前提）；
 *  ⑧ bmp 上传 → 原图 201、无变体（ADR-017 双口径延伸）；
 *  ⑨ fail-open 锚：合法魔数 + 结构性损坏（损坏 zlib 流）→ 原图 201、
 *     无变体、响应形状不变（断言只锚契约不锚失败层级）；
 *  ⑩ tiff 上传（相册面，ADR-017 准入）→ 变体生成；
 *  ⑪ 删除原图 → 同名 -thumb.webp 一并消失；变体缺失时删除流程幂等无错。
 *
 * 装配沿用 P7/P7c：AppModule + mizuki fixture，相册测试内自建（fixture 零变更）。
 */

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7d-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 构造 CRC 正确的 PNG chunk（zlib.crc32，Node ≥20.12） */
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 合法魔数 + 结构性损坏的 PNG：IHDR 可解析（probe metadata 通过），IDAT 为非法 zlib 流（解码必败） */
function corruptPng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.from([0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0])),
    pngChunk('IDAT', Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xff, 0xff, 0xff])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const albumDir = (album: string): string =>
  path.join(mizukiRoot, 'public', 'images', 'albums', album);

describe('P7d [Phase3-C4] 上传缩略图变体 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  let sqlite: Database.Database;

  beforeAll(async () => {
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });
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
    setupSiteAssets(app); // ⑦ 断言「变体经既有公开路径可达」需挂载 ADR-012 通道（p12 同款）
    await app.init();
    sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    sqlite.close();
    // Windows 下新建的 webp 变体可能被杀软/索引器瞬时占用致 rmSync 偶发 EPERM：
    // 有限重试后放弃清理（.tmpvitest 已 gitignore，不留跟踪残留）
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  async function createAlbum(name: string): Promise<void> {
    const res = await server()
      .post('/api/v1/admin/albums')
      .send({ name, info: { title: `缩略图-${name}` } });
    expect([200, 201]).toContain(res.status);
  }

  // ── ⑦ jpg：变体生成 + 原图字节保真 + 既有公开路径可达 ──

  it('⑦ jpg 上传 → -thumb.webp 生成（短边≤480）、原图字节保真、经 /site-assets 可达', async () => {
    await createAlbum('thumb-album');
    const jpg = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg()
      .toBuffer();
    const res = await server()
      .post('/api/v1/admin/albums/thumb-album/images')
      .attach('file', jpg, 'photo.jpg');
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('photo.jpg');

    // 原图字节保真（原格式落盘纪律不动）
    const abs = path.join(albumDir('thumb-album'), 'photo.jpg');
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs).equals(jpg)).toBe(true);

    // 变体：同目录 <去扩展名>-thumb.webp，短边 ≤480（1200×800 → 720×480）
    const thumbAbs = path.join(albumDir('thumb-album'), 'photo-thumb.webp');
    expect(fs.existsSync(thumbAbs)).toBe(true);
    const thumbMeta = await sharp(thumbAbs).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBe(720);
    expect(thumbMeta.height).toBe(480);

    // 变体经既有公开路径直达（ADR-012 通道：/site-assets/<public/ 剥离后的相对路径>）
    const viaAssets = await server().get(
      '/site-assets/images/albums/thumb-album/photo-thumb.webp',
    );
    expect(viaAssets.status).toBe(200);

    // images 列表排除派生变体（形状不变，内容面偏差记 ADR-019）
    const list = await server().get('/api/v1/admin/albums');
    const album = (list.body as { name: string; images: string[] }[]).find(
      (a) => a.name === 'thumb-album',
    );
    expect(album?.images).toEqual(['photo.jpg']);
  });

  // ── ⑧ bmp：跳过变体 ──

  it('⑧ bmp 上传 → 原图 201 原格式落盘、无变体（ADR-017 双口径延伸）', async () => {
    await createAlbum('bmp-album');
    const bmp = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const res = await server()
      .post('/api/v1/admin/albums/bmp-album/images')
      .attach('file', bmp, 'shot.bmp');
    expect(res.status).toBe(201);
    expect(fs.existsSync(path.join(albumDir('bmp-album'), 'shot.bmp'))).toBe(true);
    expect(fs.existsSync(path.join(albumDir('bmp-album'), 'shot-thumb.webp'))).toBe(false);
  });

  // ── ⑨ fail-open 锚：合法魔数 + 结构性损坏 ──

  it('⑨ 损坏 zlib 流 PNG → 原图 201、无变体、响应形状不变（fail-open 仅限变体）', async () => {
    await createAlbum('corrupt-album');
    const res = await server()
      .post('/api/v1/admin/albums/corrupt-album/images')
      .attach('file', corruptPng(), 'broken.png');
    // probe（metadata）只读头通过 → 上传照常 201；响应形状与正常上传一致
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('broken.png');
    expect(typeof res.body.path).toBe('string');
    expect(fs.existsSync(path.join(albumDir('corrupt-album'), 'broken.png'))).toBe(true);
    expect(fs.existsSync(path.join(albumDir('corrupt-album'), 'broken-thumb.webp'))).toBe(false);
  });

  // ── ⑩ tiff（相册面准入）→ 变体生成 ──

  it('⑩ tiff 上传（相册面，ADR-017 准入）→ 变体生成', async () => {
    await createAlbum('tiff-album');
    const tiff = await sharp({
      create: { width: 640, height: 960, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .tiff()
      .toBuffer();
    const res = await server()
      .post('/api/v1/admin/albums/tiff-album/images')
      .attach('file', tiff, 'scan.tiff');
    expect(res.status).toBe(201);
    const thumbAbs = path.join(albumDir('tiff-album'), 'scan-thumb.webp');
    expect(fs.existsSync(thumbAbs)).toBe(true);
    // 竖图（短边=宽 640 > 480）→ 480×720
    const thumbMeta = await sharp(thumbAbs).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBe(480);
    expect(thumbMeta.height).toBe(720);
  });

  // ── ⑪ 删除耦合 ──

  it('⑪ 删除原图 → 同名 -thumb.webp 一并消失；变体缺失时再删幂等无错', async () => {
    await createAlbum('delete-album');
    const jpg = await sharp({
      create: { width: 1000, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    const up = await server()
      .post('/api/v1/admin/albums/delete-album/images')
      .attach('file', jpg, 'vacation.jpg');
    expect(up.status).toBe(201);
    expect(fs.existsSync(path.join(albumDir('delete-album'), 'vacation-thumb.webp'))).toBe(true);

    const del = await server().delete('/api/v1/admin/albums/delete-album/images/vacation.jpg');
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(albumDir('delete-album'), 'vacation.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(albumDir('delete-album'), 'vacation-thumb.webp'))).toBe(false);

    // 幂等容忍锚：变体缺失（孤儿已被清理的历史场景）时删除原图不报错、无残留
    const up2 = await server()
      .post('/api/v1/admin/albums/delete-album/images')
      .attach('file', jpg, 'solo.jpg');
    expect(up2.status).toBe(201);
    fs.rmSync(path.join(albumDir('delete-album'), 'solo-thumb.webp')); // 模拟孤儿已不存在
    const del2 = await server().delete('/api/v1/admin/albums/delete-album/images/solo.jpg');
    expect(del2.status).toBe(200);
    const residue = fs.readdirSync(albumDir('delete-album')).filter((f) => f !== 'info.json');
    expect(residue).toEqual([]);
  });
});
