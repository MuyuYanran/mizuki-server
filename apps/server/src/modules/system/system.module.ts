import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';

/**
 * [阶段 P0a] System 模块
 * [职责] 装配系统级端点（健康检查）。P6 起将在此提供 MizukiDetectorService
 * [状态] ACTIVE
 */
@Module({
  controllers: [SystemController],
})
export class SystemModule {}
