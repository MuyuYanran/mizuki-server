/**
 * [Phase2-B1.5][ADR-012] bootstrap/site-assets — /site-assets 站点资产通道
 * [职责] 认证托管 Mizuki `public/` 下的图片（媒体库缩略图 / 相册灯箱 / 集合图片
 *   回显共用），以及 `content-posts` 只读出口（B2/裁决 1）。
 *   自 main.ts 迁出（原 217 行内联守卫链），职责与测试面零变化。
 * [状态] ACTIVE
 *
 * 导出面被 e2e 直接复用（test/p12-site-assets、test/p2b-t6-content-posts、
 * test/p7d-thumbnails），仍经 src/main.ts 门面 re-export。
 *
 * [重构/Wave-1] 守卫链中的四类通用能力改走 common/ 单源，安全语义逐条等价：
 *   - cookie 解析 → common/http/cookie；
 *   - Bearer 提取 → common/http/bearer（与全局 JwtAuthGuard 同一实现）；
 *   - 401/404 响应体 → common/http/json-error（与 AllExceptionsFilter 同形状）；
 *   - 逐段解码与走私拒绝 → common/security/url-path（与 /preview 同源）。
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import { extractBearerToken } from '../common/http/bearer';
import { readCookie } from '../common/http/cookie';
import { respond401, respond404 } from '../common/http/json-error';
import { ACCESS_TOKEN_VERIFIER } from '../common/guards/jwt-auth.guard';
import { logger } from '../common/logger';
import { ForbiddenPathError, safeRealJoin } from '../common/security/safe-join';
import { decodePathSegments } from '../common/security/url-path';
import { getAppConfig } from '../config/app-config';

/** 扩展名白名单（裁决原文逐字）：仅放行图片类，其余一律 404 */
const SITE_ASSET_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif']);

/** 通道命名空间前缀（裁决原文逐字） */
const SITE_ASSET_PREFIX = '/site-assets';

/** access token 经 cookie 注入时的通道专用键名（Path=/site-assets，前端写入） */
export const SITE_ASSET_COOKIE = 'mizuki_asset_token';

/** 站点资产统一拒绝文案（404；存在性与类型差异一律不外泄） */
const NOT_FOUND_MESSAGE = '站点资产不存在或类型不受支持';

/** mizukiRoot/public 缺失时的一次性提示闩（每个进程只打一行 pino） */
let warnedSiteAssetsUnavailable = false;

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

  const handler = (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      try {
        // ── 边界 2 前置：根解析（活取值） ──
        const mizukiRoot = getAppConfig().mizukiRoot;
        if (!mizukiRoot) {
          warnUnavailableOnce('site-assets 未启用：mizukiRoot 未配置（初始化完成后自动生效）', undefined);
          respond404(res, '站点资产不可用');
          return;
        }
        const publicDir = join(mizukiRoot, 'public');
        if (!existsSync(publicDir)) {
          warnUnavailableOnce('site-assets 未启用：<mizukiRoot>/public 目录不存在', publicDir);
          respond404(res, '站点资产不可用');
          return;
        }

        // ── 边界 1：认证（header 优先，cookie 兜底供 <img> 使用） ──
        const token =
          extractBearerToken(req.headers['authorization']) ??
          readCookie(req.headers.cookie, SITE_ASSET_COOKIE);
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
        // 逐段解码 + 走私拒绝（单源）：空段即拒绝（尾斜杠 → 404）为本站口径
        const segments = decodePathSegments(rawRel);
        if (segments === null) {
          respond404(res, NOT_FOUND_MESSAGE);
          return;
        }
        const ext = segments[segments.length - 1]?.split('.').pop()?.toLowerCase() ?? '';
        if (!SITE_ASSET_EXTS.has(ext)) {
          respond404(res, NOT_FOUND_MESSAGE);
          return;
        }

        // ── 边界 2：路径监狱（safeRealJoin：字符串越界 + 符号链接逃逸） ──
        // [B2/裁决 1] content-posts 预览出口：/site-assets/content-posts/<slug>/<rel>
        //   → <mizukiRoot>/src/content/posts/<slug>/<rel>（GET only，只读）。
        //   四条安全边界复用 ADR-012 既有机制零新语义：JWT（上方共用）、
        //   逐段解码与走私拒绝（上方共用）、扩展名白名单（上方共用）、
        //   safeRealJoin 路径监狱与 isFile 复查（下方仅换基目录）。
        //   首段 'content-posts' 为新命名空间（public/ 下同名目录将被本出口
        //   遮蔽——fixture 与官方项目均无该目录，记 SESSIONS B2 报告）。
        const isContentPosts = segments[0] === 'content-posts';
        if (isContentPosts) {
          if (req.method !== 'GET') {
            respond404(res, NOT_FOUND_MESSAGE);
            return;
          }
          // 至少 slug + 文件名两段（仅 slug 的目录请求 404）
          if (segments.length < 3) {
            respond404(res, NOT_FOUND_MESSAGE);
            return;
          }
          // express.static 以 content-posts 根目录为基准解析 req.url，
          // 进入本出口前剥离首段 /content-posts（静态实例按 baseDir 缓存）
          if (typeof req.url === 'string' && req.url.startsWith('/content-posts')) {
            req.url = req.url.slice('/content-posts'.length) || '/';
          }
        }
        const baseDir = isContentPosts ? join(mizukiRoot, 'src', 'content', 'posts') : publicDir;
        const relSegments = isContentPosts ? segments.slice(1) : segments;
        const targetAbs = resolveWithinBase(res, baseDir, relSegments.join('/'));
        if (targetAbs === null) {
          return;
        }
        let stat: import('node:fs').Stats;
        try {
          stat = statSync(targetAbs);
        } catch {
          respond404(res, NOT_FOUND_MESSAGE);
          return;
        }
        if (!stat.isFile()) {
          // 目录与非常规文件拒绝（禁目录列表）
          respond404(res, NOT_FOUND_MESSAGE);
          return;
        }

        // [ADR-012 处方] express.static(<root>/public) 按前缀托管的请求级收口：
        // mizukiRoot 活取值（init 后变更无需重启），static 实例按根目录缓存；
        // Content-Type 由扩展名映射自动为图片 MIME（白名单已先行收口）。
        // fallthrough:false → 文件缺失等错误收敛进回调统一 404，不落入 SPA 回退
        siteAssetServer(baseDir)(req, res, () => {
          respond404(res, NOT_FOUND_MESSAGE);
        });
      } catch (error) {
        next(error);
      }
    })();
  };

  app.use('/site-assets', handler);
  logger.info('site-assets 已挂载（Mizuki public/ 站点资产，需 JWT）');
}

/** 路径监狱包装：越界 → 404（返回 null 表示已回响应） */
function resolveWithinBase(res: Response, baseDir: string, rel: string): string | null {
  try {
    return safeRealJoin(baseDir, rel);
  } catch (error) {
    if (error instanceof ForbiddenPathError) {
      respond404(res, NOT_FOUND_MESSAGE);
      return null;
    }
    throw error;
  }
}

/** 缺失原因在生产环境只提示一次（避免每请求刷屏），pino 承载诊断信息 */
function warnUnavailableOnce(message: string, publicDir: string | undefined): void {
  if (warnedSiteAssetsUnavailable) {
    return;
  }
  warnedSiteAssetsUnavailable = true;
  if (publicDir === undefined) {
    logger.warn(message);
  } else {
    logger.warn({ publicDir }, message);
  }
}

/** express.static 实例按目录缓存（根目录可能因 init 运行期变化） */
function siteAssetServer(baseDir: string): ReturnType<typeof express.static> {
  let server = siteAssetServers.get(baseDir);
  if (server === undefined) {
    // index:false 禁目录首页；dotfiles:'ignore' 隐藏文件不服务
    server = express.static(baseDir, { index: false, fallthrough: false, dotfiles: 'ignore' });
    siteAssetServers.set(baseDir, server);
  }
  return server;
}
const siteAssetServers = new Map<string, ReturnType<typeof express.static>>();
