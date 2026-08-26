/**
 * [阶段 P6] common/guards/jwt-auth.guard — 全局 JWT 守卫
 * [职责] 经 APP_GUARD 全局注册（app.module.ts），除 @Public() 路由外
 *   全部要求 `Authorization: Bearer <accessToken>`；校验通过后将
 *   认证用户挂载到请求对象（供操作日志拦截器取 user_id）。
 * [状态] ACTIVE
 *
 * 分层：守卫位于 common/（L0），不直接依赖 auth 模块（L3）——经
 *   ACCESS_TOKEN_VERIFIER 注入 token 与接口解耦（AuthModule 提供
 *   useExisting: AuthService 实现，见 auth.module.ts）。
 * 纪律：守卫拒绝日志不输出 token 内容（P6 §3.7）；
 * 与 P1 ThrottlerGuard 共存，注册顺序保证限流先于认证（app.module.ts）。
 */
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { logger } from '../logger';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** 认证通过后的请求级用户信息（operation-log 拦截器消费 user_id） */
export interface AuthenticatedUser {
  id: string;
  username: string;
}

/** access token 校验契约（实现方：AuthService，经 AuthModule 按 token 提供） */
export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser>;
}

/** AccessTokenVerifier DI token（跨层解耦：L0 守卫 ← token → L3 实现） */
export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

/** 守卫可见的最小请求结构（不依赖 express 全局类型扩展） */
interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  path: string;
  authUser?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const token = extractBearerToken(request.headers['authorization']);
    if (!token) {
      throw new UnauthorizedException('缺少认证凭据（需要 Authorization: Bearer <token>）');
    }
    try {
      request.authUser = await this.verifier.verifyAccessToken(token);
    } catch (error) {
      // 拒绝原因入日志，但不泄露 token 内容
      logger.warn({ path: request.path }, '守卫拒绝：access token 无效或已过期');
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('认证凭据无效或已过期');
    }
    return true;
  }
}

/** 从 Authorization 头提取 Bearer token（格式不符返回 undefined） */
function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : undefined;
}
