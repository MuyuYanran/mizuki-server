/**
 * [Phase4-E3a] theme/theme.module — 主题注册表模块（ADR-024）
 * [职责] ThemeRegistryService（扫描/基线/漂移轴/探针轴/门禁）+ admin/theme 端点；
 *   导出 ThemeRegistryService 供 site-config 门禁注入（T4）。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { ThemeController } from './theme.controller';
import { ThemeRegistryService } from './theme-registry.service';

@Module({
  providers: [ThemeRegistryService],
  controllers: [ThemeController],
  exports: [ThemeRegistryService],
})
export class ThemeModule {}
