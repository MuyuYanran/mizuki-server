import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SITE_ASSET_COOKIE, setupSiteAssets, setupSwagger } from '../src/main';
import { resetAppConfigCache } from '../src/config/app-config';
import { initAndLogin } from './helpers/admin-auth';

/**
 * [Phase2-B1.5] /site-assets 站点资产通道 e2e（ADR-012 第三次规格补白）
 *
 * 裁决验收逐条：
 *   - fixture 项目 public/images 放测试图 → 带 token GET 200 且 content-type 图片；
 *   - 无 token → 401（header 与 cookie 双通道缺席均拒）；
 *   - ../ 穿越 → 404（含百分号编码变体）；
 *   - 图片扩展名之外文件 → 404；
 *   - mizukiRoot 未配置时全路由不存在且不影响其他端点（health 200）；
 *   - init 后无须重启即生效（getAppConfig 活取值，P11 坑 5 回接）。
 *
 * 回归：不触碰 PUBLIC API 冻结清单；本套件与 p11-static-panel（面板静态
 * 服务）互补，未重复其用例。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p12-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
const CONFIG_PATH = path.join(tmp, 'config.json');
// 阶段一：未配置形态（mizukiRoot 空串——loadAppConfig 的默认值语义）
fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mizukiRoot: '' }));
process.env['MIZUKI_CONFIG_PATH'] = CONFIG_PATH;

/** fixture 根的运行期副本（init 时 detector 校验目标） */
const mizukiRoot = path.join(tmp, 'mizuki');
const publicDir = path.join(mizukiRoot, 'public');

/** 二进制响应取回原始字节（superagent 默认不缓冲 image/*，显式收集 chunk） */
function getBinary(
  server: ReturnType<typeof request>,
  urlPath: string,
  headers: Record<string, string>,
): Promise<request.Response> {
  return new Promise((resolve, reject) => {
    const req = server.get(urlPath).set(headers);
    void req
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .end((err, res) => (err ? reject(err) : resolve(res)));
  });
}

describe('P12 site-assets 站点资产通道（ADR-012）', () => {
  let app: NestExpressApplication;
  let accessToken: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule);
    configureApp(app);
    setupSwagger(app);
    setupSiteAssets(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // Windows 下杀毒/索引可短暂锁住新建目录，重试清理（P11 冒烟同坑）
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  });

  describe('mizukiRoot 未配置：通道整体不存在且不影响其他', () => {
    it('GET /api/v1/system/health → 200（不影响其他端点）', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/system/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /site-assets/images/x.png → 404（未配置即整路由不存在）', async () => {
      const res = await request(app.getHttpServer()).get('/site-assets/images/x.png');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NotFoundException');
    });
  });

  describe('配置后（免重启生效）：认证 / MIME 白名单 / 路径监狱', () => {
    let pngBuffer: Buffer;

    beforeAll(async () => {
      // 运行期向 fixture 副本 public/images 放测试图（裁决验收原文：放测试图入 fixture 项目）
      fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
      fs.mkdirSync(path.join(publicDir, 'images'), { recursive: true });
      fs.writeFileSync(path.join(publicDir, 'images', 'note.txt'), '非图片内容，白名单外');
      pngBuffer = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#e8739e' },
      })
        .png()
        .toBuffer();
      fs.writeFileSync(path.join(publicDir, 'images', 'test.png'), pngBuffer);

      // 配置热更新：写回 config.json + 重置进程内缓存（模拟 init 向导写入路径）
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify({ mizukiRoot, mode: 'manage', uploadLimitMb: 10 }),
      );
      resetAppConfigCache();

      accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
    });

    it('带 token GET /site-assets/images/test.png → 200 且 content-type image/png、字节一致', async () => {
      const res = await getBinary(
        request(app.getHttpServer()),
        '/site-assets/images/test.png',
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.body as Buffer).toEqual(pngBuffer);
    });

    it('cookie 通道送达：仅凭通道 cookie（<img> 场景）→ 200', async () => {
      const res = await getBinary(request(app.getHttpServer()), '/site-assets/images/test.png', {
        Cookie: `${SITE_ASSET_COOKIE}=${encodeURIComponent(accessToken)}`,
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect((res.body as Buffer).length).toBe(pngBuffer.length);
    });

    it('无任何凭据 → 401（既无 header 也无 cookie）', async () => {
      const res = await request(app.getHttpServer()).get('/site-assets/images/test.png');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UnauthorizedException');
    });

    it('伪造 token（无法验签）→ 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/site-assets/images/test.png')
        .set('Authorization', 'Bearer forged.token.value');
      expect(res.status).toBe(401);
    });

    it('编码穿越变体（..%2F 拼接 / %2e%2e 段）→ 404，不泄露通道外文件', async () => {
      for (const urlPath of [
        '/site-assets/..%2fimages%2ftest.png',
        '/site-assets/%2e%2e/test.png',
        '/site-assets/%2e%2e/%2e%2e/package.json',
      ]) {
        const res = await request(app.getHttpServer())
          .get(urlPath)
          .set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('"name"');
      }
    });

    it('图片扩展名之外的文件 → 404（扩展名白名单）', async () => {
      const res = await request(app.getHttpServer())
        .get('/site-assets/images/note.txt')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('非图片内容');
    });

    it('目录请求（尾部斜杠）→ 404（禁目录列表）', async () => {
      const res = await request(app.getHttpServer())
        .get('/site-assets/images/')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(404);
    });

    it('媒体上传产物经通道可取：POST /admin/media → GET 200（媒体库缩略图数据源实证）', async () => {
      const mediaPng = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer();
      const uploaded = await request(app.getHttpServer())
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', mediaPng, { filename: 'via-channel.png', contentType: 'image/png' });
      expect([200, 201]).toContain(uploaded.status);
      const relPath = uploaded.body.path as string;
      expect(relPath).toMatch(/^public\/images\/uploads\/.+$/);
      const urlPath = `/site-assets/${relPath.replace(/^public\//, '')}`;
      const served = await request(app.getHttpServer())
        .get(urlPath)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toContain('image/png');
    });
  });
});
