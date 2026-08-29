/**
 * [Phase3-C4] preview/preview.controller — preview-ticket 签发端点（ADR-019）
 * [职责] POST /api/v1/admin/preview-ticket（管理端认证，全局 JWT 守卫）：
 *   将调用方 access token 写入 preview 专用 cookie（mizuki_preview_jwt，
 *   HttpOnly/SameSite=Lax/Path=/，**不加 Port 属性**——RFC 6265 host-wide
 *   语义，跨端口共享正是本场景所需；6265bis Port 属性不用——浏览器支持
 *   不齐且非所需；localhost http 下无 Secure，记 ADR-019 已知限制）并
 *   下发实际监听端口 {port}（禁前端硬编码端口）。
 * [状态] ACTIVE
 *
 * cookie 值复用调用方 access token（同一 verifier/secret，同 JWT 保护级）；
 * Max-Age 与 ACCESS_TTL 同步（15m ≤ 24h 上限）；过期后重取票据即可。
 */
import { Controller, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PREVIEW_COOKIE, PREVIEW_COOKIE_MAX_AGE_MS, PreviewService } from './preview.service';

/** 从 Authorization 头提取 Bearer token（与 jwt-auth.guard 同构的最小实现） */
function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : undefined;
}

@ApiTags('管理')
@Controller('admin/preview-ticket')
export class PreviewController {
  constructor(private readonly preview: PreviewService) {}

  @ApiOperation({ summary: '签发站点预览 cookie 并下发预览端口（Set-Cookie mizuki_preview_jwt + {port}）' })
  @Post()
  issue(@Req() req: Request, @Res({ passthrough: true }) res: Response): { port: number } {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('缺少认证凭据（需要 Authorization: Bearer <token>）');
    }
    res.cookie(PREVIEW_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: PREVIEW_COOKIE_MAX_AGE_MS,
      // Secure 不设置：localhost http 形态（ADR-019 已知限制）
    });
    return { port: this.preview.port };
  }
}
