/**
 * [Phase4-E3a] theme/theme.module — 主题注册表模块（ADR-024）
 * [T3b-2b] 追加主题配置域读写：ConfigWriterService + ConfigWriteController
 *   （`GET/PUT/DELETE /admin/config/domains*`，见 ADR-028 §17.6）。
 * [职责] ThemeRegistryService（扫描/基线/漂移轴/探针轴/门禁）+ ThemeAdapterService
 *   （三档识别与能力画像）+ ConfigWriterService（配置域读写）；
 *   导出 ThemeRegistryService 供 site-config 门禁注入（T4）。
 * [DI 注记] `ConfigWriterService` 构造注入 `BackupService` —— 它来自 `@Global()` 的
 *   `InfraBackupModule`，**无需 import 任何 Module**（与其他领域模块同口径）。
 *   ⚠ 该服务对本类的导入必须是**值导入**：`emitDecoratorMetadata: true` 下 Nest 靠运行期
 *   `design:paramtypes` 解析构造参数，`import type` 会被擦除并导致装配期报错。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { ConfigWriteController } from './config-write.controller';
import { ConfigWriterService } from './config-writer.service';
import { ThemeAdapterService } from './theme-adapter.service';
import { ThemeController } from './theme.controller';
import { ThemeRegistryService } from './theme-registry.service';

@Module({
  providers: [ThemeRegistryService, ThemeAdapterService, ConfigWriterService],
  controllers: [ThemeController, ConfigWriteController],
  exports: [ThemeRegistryService, ThemeAdapterService],
})
export class ThemeModule {}
