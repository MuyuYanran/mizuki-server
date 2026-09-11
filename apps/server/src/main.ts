import 'reflect-metadata';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { setupStaticPanel } from './bootstrap/static-panel';
import { setupSiteAssets } from './bootstrap/site-assets';
import { setupSwagger } from './bootstrap/swagger';
import { getAppConfig } from './config/app-config';

/**
 * [阶段 P11] main — 引导入口（编排 + 对外导出面门面）
 * [职责]
 *  - bootstrap：create → configureApp（全局前缀/helmet/CORS/过滤器）
 *    → Swagger（§3.1）→ 站点资产（ADR-012）→ 静态面板（ADR-009）→ listen
 *  - 三个挂载实现已迁至 src/bootstrap/（swagger / site-assets / static-panel）：
 *    本文件只保留「顺序编排」——顺序本身是规格的一部分（Swagger 与静态服务
 *    均在 configureApp 之后、listen 之前；site-assets 前置于面板 SPA 回退）。
 *  - 下方 re-export 为 e2e 兼容门面（test/p11-static-panel、p12-site-assets、
 *    p2b-t4-auth-system、p2b-t6-content-posts、p7d-thumbnails 均自 '../src/main'
 *    导入），迁出后测试导入路径零变化。
 * [状态] ACTIVE
 */

// ── 导出面门面（e2e 兼容；实现见 src/bootstrap/） ──
export { setupStaticPanel } from './bootstrap/static-panel';
export { SITE_ASSET_COOKIE, setupSiteAssets } from './bootstrap/site-assets';
export { setupSwagger } from './bootstrap/swagger';

/** 引导启动：bin/mizuki-server 经 require(mainPath).bootstrap() 显式调用；
 * 亦可 node dist/main.js 直接运行（见文件尾守卫）。 */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // [P11 §4.1] Swagger 与静态服务均在 configureApp 之后、listen 之前挂载；
  // [ADR-012] site-assets 前置于面板 SPA 回退（回退谓词亦已排除该前缀，双保险）
  // [B2/裁决 6] Swagger 按配置挂载（config.json swagger 字段，默认 true；
  // 公网部署建议置 false——见 README 生产部署清单）
  if (getAppConfig().swagger) {
    setupSwagger(app);
  }
  setupSiteAssets(app);
  setupStaticPanel(app, process.env['MIZUKI_WEB_DIST'] ?? join(__dirname, '..', '..', 'web', 'dist'));
  // [P9] 优雅停机信号入口（SIGTERM/SIGINT → OnApplicationShutdown，
  // ProcessManagerService 停全部子进程并关闭 SSE）
  app.enableShutdownHooks();
  const port = Number(process.env.MIZUKI_SERVER_PORT ?? 20154);
  await app.listen(port);
  new Logger('Bootstrap').log(`Mizuki-Server: http://localhost:${port}`);
  if (getAppConfig().swagger) {
    new Logger('Bootstrap').log(`Swagger 文档: http://localhost:${port}/api/v1/docs`);
  }
}

// 直接以 node 运行产物（node dist/main.js）才经守卫引导；
// bin/mizuki-server 通过显式调用导出的 bootstrap() 启动（require.main 指向 bin 脚本自身）；
// 测试进程 import 本模块（复用 setupSwagger / setupStaticPanel）不触发 listen。
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void bootstrap();
}
