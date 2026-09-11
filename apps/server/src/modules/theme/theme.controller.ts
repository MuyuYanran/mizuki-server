/**
 * [Phase4-E3a] theme/theme.controller — 主题注册表管理接口（ADR-024）
 * [职责] admin 族 additive 两端点（/public 零变化）：
 *   GET  /admin/theme/status   身份 + 指纹时间戳 + 漂移三态 + 探针结果（全只读）
 *   POST /admin/theme/capture  live 指纹 → 基线快照（重置漂移轴；探针轴不受影响）
 * 全部需认证（P6 全局守卫）。漂移呈现面板属 E3b（本批零前端实现）。
 * [状态] ACTIVE
 */
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ThemeStatusView } from '@mizuki/shared';
import { ThemeRegistryService } from './theme-registry.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/theme')
export class ThemeController {
  constructor(private readonly registry: ThemeRegistryService) {}

  @ApiOperation({ summary: '主题状态（身份 + 指纹 + 漂移三态 + 声明探针）' })
  @Get('status')
  getStatus(): ThemeStatusView {
    return this.registry.getStatus();
  }

  @ApiOperation({ summary: '捕获主题基线（重置漂移轴；探针轴不受影响）' })
  @Post('capture')
  @HttpCode(HttpStatus.CREATED)
  capture(): ThemeStatusView {
    return this.registry.captureBaseline();
  }
}
