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
// [Phase4-D2/锚③④] 引用形态中心是纯函数（无 Vue/网络依赖），跨包直引 web 源码
// （测试目录不受 boundaries 约束）；避免为测纯逻辑复制实现造成双口径漂移。
import {
  appendImageRef,
  isExternalUrl,
  markdownImageRef,
  toSiteReference,
} from '../../web/src/lib/media-ref';

/**
 * [Phase4-D2] 媒体整合批 T6 六锚（supertest，沿用 P7/P7b 装配）：
 * ① 外链照片 src 写入口径四格（键缺失/空串/非法 scheme/合法三形态）；
 * ② 相册 mode 字段四格（缺省→本地/外链全套→合法/非法值/空串 → 400）；
 * ③ media-ref 纯逻辑（toSiteReference 形态归一 + isExternalUrl 判定）；
 * ④ 引用组装纯逻辑（appendImageRef 追加不去重 + markdownImageRef 形状）；
 * ⑤ 相册外链 additive：site-path src 全链放行 + 存量宽容/写入收紧分界
 *    （纯元信息 PATCH 不重校存量 photos —— 存量数据零破坏的自动化判据）；
 * ⑥ 上传幂等判据（同字节两传 → 新建条目：id/path 分离、sha256 一致仅记录）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4d2-e2e-'));
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
    mode?: string;
    cover?: string;
    title?: string;
    photos?: ExternalPhotoLike[];
    [key: string]: unknown;
  };
  images: string[];
}

interface MediaInfoLike {
  id: string;
  path: string;
  originalName: string;
  sha256: string;
}

/** 读磁盘上的 info.json（断言落盘形状用） */
function readInfoJson(album: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(mizukiRoot, 'public/images/albums', album, 'info.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('P4d2 [Phase4-D2] 媒体整合批六锚', () => {
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

  // ── 锚① 外链照片 src 写入口径四格 ──

  it('① src 写入口径四格：缺 src/空串/非法 scheme → 400，http(s) 与站点绝对路径 → 201', async () => {
    const created = await server()
      .post('/api/v1/admin/albums')
      .send({
        name: 'p4d2-src',
        info: {
          mode: 'external',
          title: 'src 四格',
          cover: 'https://cdn.example.com/p4d2/cover.jpg',
          photos: [],
        },
      });
    expect(created.status).toBe(201);
    const add = (src: string | undefined) =>
      server().post('/api/v1/admin/albums/p4d2-src/external-photos').send(
        src === undefined ? { alt: 'no-src' } : { src, alt: 'probe' },
      );

    // 键缺失（src 必填）→ 400
    expect((await add(undefined)).status).toBe(400);
    // 空串（trim 归一后按缺失拒绝）与纯空白 → 400
    expect((await add('')).status).toBe(400);
    expect((await add('   ')).status).toBe(400);
    // 非法 scheme（http/https 与 / 绝对路径之外）→ 400
    expect((await add('ftp://cdn.example.com/a.jpg')).status).toBe(400);
    expect((await add('javascript:alert(1)')).status).toBe(400);
    // 合法：https / http / 站点绝对路径（选择器回填形态）→ 201 且落盘
    expect((await add('https://cdn.example.com/a.jpg')).status).toBe(201);
    expect((await add('http://cdn.example.com/b.jpg')).status).toBe(201);
    const sitePath = await add('/images/albums/p4d2-src/c.jpg');
    expect(sitePath.status).toBe(201);
    const photos = sitePath.body.info.photos as ExternalPhotoLike[];
    expect(photos).toHaveLength(3);
    expect(photos[2]!.src).toBe('/images/albums/p4d2-src/c.jpg');
  });

  // ── 锚② 相册 mode 字段四格 ──

  it('② mode 四格：缺省→本地；外链全套→201；非法值/空串 → 400', async () => {
    // 缺省 → 本地模式（mode 不落键），照常创建
    const local = await server()
      .post('/api/v1/admin/albums')
      .send({ name: 'p4d2-default', info: { title: '缺省模式' } });
    expect(local.status).toBe(201);
    expect(local.body.info.mode).toBeUndefined();
    expect(readInfoJson('p4d2-default')['mode']).toBeUndefined();

    // external + cover + photos（合法 src）→ 201
    const external = await server()
      .post('/api/v1/admin/albums')
      .send({
        name: 'p4d2-ext',
        info: {
          mode: 'external',
          title: '外链四格',
          cover: 'https://cdn.example.com/p4d2-ext/cover.jpg',
          photos: [{ src: 'https://cdn.example.com/p4d2-ext/01.jpg' }],
        },
      });
    expect(external.status).toBe(201);
    expect(external.body.info.mode).toBe('external');

    // 非法值 → 400（union 双侧 literal 均不匹配）
    const illegal = await server()
      .post('/api/v1/admin/albums')
      .send({ name: 'p4d2-bad', info: { mode: 'gallery', title: '非法' } });
    expect(illegal.status).toBe(400);

    // 空串 → 400（同上，literal('local'/'external') 均不匹配）
    const empty = await server()
      .post('/api/v1/admin/albums')
      .send({ name: 'p4d2-bad2', info: { mode: '', title: '空串' } });
    expect(empty.status).toBe(400);
    expect(fs.existsSync(path.join(mizukiRoot, 'public/images/albums/p4d2-bad'))).toBe(false);
    expect(fs.existsSync(path.join(mizukiRoot, 'public/images/albums/p4d2-bad2'))).toBe(false);
  });

  // ── 锚③ media-ref 纯逻辑 ──

  it('③ toSiteReference 形态归一：public/ 剥段、绝对路径原样、外链原样；isExternalUrl 判定', () => {
    // API 原始 path（fs 形态）→ 站点 URL（#3 断点修复口径）
    expect(toSiteReference('public/images/uploads/a.png')).toBe('/images/uploads/a.png');
    // 站点绝对路径原样
    expect(toSiteReference('/images/albums/trip/1.jpg')).toBe('/images/albums/trip/1.jpg');
    // 外链 http(s) 原样（不受归一影响）
    expect(toSiteReference('https://cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg');
    expect(toSiteReference('http://cdn.example.com/y.jpg')).toBe('http://cdn.example.com/y.jpg');
    // 相对段补前导斜杠；'/.' 类噪声段剔除
    expect(toSiteReference('images/a.png')).toBe('/images/a.png');
    expect(toSiteReference('/./images//b.png')).toBe('/images/b.png');
    // 判定面
    expect(isExternalUrl('https://a.example/x.jpg')).toBe(true);
    expect(isExternalUrl('HTTP://A.EXAMPLE/X.JPG')).toBe(true);
    expect(isExternalUrl('/images/uploads/a.png')).toBe(false);
    expect(isExternalUrl('public/images/uploads/a.png')).toBe(false);
  });

  // ── 锚④ 引用组装纯逻辑（T3 自动引用 + T5 编辑器插图的共同出口） ──

  it('④ appendImageRef 追加不去重（幂等语义=新建条目）+ markdownImageRef 形状', () => {
    // 追加：public/ 形态归一后入列；返回新数组不改入参
    const list = ['/images/diary/1.jpg'];
    const next = appendImageRef(list, 'public/images/uploads/a.png');
    expect(next).toEqual(['/images/diary/1.jpg', '/images/uploads/a.png']);
    expect(list).toEqual(['/images/diary/1.jpg']);
    // 外链原样追加；同一 URL 再次追加不去重（与媒体库「新建条目」契约对齐）
    expect(appendImageRef(next, 'https://cdn.example.com/z.jpg')).toEqual([
      '/images/diary/1.jpg',
      '/images/uploads/a.png',
      'https://cdn.example.com/z.jpg',
    ]);
    expect(appendImageRef(next, 'public/images/uploads/a.png')).toHaveLength(3);
    // 编辑器插图 Markdown 形状（alt 可缺省）
    expect(markdownImageRef('/images/uploads/a.png', 'cat')).toBe('![cat](/images/uploads/a.png)');
    expect(markdownImageRef('https://cdn.example.com/z.jpg')).toBe('![](https://cdn.example.com/z.jpg)');
  });

  // ── 锚⑤ 相册外链 additive：site-path 全链 + 存量宽容/写入收紧分界 ──

  it('⑤ 存量非规 photos：纯元信息 PATCH 放行（零破坏），photos 触达时收紧 400；site-path 增补放行', async () => {
    // 直接落盘一份「存量非规」外链 info.json（ftp src —— 读取面宽容，模拟存量）
    const legacyDir = path.join(mizukiRoot, 'public/images/albums/p4d2-legacy');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyInfo = {
      mode: 'external',
      title: '存量非规',
      cover: 'https://cdn.example.com/legacy/cover.jpg',
      photos: [{ src: 'ftp://legacy.example/old.jpg', alt: 'legacy' }],
    };
    fs.writeFileSync(path.join(legacyDir, 'info.json'), JSON.stringify(legacyInfo, null, 2));

    // 读取面宽容：列表可见（AlbumInfoSchema 无 src 收紧）
    const list = await server().get('/api/v1/admin/albums');
    expect(list.status).toBe(200);
    const legacy = (list.body as AlbumViewLike[]).find((entry) => entry.name === 'p4d2-legacy');
    expect(legacy).toBeDefined();
    expect(legacy!.info.photos![0]!.src).toBe('ftp://legacy.example/old.jpg');

    // 纯元信息 PATCH（不触 photos/mode）→ 200：存量非规数据零打扰
    const metaOnly = await server()
      .patch('/api/v1/admin/albums/p4d2-legacy')
      .send({ title: '存量非规（改标题）' });
    expect(metaOnly.status).toBe(200);
    expect((readInfoJson('p4d2-legacy')['photos'] as ExternalPhotoLike[])[0]!.src).toBe(
      'ftp://legacy.example/old.jpg',
    );

    // photos 批量触达（同一存量数组原样回传）→ 400：写入口径收紧
    const photosTouched = await server()
      .patch('/api/v1/admin/albums/p4d2-legacy')
      .send({ photos: legacyInfo.photos });
    expect(photosTouched.status).toBe(400);

    // site-path src 增补（选择器回填形态）→ 201，追加面全链放行
    const appended = await server().post('/api/v1/admin/albums/p4d2-legacy/external-photos').send({
      src: '/images/albums/p4d2-legacy/new.jpg',
    });
    expect(appended.status).toBe(201);
    const photos = appended.body.info.photos as ExternalPhotoLike[];
    expect(photos).toHaveLength(2);
    expect(photos[1]!.src).toBe('/images/albums/p4d2-legacy/new.jpg');
  });

  // ── 锚⑥ 上传幂等判据：同字节两传 → 新建条目（sha256 仅记录不判定） ──

  it('⑥ 同字节两传 → 两条独立条目（id/path 分离，sha256 一致仅记录），列表可见', async () => {
    const png = await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();

    const first = await server().post('/api/v1/admin/media').attach('file', png, 'same.png');
    expect(first.status).toBe(201);
    const second = await server().post('/api/v1/admin/media').attach('file', png, 'same.png');
    expect(second.status).toBe(201);

    const a = first.body as MediaInfoLike;
    const b = second.body as MediaInfoLike;
    // 新建条目语义：id 与落盘路径各自独立（无去重）
    expect(b.id).not.toBe(a.id);
    expect(b.path).not.toBe(a.path);
    expect(b.path.startsWith('public/images/uploads/')).toBe(true);
    // sha256 一致——仅记录，不参与判定
    expect(b.sha256).toBe(a.sha256);

    const list = await server().get('/api/v1/admin/media');
    expect(list.status).toBe(200);
    const sameName = (list.body as MediaInfoLike[]).filter((row) => row.originalName === 'same.png');
    expect(sameName).toHaveLength(2);
  });
});
