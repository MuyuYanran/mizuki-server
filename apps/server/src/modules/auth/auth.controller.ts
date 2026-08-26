/**
 * [阶段 P6] auth/auth.controller — 认证路由
 * [职责] MASTER-PLAN §5 Auth 路由清单逐字：
 *   POST /admin/auth/login    登录 → { accessToken, refreshToken }（@Public + 路由级限流 5 次/分）
 *   POST /admin/auth/refresh  刷新 Token 对（@Public，轮换）
 *   POST /admin/auth/logout   登出（无状态：返回 200，取舍见交付报告）
 *   GET  /admin/auth/me       当前管理员信息（需 access token）
 * [状态] ACTIVE
 *
 * @Public 豁免清单逐字见 P6 §3.3——logout 不在豁免清单内，需有效 Token。
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { AuthService, LoginBodySchema, RefreshBodySchema, type LoginBodyType, type RefreshBodyType } from './auth.service';

/** 守卫挂载到请求上的认证用户（最小结构） */
interface MeRequest {
  authUser?: AuthenticatedUser;
}

@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 登录独立限流 5 次/分（P6 §3.3）
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(LoginBodySchema)) body: LoginBodyType) {
    return this.auth.login(body.username, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(RefreshBodySchema)) body: RefreshBodyType) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(): { loggedOut: true } {
    // 无状态实现：服务端不维护黑名单，客户端清除 token（P6 §3.1）
    return { loggedOut: true };
  }

  @Get('me')
  me(@Req() req: MeRequest) {
    const user = req.authUser;
    if (!user) {
      // 守卫已保证非公开路由必有认证用户；理论不可达
      return this.auth.me('');
    }
    return this.auth.me(user.id);
  }
}
