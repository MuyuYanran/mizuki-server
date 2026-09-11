/**
 * [P11 §3.1] bootstrap/swagger — Swagger 文档挂载
 * [职责] /api/v1/docs 挂载与 Swagger 专用的 CSP 放宽（自 main.ts 迁出，
 *   拆分理由见 bootstrap/ 目录说明）。
 * [状态] ACTIVE
 *
 * 导出面被 e2e 直接复用（test/p11-static-panel、test/p2b-t4-auth-system），
 * 仍经 src/main.ts 门面 re-export —— 测试导入路径零变化。
 */
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

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
