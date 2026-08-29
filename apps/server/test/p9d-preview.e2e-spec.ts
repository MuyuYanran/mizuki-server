import 'reflect-metadata';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { PreviewService } from '../src/modules/preview/preview.service';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [Phase3-C4] p9d — /preview 预览通道 e2e（supertest + 原生 http，ADR-019）：
 *  ①a 无任何 cookie → 401（auth 先于 dist 存在性判断与引导页）；
 *  ①b 仅携带管理会话 cookie（错误命名空间）→ 401（隔离锚）；
 *  ②  ticket 端点签发 cookie → GET / 200 且内容为 dist/index.html；
 *  ③  POST → 405（GET-only）；ticket 端点未登录 → 401；
 *  ④  路径穿越（../ 及编码变体）→ 404 且响应不出 dist 根；
 *  ⑤  有效 cookie + dist 缺失 → 200 + 引导页 HTML（非 500）；
 *  ⑥  隐藏文件与非白名单扩展名 → 统一 404；
 *  ⑦  子目录页 / 尾斜杠归一 / 静态资产 / _astro immutable 缓存头。
 *
 * 装配：AppModule + mizuki fixture（init/login）；preview 监听一律
 * 127.0.0.1 + 端口 0 注入（禁占用真实 4173）；dist 路径经
 * MIZUKI_PREVIEW_DIST_PATH 活读（P11 坑 5 纪律），测试间可切换。
 */

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const PREVIEW_DIST_FIXTURE = path.resolve(__dirname, 'fixtures/preview-dist');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p9d-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
// preview 监听注入（e2e 纪律：127.0.0.1 + 端口 0）
process.env['MIZUKI_PREVIEW_HOST'] = '127.0.0.1';
process.env['MIZUKI_PREVIEW_PORT'] = '0';
const mizukiRoot = path.join(tmp, 'mizuki');
const NO_DIST = path.join(tmp, 'no-such-dist');

/** 预览通道原生 http 请求（绕过 supertest，直连独立监听） */
function previewRequest(
  port: number,
  method: string,
  requestPath: string,
  cookie?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers: cookie !== undefined ? { Cookie: cookie } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('P9d [Phase3-C4] /preview 预览通道 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  let previewPort = 0;
  let previewCookie: string | undefined;
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
    await app.init();
    sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
    // 端口 0 注入 → 实际端口随监听确定（①a/①b 先于票据签发，直取服务）
    previewPort = app.get(PreviewService).port;
    expect(previewPort).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await app.close();
    sqlite.close();
    // Windows 下临时目录可能被瞬时占用致 rmSync 偶发 EPERM：有限重试后放弃
    // （.tmpvitest 已 gitignore，不留跟踪残留）
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
  const bare = (): request.SuperTest<request.Test> => request(app.getHttpServer());

  // ── ① 认证边界 ──

  it('①a 无任何 cookie → 401（auth 先于 dist 存在性判断与引导页）', async () => {
    // dist 指向不存在目录：若无 cookie 仍 401，证明认证先于引导页
    process.env['MIZUKI_PREVIEW_DIST_PATH'] = NO_DIST;
    const res = await previewRequest(previewPort, 'GET', '/');
    expect(res.status).toBe(401);
    expect(res.body).not.toContain('构建');
  });

  it('①b 仅携带管理会话 cookie（错误命名空间 mizuki_asset_token）→ 401', async () => {
    process.env['MIZUKI_PREVIEW_DIST_PATH'] = PREVIEW_DIST_FIXTURE;
    const res = await previewRequest(previewPort, 'GET', '/', `mizuki_asset_token=${accessToken ?? ''}`);
    expect(res.status).toBe(401);
  });

  // ── ② ticket 签发 + 静态直出 ──

  it('② preview-ticket 签发 cookie → GET / 200 且内容为 dist/index.html', async () => {
    process.env['MIZUKI_PREVIEW_DIST_PATH'] = PREVIEW_DIST_FIXTURE;
    const ticket = await server().post('/api/v1/admin/preview-ticket');
    expect(ticket.status).toBe(201);
    expect(typeof ticket.body.port).toBe('number');
    expect(ticket.body.port).toBeGreaterThan(0);
    previewPort = ticket.body.port;

    const setCookie = ticket.headers['set-cookie'];
    expect(Array.isArray(setCookie)).toBe(true);
    const raw = (setCookie as string[]).find((c) => c.startsWith('mizuki_preview_jwt='));
    expect(raw).toBeDefined();
    // cookie 参数锚：HttpOnly / SameSite=Lax / Path=/；无 Port 属性；TTL ≤ 24h
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Path=/');
    expect(raw).not.toMatch(/;\s*port=/i);
    const maxAge = /Max-Age=(\d+)/i.exec(raw ?? '');
    expect(maxAge !== null && Number(maxAge[1]) <= 86400).toBe(true);
    previewCookie = (raw ?? '').split(';')[0];

    const res = await previewRequest(previewPort, 'GET', '/', previewCookie);
    expect(res.status).toBe(200);
    expect(res.body).toBe(fs.readFileSync(path.join(PREVIEW_DIST_FIXTURE, 'index.html'), 'utf8'));
    expect(String(res.headers['content-type'])).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  // ── ③ GET-only 与票据端点认证 ──

  it('③ POST / → 405（GET-only）；ticket 端点未登录 → 401', async () => {
    const post = await previewRequest(previewPort, 'POST', '/', previewCookie);
    expect(post.status).toBe(405);
    const unauth = await bare().post('/api/v1/admin/preview-ticket');
    expect(unauth.status).toBe(401);
  });

  // ── ④ 路径安全 ──

  it('④ 路径穿越（../ 及编码变体）→ 404 且响应不出 dist 根', async () => {
    for (const target of [
      '/../../secret.txt',
      '/..%2f..%2f..%2fprivate.txt',
      '/%2e%2e/%2e%2e/index.html',
      '/sub/..%2f..%2fnote.md',
      '/..\\index.html',
    ]) {
      const res = await previewRequest(previewPort, 'GET', target, previewCookie);
      expect(res.status).toBe(404);
      // 不泄露 dist 内容（存在性隐藏：统一 JSON 404）
      expect(res.body).not.toContain('PREVIEW-DIST');
      expect(res.body).not.toContain('<html');
    }
  });

  // ── ⑤ dist 缺失 → 引导页 ──

  it('⑤ 有效 cookie + dist 缺失 → 200 + 引导页 HTML（非 500）', async () => {
    process.env['MIZUKI_PREVIEW_DIST_PATH'] = NO_DIST;
    try {
      const res = await previewRequest(previewPort, 'GET', '/', previewCookie);
      expect(res.status).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/html');
      expect(res.body).toContain('构建');
      expect(res.body).toContain('控制台');
    } finally {
      process.env['MIZUKI_PREVIEW_DIST_PATH'] = PREVIEW_DIST_FIXTURE;
    }
  });

  // ── ⑥ 隐藏文件与非白名单扩展名 ──

  it('⑥ 隐藏文件与非白名单扩展名 → 统一 404（存在性隐藏）', async () => {
    const hidden = await previewRequest(previewPort, 'GET', '/.hidden', previewCookie);
    expect(hidden.status).toBe(404);
    expect(hidden.body).not.toContain('HIDDEN-MARKER');
    const md = await previewRequest(previewPort, 'GET', '/note.md', previewCookie);
    expect(md.status).toBe(404);
    expect(md.body).not.toContain('NON-WHITELIST-MARKER');
  });

  // ── ⑦ 子目录页 / 尾斜杠归一 / 静态资产 / 缓存头 ──

  it('⑦ 子目录页自动补 index.html（尾斜杠归一）；svg 资产直出；_astro immutable', async () => {
    const subPage = fs.readFileSync(path.join(PREVIEW_DIST_FIXTURE, 'sub', 'index.html'), 'utf8');
    const noSlash = await previewRequest(previewPort, 'GET', '/sub', previewCookie);
    expect(noSlash.status).toBe(200);
    expect(noSlash.body).toBe(subPage);
    const withSlash = await previewRequest(previewPort, 'GET', '/sub/', previewCookie);
    expect(withSlash.status).toBe(200);
    expect(withSlash.body).toBe(subPage);

    const svg = await previewRequest(previewPort, 'GET', '/assets/logo.svg', previewCookie);
    expect(svg.status).toBe(200);
    expect(String(svg.headers['content-type'])).toContain('image/svg+xml');

    const css = await previewRequest(previewPort, 'GET', '/_astro/app-42a1.css', previewCookie);
    expect(css.status).toBe(200);
    expect(css.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});
