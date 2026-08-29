/**
 * [Phase3-C7] site-config 模块 — 主题 config.ts 受控子集管理（override 批，ADR-020）
 * [职责] 装配 SiteConfigController/Service（三端点：GET /admin/config、
 *   PUT /admin/config/lang、PUT /admin/config/comments）。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';

@Module({
  controllers: [SiteConfigController],
  providers: [SiteConfigService],
})
export class SiteConfigModule {}
