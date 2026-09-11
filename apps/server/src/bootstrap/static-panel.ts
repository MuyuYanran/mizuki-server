/**
 * [P11][ADR-009] bootstrap/static-panel — 管理面板静态托管
 * [职责] 面板产物静态服务 + SPA 回退（自 main.ts 迁出）。
 * [状态] ACTIVE
 *
 * 导出面被 e2e 直接复用（test/p11-static-panel），仍经 src/main.ts 门面
 * re-export —— 测试导入路径零变化。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../common/logger';

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
