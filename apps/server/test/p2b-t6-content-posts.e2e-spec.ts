import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { setupSiteAssets } from '../src/main';
import { initAndLogin } from './helpers/admin-auth';

/**
 * [Phase2-B2 / T6 content-posts 预览通道] e2e（裁决 1）：
 * /site-assets 扩挂只读出口 /site-assets/content-posts/<slug>/<rel>
 * → <mizukiRoot>/src/content/posts/<slug>/<rel>（GET only）。
 * 四条安全边界全部复用 ADR-012 既有机制，零新语义：
 *   ① B4 相对路径文章样例（fixture relative-images/figure.png）→ 200 字节一致；
 *   ② 子目录引用（slug 目录内 sub/x.png）→ 200；
 *   ③ 已认证穿越三变体全 404（字面 ../ 段 / %2e%2e 编码段 / 单段内编码走私）；
 *   ④ 无 JWT → 401；
 *   ⑤ 不存在文件（预览层无条件改写、服务端 404）→ 404。
 * 附：GET only（POST 404）、白名单边界（index.md 404）、public 分支回归对照 200。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p2b-t6-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
const CONFIG_PATH = path.join(tmp, 'config.json');
fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mizukiRoot: '' }));
process.env['MIZUKI_CONFIG_PATH'] = CONFIG_PATH;

/** fixture 根的运行期副本（init 时 detector 校验目标） */
const mizukiRoot = path.join(tmp, 'mizuki');
const postsDir = path.join(mizukiRoot, 'src', 'content', 'posts');

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

describe('Phase2-B2 T6 content-posts 预览通道 e2e', () => {
  let app: NestExpressApplication;
  let accessToken: string;

  const server = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (): Record<string, string> => ({ Authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule);
    configureApp(app);
    setupSiteAssets(app);
    await app.init();
    // 运行期副本 + init（活取值生效，免重启）
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    accessToken = await initAndLogin(request(app.getHttpServer()) as never, mizukiRoot);
    // ② 子目录引用靶：slug 目录内子目录图片（运行期构造，fixture 本体不动）
    fs.mkdirSync(path.join(postsDir, 'relative-images', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(postsDir, 'relative-images', 'sub', 'x.png'), 'fake-png-subdir');
    // public 分支回归对照靶
    fs.mkdirSync(path.join(mizukiRoot, 'public', 'images', 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(mizukiRoot, 'public', 'images', 'uploads', 't6-public.png'), 'fake-png-public');
  });

  afterAll(async () => {
    await app.close();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  });

  it('① B4 相对路径文章样例：content-posts/relative-images/figure.png → 200 且字节与源文件一致', async () => {
    const res = await getBinary(server(), '/site-assets/content-posts/relative-images/figure.png', auth());
    expect(res.status).toBe(200);
    const expected = fs.readFileSync(path.join(postsDir, 'relative-images', 'figure.png'));
    expect(res.body).toEqual(expected);
  });

  it('② 子目录引用：content-posts/relative-images/sub/x.png → 200（slug 目录内含子目录）', async () => {
    const res = await getBinary(server(), '/site-assets/content-posts/relative-images/sub/x.png', auth());
    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toBe('fake-png-subdir');
  });

  it('③ 已认证穿越三变体全 404（字面 ../ 段 / %2e%2e 编码段 / 单段内编码走私）', async () => {
    const variants = [
      '/site-assets/content-posts/relative-images/../secret.png',
      '/site-assets/content-posts/relative-images/%2e%2e/secret.png',
      '/site-assets/content-posts/relative-images/..%2Fsecret.png',
    ];
    for (const url of variants) {
      const res = await server().get(url).set(auth());
      expect(res.status).toBe(404);
    }
  });

  it('④ 无 JWT → 401（content-posts 出口同样挂认证之后）', async () => {
    const res = await server().get('/site-assets/content-posts/relative-images/figure.png');
    expect(res.status).toBe(401);
  });

  it('⑤ 不存在文件：预览层无条件改写目标缺失 → 服务端 404', async () => {
    const res = await server().get('/site-assets/content-posts/relative-images/missing.png').set(auth());
    expect(res.status).toBe(404);
  });

  it('附：GET only——POST 带 JWT → 404；slug 目录本身（目录请求）→ 404', async () => {
    const post = await server().post('/site-assets/content-posts/relative-images/figure.png').set(auth());
    expect(post.status).toBe(404);
    const dir = await server().get('/site-assets/content-posts/relative-images').set(auth());
    expect(dir.status).toBe(404);
  });

  it('附：扩展名白名单复用——index.md → 404（md 非图片类）', async () => {
    const res = await server().get('/site-assets/content-posts/relative-images/index.md').set(auth());
    expect(res.status).toBe(404);
  });

  it('附：public 分支回归对照——/site-assets/images/uploads/t6-public.png → 200（既有行为不变）', async () => {
    const res = await getBinary(server(), '/site-assets/images/uploads/t6-public.png', auth());
    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toBe('fake-png-public');
  });
});
