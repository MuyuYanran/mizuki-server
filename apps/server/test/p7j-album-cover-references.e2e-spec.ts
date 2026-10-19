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
import { MediaReferenceRegistry } from '../src/common/registry/media-reference.registry';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [U3-P2/K4+T5] 相册封面/照片引用注册表 e2e（B-P2-09 由占位转实装）
 *
 * 覆盖面：
 * ① 上传媒体 → 外链相册 cover 写 `/images/uploads/<file>` 站点形态 → 删媒体 409
 *    + detail.references 含 refType='album-cover' 与相册名；
 * ② cover 写 `public/images/uploads/<file>` 形态（mediaPath 原样）→ 同样 409；
 * ③ cover 写 https 外链 → 不拦（外链不归媒体库管）；
 * ④ photos[].src 写站点形态 → 409 且 refType='album-photo'；
 * ⑤ 裸文件名 cover → 跳过不拦（裸名不可能对账命中，注释写明）；
 * ⑥ 动态重扫：改 cover 为外链 → 同一媒体可删（引用注册表非缓存快照）；
 * ⑦ 本地相册（mode=local）无引用回归：本地图片不产生引用，媒体可删。
 *
 * 路径口径（K4）：media_file.path 恒为 `public/images/uploads/<nanoid>.<ext>`，
 * 删除检查是精确串等，故注册值须归一到该形态——本 spec 双向验证归一链路。
 * 注：mkdtemp 临时域（fixture cpSync 副本），真实主题目录零触碰。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7j-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

describe('[U3-P2] 相册媒体引用注册表 e2e（B-P2-09）', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

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
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
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

  /** 生成最小 PNG（与 p7 系列同法：sharp 合成纯色块） */
  async function makeImage(size = 12): Promise<Buffer> {
    return sharp({
      create: { width: size, height: size, channels: 3, background: { r: 30, g: 160, b: 220 } },
    })
      .png()
      .toBuffer();
  }

  type MediaRow = { id: string; path: string };

  /** 上传一张图 → 返回 { id, path }（path 恒为 public/images/uploads/<nanoid>.png） */
  async function uploadMedia(fileName: string): Promise<MediaRow> {
    const res = await server()
      .post('/api/v1/admin/media')
      .attach('file', await makeImage(), fileName);
    expect(res.status).toBe(201);
    return res.body as MediaRow;
  }

  /** 站点 URL 形态：public/images/uploads/x.png → /images/uploads/x.png */
  const toSitePath = (mediaPath: string): string => `/${mediaPath.replace(/^public\//, '')}`;

  type DeleteConflict = {
    message: string;
    detail?: { references?: { refType: string; targetLabel: string }[] };
  };

  it('① cover 写 /images/ 站点形态 → 删媒体 409 + refType=album-cover + 相册名', async () => {
    const media = await uploadMedia('cover-site.png');
    const create = await server().post('/api/v1/admin/albums').send({
      name: 'u3p2-cover-site',
      info: {
        mode: 'external',
        title: '站点形态封面',
        cover: toSitePath(media.path),
        photos: [],
      },
    });
    expect(create.status).toBe(201);

    const del = await server().delete(`/api/v1/admin/media/${media.id}`);
    expect(del.status).toBe(409);
    const body = del.body as DeleteConflict;
    const refs = body.detail?.references ?? [];
    expect(refs.some((ref) => ref.refType === 'album-cover')).toBe(true);
    expect(refs.some((ref) => ref.targetLabel === 'u3p2-cover-site')).toBe(true);
    // 媒体文件仍在盘上（删除被拦）
    expect(fs.existsSync(path.join(mizukiRoot, media.path))).toBe(true);
  });

  it('② cover 写 public/ 形态 → 同一精确串等对账 409（mediaPath 原样直通）', async () => {
    const media = await uploadMedia('cover-public.png');
    const create = await server().post('/api/v1/admin/albums').send({
      name: 'u3p2-cover-public',
      info: {
        mode: 'external',
        title: 'public 形态封面',
        cover: media.path, // 已是 mediaPath 形态
        photos: [],
      },
    });
    expect(create.status).toBe(201);
    const del = await server().delete(`/api/v1/admin/media/${media.id}`);
    expect(del.status).toBe(409);
    expect(
      (del.body as DeleteConflict).detail?.references?.some(
        (ref) => ref.refType === 'album-cover' && ref.targetLabel === 'u3p2-cover-public',
      ),
    ).toBe(true);
  });

  it('③ cover 写 https 外链 → 不在注册表内，媒体可删（200）', async () => {
    const media = await uploadMedia('unreferenced.png');
    const create = await server().post('/api/v1/admin/albums').send({
      name: 'u3p2-cover-https',
      info: {
        mode: 'external',
        title: '外链封面',
        cover: 'https://cdn.example.com/cover.jpg',
        photos: [],
      },
    });
    expect(create.status).toBe(201);
    const del = await server().delete(`/api/v1/admin/media/${media.id}`);
    expect(del.status).toBe(200); // 外链不归媒体库管
    expect(fs.existsSync(path.join(mizukiRoot, media.path))).toBe(false);
  });

  it('④ photos[].src 写站点形态 → 409 且 refType=album-photo', async () => {
    const media = await uploadMedia('photo-site.png');
    const create = await server().post('/api/v1/admin/albums').send({
      name: 'u3p2-photo',
      info: {
        mode: 'external',
        title: '照片引用',
        cover: 'https://cdn.example.com/cover.jpg',
        photos: [{ src: toSitePath(media.path), alt: '本地媒体' }],
      },
    });
    expect(create.status).toBe(201);
    const del = await server().delete(`/api/v1/admin/media/${media.id}`);
    expect(del.status).toBe(409);
    expect(
      (del.body as DeleteConflict).detail?.references?.some(
        (ref) => ref.refType === 'album-photo' && ref.targetLabel === 'u3p2-photo',
      ),
    ).toBe(true);
  });

  it('⑤ cover 写裸文件名 → 跳过不拦（裸名不可能对账命中 mediaPath）', async () => {
    const media = await uploadMedia('bare-name.png');
    const create = await server().post('/api/v1/admin/albums').send({
      name: 'u3p2-bare',
      info: {
        mode: 'external',
        title: '裸名封面',
        cover: 'cover.jpg',
        photos: [],
      },
    });
    expect(create.status).toBe(201);
    const del = await server().delete(`/api/v1/admin/media/${media.id}`);
    expect(del.status).toBe(200);
  });

  it('⑥ 动态重扫：改 cover 为外链后同一媒体可删（注册表非缓存快照）', async () => {
    const media = await uploadMedia('dynamic.png');
    const create = await server().post('/api/v1/admin/albums').send({
      name: 'u3p2-dynamic',
      info: {
        mode: 'external',
        title: '动态重扫',
        cover: toSitePath(media.path),
        photos: [],
      },
    });
    expect(create.status).toBe(201);
    expect((await server().delete(`/api/v1/admin/media/${media.id}`)).status).toBe(409);

    // 改封面为外链 → info.json 落盘更新 → 再次删除应放行
    const patch = await server()
      .patch('/api/v1/admin/albums/u3p2-dynamic')
      .send({ cover: 'https://cdn.example.com/dynamic-cover.jpg' });
    expect(patch.status).toBe(200);
    const del = await server().delete(`/api/v1/admin/media/${media.id}`);
    expect(del.status).toBe(200);
  });

  it('⑦ 本地相册（mode=local）无引用回归：本地图片不产生媒体库引用', async () => {
    const media = await uploadMedia('local-album.png');
    // 本地模式相册：cover/photos 非其字段面，info.json 自行持有图片
    const create = await server().post('/api/v1/admin/albums').send({
      name: 'u3p2-local',
      info: { mode: 'local', title: '本地相册' },
    });
    expect(create.status).toBe(201);
    // 本地图片上传（相册自持，不经媒体库）
    const img = await server()
      .post('/api/v1/admin/albums/u3p2-local/images')
      .attach('file', await makeImage(), 'inside.png');
    expect(img.status).toBe(201);

    const del = await server().delete(`/api/v1/admin/media/${media.id}`);
    expect(del.status).toBe(200); // 本地模式不入注册表
  });

  it('⑧ 注册表贡献者断言：albums 贡献者已注册且返回数组（机制可调用）', async () => {
    const registry = app.get(MediaReferenceRegistry);
    const refs = await registry.collectAll();
    expect(Array.isArray(refs)).toBe(true);
    // 每个引用形状合法（refType / targetLabel / mediaPath 三字段齐全）
    for (const ref of refs) {
      expect(typeof ref.refType).toBe('string');
      expect(typeof ref.targetLabel).toBe('string');
      expect(typeof ref.mediaPath).toBe('string');
      expect(ref.mediaPath.includes('/')).toBe(true); // mediaPath 恒含 '/'
    }
  });
});
