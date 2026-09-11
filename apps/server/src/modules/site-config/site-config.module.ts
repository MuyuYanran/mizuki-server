/**
 * [Phase3-C7] site-config 模块 — 主题 config.ts 受控子集管理（override 批，ADR-020）
 * [职责] 装配 SiteConfigController/Service（四端点：GET /admin/config、
 *   PUT /admin/config/lang、PUT /admin/config/comments、PUT /admin/config/nav）。
 * [Phase4-E3a] 引入 ThemeModule：物化写入器前置探针门禁（T4，ADR-024）。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { ThemeModule } from '../theme/theme.module';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';

@Module({
  imports: [ThemeModule],
  controllers: [SiteConfigController],
  providers: [SiteConfigService],
})
export class SiteConfigModule {}
