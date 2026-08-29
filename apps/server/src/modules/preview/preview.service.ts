/**
 * [Phase3-C4] preview/preview.service — /preview 站点预览通道（ADR-019）
 * [职责] Server 自有静态通道直接服务 Astro dist（不托管 astro preview 进程）：
 *   独立 HTTP 监听（随主服务生命周期同启停）+ GET-only + JWT cookie 强制 +
 *   ADR-012 同构四边界（认证 / 路径监狱 / MIME 白名单 / 目录列举禁）。
 * [状态] ACTIVE
 *
 * 安全边界（ADR-019 §四边界映射，与 ADR-012 逐条同构）：
 *   1. 认证先于一切内容判断（含 dist 存在性与引导页）：仅读取固定 cookie 名
 *      mizuki_preview_jwt（管理会话 cookie 命名空间隔离，外来 cookie 不产生
 *      任何行为差异），经 ACCESS_TOKEN_VERIFIER 校验，无效 401；
 *   2. GET-only：非 GET → 405（先于认证，口径从严记 ADR-019）；
 *   3. 路径安全：逐段 decodeURIComponent（编码走私拒绝）+ safeRealJoin
 *      路径监狱（穿越/绝对路径/符号链接逃逸）+ 隐藏文件禁 + 目录列举禁
 *      （目录请求自动补 index.html，尾斜杠归一）；
 *   4. MIME/扩展名白名单：dist 资产类型超集（html/css/js/字体/图片/json 等），
 *      非 ADR-012 图片白名单——对照缺口记 ADR-019；非白名单统一 404（存在性隐藏）。
 *
 * 配置（P11 坑 5 纪律：全部请求期活读 env，不启动快照）：
 *   - MIZUKI_PREVIEW_PORT：缺省 4173；占用 → 启动报错含指引；
 *   - MIZUKI_PREVIEW_HOST：缺省镜像主服务 host（主服务 app.listen 未传 host，
 *     实为全接口，故缺省 undefined 同为全接口；e2e 注入 127.0.0.1）；
 *   - MIZUKI_PREVIEW_DIST_PATH：缺省 <mizukiRoot>/dist（Astro 默认 outDir）。
 */
import { existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';
import { logger } from '../../common/logger';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../../common/guards/jwt-auth.guard';
import { ForbiddenPathError, safeRealJoin } from '../../common/security/safe-join';
import { getAppConfig } from '../../config/app-config';

/** preview cookie 专用名（与管理会话 cookie 命名空间隔离） */
export const PREVIEW_COOKIE = 'mizuki_preview_jwt';

/** 默认端口（Astro preview 惯例端口对齐） */
export const PREVIEW_DEFAULT_PORT = 4173;

/** cookie Max-Age（与 access token TTL 同步：ACCESS_TTL 15m，≤24h 上限内） */
export const PREVIEW_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

/** dist 资产扩展名白名单（ADR-012 图片白名单的超集，对照缺口记 ADR-019） */
const PREVIEW_EXTS = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'json',
  'map',
  'txt',
  'xml',
  'webmanifest',
  'ico',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
]);

/** dist 缺失时的引导页（cookie 校验之后才会到达；引导而非 500） */
const GUIDE_HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>站点预览不可用</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;color:#333">
  <h1>站点预览尚不可用</h1>
  <p>未找到站点构建产物（dist）。请先在管理面板「控制台」执行 <strong>构建（build）</strong> 任务，构建完成后再刷新本页。</p>
  <p style="color:#888">控制台入口：管理面板 → 构建预览控制台 → 构建任务（产物由 Server 预览通道直接托管）。</p>
</body>
</html>
`;

/** 从 cookie 头解析指定键值（零依赖手写；仅认本名，其余 cookie 一律忽略） */
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

/** 统一 JSON 错误体（与 /site-assets 守卫链同构） */
function respondJson(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ code, message, detail: null });
}

@Injectable()
export class PreviewService implements OnApplicationBootstrap, OnApplicationShutdown {
  private server: http.Server | null = null;
  private actualPort = 0;

  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  /** 票据端点下发的实际监听端口（端口 0 注入时为临时端口） */
  get port(): number {
    return this.actualPort;
  }

  /** 随主服务启动（onApplicationBootstrap 失败 → 整个引导失败，满足「占用报错含指引」） */
  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  /** 随主服务停机（enableShutdownHooks → OnApplicationShutdown） */
  async onApplicationShutdown(): Promise<void> {
    if (this.server !== null) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = null;
      logger.info('preview 预览通道已随主服务停机');
    }
  }

  /** e2e 可显式调用（配合端口 0 注入）；生产由生命周期钩子驱动 */
  async start(): Promise<void> {
    const portEnv = process.env['MIZUKI_PREVIEW_PORT'];
    const port = portEnv !== undefined && portEnv !== '' ? Number(portEnv) : PREVIEW_DEFAULT_PORT;
    // 缺省镜像主服务 host：主服务 app.listen(port) 未传 host（全接口），此处
    // undefined 同为全接口；MIZUKI_PREVIEW_HOST 可覆盖（e2e 固定 127.0.0.1）
    const host = process.env['MIZUKI_PREVIEW_HOST'] || undefined;

    const app = express();
    app.disable('x-powered-by');
    app.use((req: Request, res: Response, next: NextFunction) => {
      void this.handle(req, res, next);
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        const hint =
          (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
            ? `（端口 ${port} 可能被占用：可设置环境变量 MIZUKI_PREVIEW_PORT 更换端口，或停止占用该端口的进程）`
            : '';
        reject(new Error(`preview 预览通道监听失败${hint}`));
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        resolve();
      });
    });
    this.server = server;
    const address = server.address();
    this.actualPort = typeof address === 'object' && address !== null ? address.port : port;
    logger.info(
      { host: host ?? '(全接口，镜像主服务)', port: this.actualPort },
      'preview 预览通道已监听（ADR-019：GET-only + JWT cookie，暴露面=管理端）',
    );
  }

  // ── 守卫链（顺序：405 → 401 → dist 根 → 路径安全 → 静态直出） ──

  private async handle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // ── 边界 0：GET-only（先于认证，口径从严；405 不泄露内容面信息） ──
      if (req.method !== 'GET') {
        respondJson(res, 405, 'MethodNotAllowedException', 'preview 通道仅允许 GET');
        return;
      }

      // ── 边界 1：认证（先于 dist 存在性判断与引导页） ──
      // 仅读取固定 cookie 名；外来 cookie（含管理会话 cookie）不产生任何行为差异
      const token = readCookie(req.headers.cookie, PREVIEW_COOKIE);
      if (!token) {
        respondJson(res, 401, 'UnauthorizedException', '缺少预览凭据（请先在管理面板获取站点预览票据）');
        return;
      }
      try {
        await this.verifier.verifyAccessToken(token);
      } catch {
        // 不记录 token 内容（P6 §3.7 同纪律）
        logger.warn({ path: req.path }, 'preview 拒绝：预览凭据无效或已过期');
        respondJson(res, 401, 'UnauthorizedException', '预览凭据无效或已过期（请重新获取站点预览票据）');
        return;
      }

      // ── dist 根解析（env 活读，P11 坑 5 纪律） ──
      const distRoot = this.resolveDistRoot();
      if (distRoot === undefined || !existsSync(distRoot)) {
        // dist 不存在 → 200 引导页（非 500；同样在 cookie 校验之后）。
        // 引导页随 dist 出现即失效，按档① HTML 同值 no-cache（[Phase3-F] ADR-019 追加节）。
        res.status(200).set('Cache-Control', 'no-cache').type('html').send(GUIDE_HTML);
        return;
      }

      // ── 边界 3：路径安全（逐段解码 + 走私拒绝 + 隐藏文件禁） ──
      const segments = this.parseSegments(req.path);
      if (segments === null) {
        respondJson(res, 404, 'NotFoundException', '预览资源不存在');
        return;
      }
      let rel = segments.join('/');
      let targetAbs: string;
      try {
        targetAbs = safeRealJoin(distRoot, rel);
      } catch (error) {
        if (error instanceof ForbiddenPathError) {
          respondJson(res, 404, 'NotFoundException', '预览资源不存在');
          return;
        }
        throw error;
      }
      let stat: import('node:fs').Stats;
      try {
        stat = statSync(targetAbs);
      } catch {
        respondJson(res, 404, 'NotFoundException', '预览资源不存在');
        return;
      }
      // 目录请求自动补 index.html（Astro 扁平结构）+ 尾斜杠归一（/a/ 与 /a 同段集）
      if (stat.isDirectory()) {
        rel = rel === '' ? 'index.html' : `${rel}/index.html`;
      }

      // ── 边界 4：扩展名白名单（作用于最终目标文件；非白名单统一 404 存在性隐藏） ──
      const ext = path.basename(rel).split('.').pop()?.toLowerCase() ?? '';
      if (!PREVIEW_EXTS.has(ext)) {
        respondJson(res, 404, 'NotFoundException', '预览资源不存在');
        return;
      }

      // ── 缓存头三档分派（[Phase3-F] ADR-019 追加节；C4 遗留收官落地） ──
      // 档① HTML 入口 → no-cache；档② _astro/ 内容指纹资产 → immutable；
      // 档③ 其余无指纹资产（public 直拷）→ no-cache（正确性优先，效率次之）。
      // 仅随 sendFile 成功响应（2xx）注入；守卫链 405/401/404 错误路径零影响。
      const headers: Record<string, string> = {};
      if (rel.startsWith('_astro/')) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      } else {
        // 档①③ 同值 no-cache：HTML 每次构建内容可变，public 直拷无内容指纹
        // （Astro 产物实测：_astro 外资产全部稳定命名）——一律可再验证直取。
        headers['Cache-Control'] = 'no-cache';
      }

      // 静态直出（sendFile 以 root 收口相对路径；错误收敛 404；无 SSR/代理/rewrite）
      res.sendFile(rel, { root: distRoot, headers }, (error) => {
        if (error !== undefined) {
          respondJson(res, 404, 'NotFoundException', '预览资源不存在');
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /** dist 根：env 活读；缺省 <mizukiRoot>/dist（mizukiRoot 未配置 → undefined → 引导页） */
  private resolveDistRoot(): string | undefined {
    const envPath = process.env['MIZUKI_PREVIEW_DIST_PATH'];
    if (envPath !== undefined && envPath !== '') {
      return path.resolve(envPath);
    }
    const mizukiRoot = getAppConfig().mizukiRoot;
    return mizukiRoot ? path.join(path.resolve(mizukiRoot), 'dist') : undefined;
  }

  /**
   * 逐段解码（同 ADR-012）：空段跳过；任一段为 '.'/'..'/含分隔符/NUL/以点开头
   * （隐藏文件禁）→ null（404）。req.path 已剥 query（express 路由层语义）。
   */
  private parseSegments(requestPath: string): string[] | null {
    const segments: string[] = [];
    for (const seg of requestPath.split('/')) {
      if (seg === '') {
        continue; // 尾斜杠/重复斜杠归一
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        return null;
      }
      if (
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        decoded.startsWith('.')
      ) {
        return null;
      }
      segments.push(decoded);
    }
    return segments;
  }
}
