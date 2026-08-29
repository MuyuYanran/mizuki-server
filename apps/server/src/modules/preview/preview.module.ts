/**
 * [Phase3-C4] preview 模块 — /preview 站点预览通道（ADR-019）
 * [职责] PreviewService（独立 HTTP 监听 + ADR-012 同构四边界守卫链）
 *   与 PreviewController（preview-ticket 签发）；imports AuthModule 取
 *   ACCESS_TOKEN_VERIFIER（与 /api/v1 完全同一校验器实现）。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreviewController } from './preview.controller';
import { PreviewService } from './preview.service';

@Module({
  imports: [AuthModule],
  controllers: [PreviewController],
  providers: [PreviewService],
  exports: [PreviewService],
})
export class PreviewModule {}
