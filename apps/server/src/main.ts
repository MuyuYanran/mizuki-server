import 'reflect-metadata';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { logger } from './common/logger';
import { ACCESS_TOKEN_VERIFIER } from './common/guards/jwt-auth.guard';
import { ForbiddenPathError, safeRealJoin } from './common/security/safe-join';
import { getAppConfig } from './config/app-config';

/**
 * [阶段 P11] main — 引导 + Swagger + 面板静态服务
 * [职责]
 *  - bootstrap：create → configureApp（全局前缀/helmet/CORS/过滤器）
 *    → Swagger（§3.1）→ 站点资产（ADR-012）→ 静态面板（ADR-009）→ listen
 *  - setupSwagger / setupSiteAssets / setupStaticPanel 导出供 e2e 复用
 *    （test/p11-static-panel、test/p12-site-assets）
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
 *  [ADR-012] /site-assets 为全新命名空间：SPA 回退谓词同步排除该前缀，
 *    站点资产请求不会落入 index.html 回退。
 */
export function setupStaticPanel(app: NestExpressApplication, webDist: string): boolean {
  if (!existsSync(join(webDist, 'index.html'))) {
    logger.info('未发现 web 构建产物，静态服务未启用');
    return false;
  }
  app.useStaticAssets(webDist);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/site-assets')) {
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

// ── [Phase2-B1.5][ADR-012] /site-assets 站点资产通道 ─────────────────────

/** 扩展名白名单（裁决原文逐字）：仅放行图片类，其余一律 404 */
const SITE_ASSET_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif']);

/** 通道命名空间前缀（裁决原文逐字） */
const SITE_ASSET_PREFIX = '/site-assets';

/** access token 经 cookie 注入时的通道专用键名（Path=/site-assets，前端写入） */
export const SITE_ASSET_COOKIE = 'mizuki_asset_token';

/** mizukiRoot/public 缺失时的一次性提示闩（每个进程只打一行 pino） */
let warnedSiteAssetsUnavailable = false;

/** 从 cookie 头解析指定键值（零依赖手写；非法编码返回 undefined） */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    if (part.slice(0, eq).trim() !== name) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * [ADR-012] 站点资产服务守卫链（人工裁决第三次规格补白）：
 * Mizuki 博客 public/ 目录的 HTTP 出口——媒体库缩略图、相册灯箱、集合图片
 * 回显共用。安全边界四条（裁决原文，不可破）：
 *   1. 服务于认证之后：Authorization Bearer 或通道 cookie 注入 access token，
 *      校验复用全局守卫同一 AccessTokenVerifier（与 /api/v1 语义完全一致）；
 *   2. 禁目录列表（index:false + isFile 复查），仅服务 <root>/public 子树，
 *      safeRealJoin 路径监狱（含 URL 编码变体与符号链接逃逸防护）；
 *   3. Content-Type/MIME 仅放行图片类扩展名白名单，其余 404；
 *   4. 公开 API 冻结路径零变化（全新命名空间，不触碰任何既有路由）。
 *
 * 守卫顺序（取舍记 ADR/报告）：根解析（未配置→404，不泄露内部状态差异之外
 * 的信息）→ 认证（401）→ 扩展名白名单（404）→ 路径监狱（404）→ 静态服务。
 * mizukiRoot 每请求活取 getAppConfig()（init 后免重启生效，规避 P11 坑 5
 * 启动快照问题）；public 目录缺失时打一行 pino 提示后按 404 拒绝。
 */
export function setupSiteAssets(app: NestExpressApplication): void {
  const verifier = app.get(ACCESS_TOKEN_VERIFIER);

  const respond401 = (res: Response, message: string): void => {
    res.status(401).json({ code: 'UnauthorizedException', message, detail: null });
  };
  const respond404 = (res: Response, message: string): void => {
    res.status(404).json({ code: 'NotFoundException', message, detail: null });
  };

  const handler = (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      try {
        // ── 边界 2 前置：根解析（活取值） ──
        const mizukiRoot = getAppConfig().mizukiRoot;
        if (!mizukiRoot) {
          if (!warnedSiteAssetsUnavailable) {
            warnedSiteAssetsUnavailable = true;
            logger.warn('site-assets 未启用：mizukiRoot 未配置（初始化完成后自动生效）');
          }
          respond404(res, '站点资产不可用');
          return;
        }
        const publicDir = join(mizukiRoot, 'public');
        if (!existsSync(publicDir)) {
          if (!warnedSiteAssetsUnavailable) {
            warnedSiteAssetsUnavailable = true;
            logger.warn({ publicDir }, 'site-assets 未启用：<mizukiRoot>/public 目录不存在');
          }
          respond404(res, '站点资产不可用');
          return;
        }

        // ── 边界 1：认证（header 优先，cookie 兜底供 <img> 使用） ──
        const authHeader = req.headers['authorization'];
        const bearer = /^Bearer\s+(.+)$/i.exec(Array.isArray(authHeader) ? (authHeader[0] ?? '') : (authHeader ?? ''));
        const token =
          bearer?.[1]?.trim() ?? readCookie(req.headers.cookie, SITE_ASSET_COOKIE);
        if (!token) {
          respond401(res, '缺少认证凭据（/site-assets 需有效 JWT）');
          return;
        }
        try {
          await verifier.verifyAccessToken(token);
        } catch {
          // 不记录 token 内容（P6 §3.7 同纪律）
          logger.warn({ path: req.path }, 'site-assets 拒绝：access token 无效或已过期');
          respond401(res, '认证凭据无效或已过期');
          return;
        }

        // ── 边界 3：扩展名白名单（作用于解码后的最终目标路径） ──
        // [挂载语义] 经 app.use(PREFIX, …) 进入时 req.path 已剥前缀；拼接
        // req.baseUrl 还原完整路径后按常量前缀显式切片，规避双重剥离错位
        const fullPath = (req.baseUrl ?? '') + req.path;
        const rawRel = fullPath.startsWith(`${SITE_ASSET_PREFIX}/`)
          ? fullPath.slice(SITE_ASSET_PREFIX.length + 1)
          : '';
        const segments: string[] = [];
        for (const seg of rawRel.split('/')) {
          let decoded: string;
          try {
            decoded = decodeURIComponent(seg);
          } catch {
            respond404(res, '站点资产不存在或类型不受支持');
            return;
          }
          if (
            decoded === '' ||
            decoded === '.' ||
            decoded === '..' ||
            // 单段内不允许再出现任何分隔符（拒 %2f 编码走私的多段路径）
            decoded.includes('/') ||
            decoded.includes('\\') ||
            decoded.includes('\0')
          ) {
            respond404(res, '站点资产不存在或类型不受支持');
            return;
          }
          segments.push(decoded);
        }
        const ext = segments[segments.length - 1]?.split('.').pop()?.toLowerCase() ?? '';
        if (!SITE_ASSET_EXTS.has(ext)) {
          respond404(res, '站点资产不存在或类型不受支持');
          return;
        }

        // ── 边界 2：路径监狱（safeRealJoin：字符串越界 + 符号链接逃逸） ──
        let targetAbs: string;
        try {
          targetAbs = safeRealJoin(publicDir, segments.join('/'));
        } catch (error) {
          if (error instanceof ForbiddenPathError) {
            respond404(res, '站点资产不存在或类型不受支持');
            return;
          }
          throw error;
        }
        let stat: import('node:fs').Stats;
        try {
          stat = statSync(targetAbs);
        } catch {
          respond404(res, '站点资产不存在或类型不受支持');
          return;
        }
        if (!stat.isFile()) {
          // 目录与非常规文件拒绝（禁目录列表）
          respond404(res, '站点资产不存在或类型不受支持');
          return;
        }

        // [ADR-012 处方] express.static(<root>/public) 按前缀托管的请求级收口：
        // mizukiRoot 活取值（init 后变更无需重启），static 实例按根目录缓存；
        // Content-Type 由扩展名映射自动为图片 MIME（白名单已先行收口）。
        // fallthrough:false → 文件缺失等错误收敛进回调统一 404，不落入 SPA 回退
        siteAssetServer(publicDir)(req, res, () => {
          respond404(res, '站点资产不存在或类型不受支持');
        });
      } catch (error) {
        next(error);
      }
    })();
  };

  app.use('/site-assets', handler);
  logger.info('site-assets 已挂载（Mizuki public/ 站点资产，需 JWT）');
}

/** express.static 实例按 public 目录缓存（根目录可能因 init 运行期变化） */
function siteAssetServer(publicDir: string): ReturnType<typeof express.static> {
  let server = siteAssetServers.get(publicDir);
  if (server === undefined) {
    // index:false 禁目录首页；dotfiles:'ignore' 隐藏文件不服务
    server = express.static(publicDir, { index: false, fallthrough: false, dotfiles: 'ignore' });
    siteAssetServers.set(publicDir, server);
  }
  return server;
}
const siteAssetServers = new Map<string, ReturnType<typeof express.static>>();



/** 引导启动：bin/mizuki-server 经 require(mainPath).bootstrap() 显式调用；
 * 亦可 node dist/main.js 直接运行（见文件尾守卫）。 */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // [P11 §4.1] Swagger 与静态服务均在 configureApp 之后、listen 之前挂载；
  // [ADR-012] site-assets 前置于面板 SPA 回退（回退谓词亦已排除该前缀，双保险）
  setupSwagger(app);
  setupSiteAssets(app);
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
