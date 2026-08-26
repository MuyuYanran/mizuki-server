/**
 * [阶段 P8] settings 模块
 * [职责] 站点运行态设置（site_setting key-value）；
 *   Mizuki config 接管属二期范围（本阶段仅服务端自身运行态）。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
