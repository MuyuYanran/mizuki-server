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
import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import {
  AuthService,
  ChangePasswordBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
  type ChangePasswordBody,
  type LoginBodyType,
  type RefreshBodyType,
} from './auth.service';

/** 守卫挂载到请求上的认证用户（最小结构） */
interface MeRequest {
  authUser?: AuthenticatedUser;
}

@ApiTags('管理')
@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: '管理员登录（公开，独立限流 5 次/分）→ accessToken + refreshToken' })
  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 登录独立限流 5 次/分（P6 §3.3）
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(LoginBodySchema)) body: LoginBodyType) {
    return this.auth.login(body.username, body.password);
  }

  @ApiOperation({ summary: '刷新 Token 对（公开，轮换；旧 refreshToken 失效）' })
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(RefreshBodySchema)) body: RefreshBodyType) {
    return this.auth.refresh(body.refreshToken);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: '登出（无状态实现：客户端清除 Token 即可）' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(): { loggedOut: true } {
    // 无状态实现：服务端不维护黑名单，客户端清除 token（P6 §3.1）
    return { loggedOut: true };
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: '当前管理员信息（需 access token）' })
  @Get('me')
  me(@Req() req: MeRequest) {
    const user = req.authUser;
    if (!user) {
      // 守卫已保证非公开路由必有认证用户；理论不可达
      return this.auth.me('');
    }
    return this.auth.me(user.id);
  }

  /**
   * [B2/裁决 5] 修改密码（需 access token）：旧密码 verify + 新密码哈希 +
   * token_version +1 吊销全部 refresh 会话；access 15min 自然过期不吊销。
   * 客户端成功后应清除本地会话并回到登录页。
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改密码（需认证）：旧密码校验 + token_version 递增吊销全部 refresh 会话' })
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Req() req: MeRequest, @Body(new ZodValidationPipe(ChangePasswordBodySchema)) body: ChangePasswordBody) {
    const user = req.authUser;
    if (!user) {
      // 守卫已保证非公开路由必有认证用户；理论不可达
      return this.auth.changePassword('', body.oldPassword, body.newPassword);
    }
    return this.auth.changePassword(user.id, body.oldPassword, body.newPassword);
  }
}
