/**
 * [阶段 P6] auth 模块
 * [职责] 登录（argon2）、JWT 双 Token、me；导出 AuthService 与
 *   ACCESS_TOKEN_VERIFIER（全局 JwtAuthGuard 经后者注入校验器实现）。
 * [状态] ACTIVE
 *
 * 分层：auth（L3）imports SystemModule（L3，取 MizukiDetectorService，
 * 供 init 流程检测目录；L3 互导合法）。SystemModule 反向经
 * forwardRef(AuthModule) 取得 AuthService（init 端点），打破启动期循环。
 */
import { forwardRef, Module } from '@nestjs/common';
import { ACCESS_TOKEN_VERIFIER } from '../../common/guards/jwt-auth.guard';
import { SystemModule } from '../system/system.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  // 与 SystemModule 互为依赖（detector ← init 端点），双侧 forwardRef 延迟求值
  imports: [forwardRef(() => SystemModule)],
  controllers: [AuthController],
  providers: [
    AuthService,
    // L0 守卫与 L3 实现的跨层解耦点（useExisting：同一实例）
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: AuthService },
  ],
  exports: [AuthService, ACCESS_TOKEN_VERIFIER],
})
export class AuthModule {}
