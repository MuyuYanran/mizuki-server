import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { logger } from './common/logger';

/**
 * [阶段 P11] main — 引导 + Swagger + 面板静态服务
 * [职责]
 *  - bootstrap：create → configureApp（全局前缀/helmet/CORS/过滤器）
 *    → Swagger（§3.1）→ 静态面板（ADR-009）→ listen
 *  - setupSwagger / setupStaticPanel 导出供 e2e 复用（test/p11-static-panel）
 * [状态] ACTIVE
 */

/** swagger-ui 官方 HTML 含内联初始化脚本（window.onload = SwaggerUIBundle…），
 * helmet 默认 CSP（script-src 'self'）会拦截。仅对 /api/v1/docs* 放宽对应指令
 * （人工裁决：按需放宽、定点注明原因，不整体关闭 helmet）。 */
const SWAGGER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

/** [P11 §3.1] Swagger 文档：/api/v1/docs（JSON 规格于 /api/v1/docs-json），
 * 公开 / 管理 / 系统三分组由各控制器 @ApiTags 落地（见各模块）。 */
export function setupSwagger(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/v1/docs')) {
      res.setHeader('Content-Security-Policy', SWAGGER_CSP);
    }
    next();
  });
  const config = new DocumentBuilder()
    .setTitle('Mizuki-Server API')
    .setDescription(
      '个人博客服务器管理 API。全局前缀 /api/v1；公开端点免认证，' +
        '管理端点需 Bearer Token（POST /api/v1/admin/auth/login 获取，登录限流 5 次/分）。',
    )
    .setVersion('1.0.0')
    .addTag('公开', '/public/** 只读端点（articles / collections / albums）')
    .addTag('管理', '/admin/** 管理端点（JWT 认证）')
    .addTag('系统', '/system/** 健康检查与初始化')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);
}

/**
 * [P11][ADR-009] 面板静态服务（人工裁决方案 1，规格补白）：
 *  - webDist（默认 apps/web/dist，可经 MIZUKI_WEB_DIST 覆盖）不存在 index.html
 *    → 跳过全部静态逻辑（开发模式零行为变化），pino 记录原因；
 *  - 存在 → useStaticAssets 托管产物 + SPA 回退：仅「非 /api 前缀的 GET」
 *    返回 index.html（深链刷新不 404）；/api/** 不受影响，API 404 语义不变。
 */
export function setupStaticPanel(app: NestExpressApplication, webDist: string): boolean {
  if (!existsSync(join(webDist, 'index.html'))) {
    logger.info('未发现 web 构建产物，静态服务未启用');
    return false;
  }
  app.useStaticAssets(webDist);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      // [P11 §6.1 修复] root 相对形式：绝对路径形式下 send 会把 dist 路径按
      // 目录分段做点目录检查（dist 位于点目录如 .test-tmp 内时 404 → 500）
      res.sendFile('index.html', { root: webDist });
      return;
    }
    next();
  });
  logger.info(`面板静态服务已启用（web dist：${webDist}）`);
  return true;
}

/** 引导启动：bin/mizuki-server 经 require(mainPath).bootstrap() 显式调用；
 * 亦可 node dist/main.js 直接运行（见文件尾守卫）。 */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // [P11 §4.1] Swagger 与静态服务均在 configureApp 之后、listen 之前挂载
  setupSwagger(app);
  setupStaticPanel(app, process.env['MIZUKI_WEB_DIST'] ?? join(__dirname, '..', '..', 'web', 'dist'));
  // [P9] 优雅停机信号入口（SIGTERM/SIGINT → OnApplicationShutdown，
  // ProcessManagerService 停全部子进程并关闭 SSE）
  app.enableShutdownHooks();
  const port = Number(process.env.MIZUKI_SERVER_PORT ?? 20154);
  await app.listen(port);
  new Logger('Bootstrap').log(`Mizuki-Server: http://localhost:${port}`);
  new Logger('Bootstrap').log(`Swagger 文档: http://localhost:${port}/api/v1/docs`);
}

// 直接以 node 运行产物（node dist/main.js）才经守卫引导；
// bin/mizuki-server 通过显式调用导出的 bootstrap() 启动（require.main 指向 bin 脚本自身）；
// 测试进程 import 本模块（复用 setupSwagger / setupStaticPanel）不触发 listen。
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void bootstrap();
}
