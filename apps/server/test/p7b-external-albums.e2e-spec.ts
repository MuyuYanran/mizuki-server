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
 * [B2/T1 · R2-14] 相册外链模式 e2e（supertest，沿用 P7 装配）：
 * 外链相册全生命周期（创建 → 加照片 → 改字段 → 删照片 → 删相册）+
 * mode 切换双向拒绝/放行各一用例。外链 info.json 形状以 B4 fixture
 * external-demo（官方 special-gallery §外链模式详解样例）为准。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7b-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

interface ExternalPhotoLike {
  src: string;
  alt?: string;
  [key: string]: unknown;
}

interface AlbumViewLike {
  name: string;
  info: {
    mode?: string;
    cover?: string;
    photos?: ExternalPhotoLike[];
    title?: string;
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

describe('P7b [B2/T1] 相册外链模式 e2e', () => {
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

  // ── fixture 外链相册可见性 ──

  it('fixture 外链相册 external-demo 列表可见：mode=external、cover、photos×2', async () => {
    const list = await server().get('/api/v1/admin/albums');
    expect(list.status).toBe(200);
    const album = (list.body as AlbumViewLike[]).find((entry) => entry.name === 'external-demo');
    expect(album).toBeDefined();
    expect(album!.info.mode).toBe('external');
    expect(album!.info.cover).toBe('https://cdn.example.com/albums/landscape/cover.jpg');
    expect(album!.info.photos).toHaveLength(2);
    expect(album!.info.photos![0]!.src).toBe('https://cdn.example.com/photos/mountain-sunset.jpg');
  });

  // ── 全生命周期：创建 → 加照片 → 改字段 → 删照片 ──

  it('生命周期①创建：mode=external + cover → 201，磁盘 info.json 形状一致', async () => {
    const res = await server().post('/api/v1/admin/albums').send({
      name: 'ext-trip',
      info: {
        mode: 'external',
        title: '外链旅行相册',
        cover: 'https://cdn.example.com/ext-trip/cover.jpg',
        photos: [],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.info.mode).toBe('external');
    expect(res.body.info.photos).toEqual([]);
    const onDisk = readInfoJson('ext-trip');
    expect(onDisk['mode']).toBe('external');
    expect(onDisk['cover']).toBe('https://cdn.example.com/ext-trip/cover.jpg');
  });

  it('生命周期②加照片：POST external-photos → 201，photos 追加且落盘', async () => {
    const res = await server().post('/api/v1/admin/albums/ext-trip/external-photos').send({
      src: 'https://cdn.example.com/ext-trip/01.jpg',
      alt: '第一站',
      width: 1920,
      height: 1080,
      camera: 'Canon EOS R5',
    });
    expect(res.status).toBe(201);
    const photos = res.body.info.photos as ExternalPhotoLike[];
    expect(photos).toHaveLength(1);
    expect(photos[0]!.src).toBe('https://cdn.example.com/ext-trip/01.jpg');
    expect(photos[0]!.camera).toBe('Canon EOS R5');
    expect((readInfoJson('ext-trip')['photos'] as ExternalPhotoLike[])).toHaveLength(1);
  });

  it('生命周期③改字段：PATCH external-photos/0 → 200，增量合并且其余字段保持', async () => {
    const res = await server().patch('/api/v1/admin/albums/ext-trip/external-photos/0').send({
      alt: '第一站（改）',
    });
    expect(res.status).toBe(200);
    const photo = (res.body.info.photos as ExternalPhotoLike[])[0]!;
    expect(photo['alt']).toBe('第一站（改）');
    expect(photo['src']).toBe('https://cdn.example.com/ext-trip/01.jpg'); // 未修改字段保持
    expect(photo['camera']).toBe('Canon EOS R5');
  });

  it('生命周期③反例：PATCH 不存在的下标 → 404；非法下标 → 400', async () => {
    const missing = await server()
      .patch('/api/v1/admin/albums/ext-trip/external-photos/99')
      .send({ alt: 'x' });
    expect(missing.status).toBe(404);

    const badIndex = await server()
      .patch('/api/v1/admin/albums/ext-trip/external-photos/abc')
      .send({ alt: 'x' });
    expect(badIndex.status).toBe(400);
  });

  it('生命周期④删照片：DELETE external-photos/0 → 200，photos 清空且落盘同步', async () => {
    const res = await server().delete('/api/v1/admin/albums/ext-trip/external-photos/0');
    expect(res.status).toBe(200);
    expect(res.body.info.photos).toEqual([]);
    expect((readInfoJson('ext-trip')['photos'] as ExternalPhotoLike[])).toHaveLength(0);
  });

  it('生命周期⑤删相册：DELETE → 200，目录与 info.json 一并消失', async () => {
    const res = await server().delete('/api/v1/admin/albums/ext-trip');
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(mizukiRoot, 'public/images/albums/ext-trip'))).toBe(false);
  });

  // ── 外链照片操作仅限外链模式 ──

  it('本地模式相册执行外链照片操作 → 409（非外链模式拒绝）', async () => {
    const created = await server()
      .post('/api/v1/admin/albums')
      .send({ name: 'locals-only', info: { title: '本地相册' } });
    expect(created.status).toBe(201);

    const res = await server().post('/api/v1/admin/albums/locals-only/external-photos').send({
      src: 'https://cdn.example.com/x.jpg',
    });
    expect(res.status).toBe(409);
  });

  // ── mode 切换：双向拒绝 / 放行 ──

  it('mode 切换拒绝 local→external：本地照片目录非空 → 409 且错误信息含现存照片数', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const upload = await server()
      .post('/api/v1/admin/albums/locals-only/images')
      .attach('file', png, 'local-shot.png');
    expect(upload.status).toBe(201);

    const res = await server().patch('/api/v1/admin/albums/locals-only').send({ mode: 'external' });
    expect(res.status).toBe(409);
    expect(String(res.body.message)).toContain('1 张本地照片');
  });

  it('mode 切换放行 local→external：空相册 → 200，photos 初始化为空数组', async () => {
    const created = await server()
      .post('/api/v1/admin/albums')
      .send({ name: 'empty-local', info: { title: '待切换' } });
    expect(created.status).toBe(201);

    const res = await server()
      .patch('/api/v1/admin/albums/empty-local')
      .send({ mode: 'external', cover: 'https://cdn.example.com/empty/cover.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.info.mode).toBe('external');
    expect(res.body.info.photos).toEqual([]);
    expect(readInfoJson('empty-local')['mode']).toBe('external');
  });

  it('mode 切换拒绝 external→local：photos 非空 → 409 且错误信息含现存条数', async () => {
    // fixture external-demo 携带 2 条外链照片
    const res = await server().patch('/api/v1/admin/albums/external-demo').send({ mode: 'local' });
    expect(res.status).toBe(409);
    expect(String(res.body.message)).toContain('2 条外链照片');
  });

  it('mode 切换放行 external→local：photos 清空后 → 200，盘上剥离 cover/photos', async () => {
    // empty-local 当前为外链模式且 photos 为空（上一用例切入）
    const res = await server().patch('/api/v1/admin/albums/empty-local').send({ mode: 'local' });
    expect(res.status).toBe(200);
    expect(res.body.info.mode).toBe('local');
    const onDisk = readInfoJson('empty-local');
    expect(onDisk['mode']).toBe('local');
    expect('cover' in onDisk).toBe(false);
    expect('photos' in onDisk).toBe(false);
  });
});
