/**
 * [阶段 P0a] System 模块
 * [职责] 装配系统级端点（健康检查）。
 * [阶段 P6] 提供并导出 MizukiDetectorService（auth 模块的 init 流程使用）；
 *   经 forwardRef(AuthModule) 取得 AuthService（init 端点），
 *   AuthModule → SystemModule 为常规导入，反向以 forwardRef 打破循环。
 * [状态] ACTIVE
 */
import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MizukiDetectorService } from './mizuki-detector.service';
import { SystemController } from './system.controller';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [SystemController],
  providers: [MizukiDetectorService],
  exports: [MizukiDetectorService],
})
export class SystemModule {}
