import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { setupStaticPanel, setupSwagger } from '../src/main';

/**
 * [阶段 P11] 静态面板服务 e2e（ADR-009，人工裁决验收项）+ Swagger 三分组
 *
 * 验收四项（裁决 §3）：
 *   1. 有 dist：GET / → 200 且 body 含 <div id="app">
 *   2. GET /api/v1/system/health 仍 200
 *   3. GET /api/v1/public/nonexist 仍 API 404 JSON（而非 index.html）
 *   4. 无 dist：服务正常启动（init 成功），GET / 返回 404 JSON
 *
 * 附加：SPA 深链回退、静态资产、Swagger 三分组（P11 §6.2 每组 ≥2 端点）、
 * CSP 定点放宽（/api/v1/docs* 放宽 script-src，其余路径维持 helmet 默认）。
 *
 * 说明：应用经 NestFactory.create<NestExpressApplication> 创建（与 main.ts
 * bootstrap 同路径），fixture dist 写入系统临时目录——不依赖 apps/web 真实
 * 构建产物，保证 `pnpm test` 在任意环境可复现；真实产物链路由 §6.1 冒烟覆盖。
 */

const FIXTURE_HTML = [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '  <body>',
  '    <div id="app"></div>',
  '  </body>',
  '</html>',
].join('\n');

// [Phase3-C5] 测试数据目录隔离（REQUIREMENTS-PHASE3 §3.4）：本套件三处 AppModule
// 裸启原会以默认路径打开仓库真实 apps/server/data/mizuki.db——现注入 mkdtemp 临时域，
// 与本地实例数据零交集；断言语义零变化（仅落盘点迁移）。
const dataTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p11-data-'));
process.env['MIZUKI_DB_PATH'] = path.join(dataTmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(dataTmp, 'config.json');

describe('P11 静态面板服务 + Swagger 三分组（ADR-009）', () => {
  let appWithDist: NestExpressApplication;
  let appNoDist: NestExpressApplication;
  let fixtureDist: string;
  let emptyDir: string;

  beforeAll(async () => {
    // fixture「web dist」：index.html + assets/app.js（模拟 vite 产物结构）
    fixtureDist = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p11-dist-'));
    fs.writeFileSync(path.join(fixtureDist, 'index.html'), FIXTURE_HTML);
    fs.mkdirSync(path.join(fixtureDist, 'assets'));
    fs.writeFileSync(path.join(fixtureDist, 'assets', 'app.js'), 'console.log("fixture");');
    // 空目录（无 index.html）→ 静态服务应整体跳过
    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p11-nodist-'));

    appWithDist = await NestFactory.create<NestExpressApplication>(AppModule);
    configureApp(appWithDist);
    setupSwagger(appWithDist);
    setupStaticPanel(appWithDist, fixtureDist);
    await appWithDist.init();

    appNoDist = await NestFactory.create<NestExpressApplication>(AppModule);
    configureApp(appNoDist);
    setupSwagger(appNoDist);
    setupStaticPanel(appNoDist, emptyDir);
    await appNoDist.init();
  });

  afterAll(async () => {
    await appWithDist.close();
    await appNoDist.close();
    fs.rmSync(fixtureDist, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
    // [Phase3-C5] 隔离数据域清理：Windows 句柄释放延迟，重试后放弃（.tmpvitest 已 gitignore）
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(dataTmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  describe('有 dist：同源托管 + SPA 回退（裁决验收 1–3）', () => {
    it('GET / → 200 且 body 含 <div id="app">（裁决验收 1）', async () => {
      const res = await request(appWithDist.getHttpServer()).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="app">');
    });

    it('GET /login（SPA 深链）→ 200 回退 index.html（深链刷新不 404）', async () => {
      const res = await request(appWithDist.getHttpServer()).get('/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="app">');
    });

    it('GET /assets/app.js → 200（静态资产由 useStaticAssets 托管）', async () => {
      const res = await request(appWithDist.getHttpServer()).get('/assets/app.js');
      expect(res.status).toBe(200);
      expect(res.text).toContain('fixture');
    });

    it('GET /api/v1/system/health → 200 { status: "ok" }（裁决验收 2）', async () => {
      const res = await request(appWithDist.getHttpServer()).get('/api/v1/system/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /api/v1/public/nonexist → API 404 JSON，而非 index.html（裁决验收 3）', async () => {
      const res = await request(appWithDist.getHttpServer()).get('/api/v1/public/nonexist');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NotFoundException');
      expect(res.text).not.toContain('<div id="app">');
    });
  });

  describe('dist 位于点目录内（§6.1 冒烟修复回归：sendFile 绝对路径形式曾 404→500）', () => {
    let appDotDist: NestExpressApplication;
    let dotDist: string;

    beforeAll(async () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p11-dot-'));
      dotDist = path.join(parent, '.webdist'); // 模拟部署于 .test-tmp 类点目录下
      fs.mkdirSync(dotDist);
      fs.writeFileSync(path.join(dotDist, 'index.html'), FIXTURE_HTML);

      appDotDist = await NestFactory.create<NestExpressApplication>(AppModule);
      configureApp(appDotDist);
      setupSwagger(appDotDist);
      setupStaticPanel(appDotDist, dotDist);
      await appDotDist.init();
    });

    afterAll(async () => {
      await appDotDist.close();
      fs.rmSync(path.dirname(dotDist), { recursive: true, force: true });
    });

    it('GET /login（SPA 回退）→ 200 index.html，不被 send 点目录检查拦截', async () => {
      const res = await request(appDotDist.getHttpServer()).get('/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="app">');
    });

    it('GET / → 200（useStaticAssets 路径同样不受点目录影响）', async () => {
      const res = await request(appDotDist.getHttpServer()).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="app">');
    });
  });

  describe('无 dist：静态服务跳过（裁决验收 4）', () => {
    it('应用正常 init（本 describe 可运行即为证）且 GET / → 404 JSON，不返回 index.html', async () => {
      const res = await request(appNoDist.getHttpServer()).get('/');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NotFoundException');
      expect(res.text).not.toContain('<div id="app">');
    });

    it('GET /api/v1/system/health → 200（API 行为不受影响）', async () => {
      const res = await request(appNoDist.getHttpServer()).get('/api/v1/system/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('Swagger 文档（P11 §3.1 / §6.2）', () => {
    it('GET /api/v1/docs → 200 HTML（Swagger UI）', async () => {
      const res = await request(appWithDist.getHttpServer()).get('/api/v1/docs');
      expect(res.status).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/html');
    });

    it('GET /api/v1/docs-json → 三分组齐全且每组 ≥2 个端点', async () => {
      const res = await request(appWithDist.getHttpServer()).get('/api/v1/docs-json');
      expect(res.status).toBe(200);

      const doc = res.body as {
        paths: Record<string, Record<string, { tags?: string[]; summary?: string }>>;
      };
      const counts: Record<string, number> = {};
      for (const methods of Object.values(doc.paths)) {
        for (const op of Object.values(methods)) {
          for (const tag of op.tags ?? []) {
            counts[tag] = (counts[tag] ?? 0) + 1;
          }
        }
      }
      expect(counts['公开']).toBeGreaterThanOrEqual(2);
      expect(counts['管理']).toBeGreaterThanOrEqual(2);
      expect(counts['系统']).toBeGreaterThanOrEqual(2);

      // 每组抽查两个端点：方法 + 路径 + 摘要齐全（§3.1）
      expect(doc.paths['/api/v1/public/articles']?.['get']?.summary).toBeTruthy();
      expect(doc.paths['/api/v1/public/albums']?.['get']?.summary).toBeTruthy();
      expect(doc.paths['/api/v1/admin/auth/login']?.['post']?.summary).toBeTruthy();
      expect(doc.paths['/api/v1/admin/posts']?.['get']?.summary).toBeTruthy();
      expect(doc.paths['/api/v1/system/health']?.['get']?.summary).toBeTruthy();
      expect(doc.paths['/api/v1/system/init']?.['post']?.summary).toBeTruthy();
    });

    it('CSP 定点放宽：/api/v1/docs 允许内联脚本，面板路径维持 helmet 默认', async () => {
      const docs = await request(appWithDist.getHttpServer()).get('/api/v1/docs');
      expect(String(docs.headers['content-security-policy'])).toContain("script-src 'self' 'unsafe-inline'");

      const panel = await request(appWithDist.getHttpServer()).get('/');
      expect(String(panel.headers['content-security-policy'])).not.toContain("script-src 'self' 'unsafe-inline'");
    });
  });
});
