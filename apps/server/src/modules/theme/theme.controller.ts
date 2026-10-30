/**
 * [Phase4-E3a] theme/theme.controller — 主题注册表管理接口（ADR-024）
 * [职责] admin 族 additive 端点（/public 零变化）：
 *   GET  /admin/theme/status   身份 + 指纹时间戳 + 漂移三态 + 探针结果（全只读）
 *   GET  /admin/theme/profile  [T1] 主题识别画像（kind / layout / capabilities / 证据链；
 *                             layout.root 绝对路径**已剔除**——仓规红线 6）
 *   POST /admin/theme/capture  live 指纹 → 基线快照（重置漂移轴；探针轴不受影响）
 * 全部需认证（P6 全局守卫）。漂移呈现面板属 E3b（本批零前端实现）。
 * [状态] ACTIVE
 */
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
// [T4-4 汇总] 类型 + 值同批导入：`summarizeContentCapabilities` 是运行时函数
import {
  summarizeContentCapabilities,
  type ContentCapabilitySummary,
  type ThemeAdapterProfileView,
  type ThemeStatusView,
} from '@mizuki/shared';
import { getAppConfig } from '../../config/app-config';
import { ThemeAdapterService } from './theme-adapter.service';
import { ThemeRegistryService } from './theme-registry.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/theme')
export class ThemeController {
  constructor(
    private readonly registry: ThemeRegistryService,
    private readonly adapter: ThemeAdapterService,
  ) {}

  @ApiOperation({ summary: '主题状态（身份 + 指纹 + 漂移三态 + 声明探针）' })
  @Get('status')
  getStatus(): ThemeStatusView {
    return this.registry.getStatus();
  }

  @ApiOperation({ summary: '主题识别画像（识别种类 + 能力面 + 探测证据；不含绝对路径）' })
  @Get('profile')
  getProfile(): ThemeAdapterProfileView {
    const { layout, ...rest } = this.adapter.resolve(
      getAppConfig().mizukiRoot,
      getAppConfig().mode,
    );
    // 逐键重建视图：layout.root 是后端内部字段，绝不进响应体（仓规红线 6）
    return {
      ...rest,
      layout: {
        kind: layout.kind,
        configDir: layout.configDir,
        configFile: layout.configFile,
        dataDir: layout.dataDir,
        contentDir: layout.contentDir,
        postsDir: layout.postsDir,
        publicDir: layout.publicDir,
      },
    };
  }

  /**
   * [T4-2..T4-4 汇总] 内容能力速查（人读摘要）。
   *
   * 为什么不并入 `GET profile`：`profile` 是**机器契约**（六组能力面，面板据此驱动渲染），
   * 加人读文案会让契约混入展示关注点。这里单独一个只读端点，供面板「知识」区与
   * 文档引用；规则仍在 `@mizuki/shared` 的 `summarizeContentCapabilities` 一处。
   */
  @ApiOperation({ summary: '内容能力速查（可纳管文章扩展名 / 是否支持内容集合 / 一句话摘要）' })
  @Get('content-capabilities')
  getContentCapabilities(): ContentCapabilitySummary {
    const { capabilities } = this.adapter.resolve(getAppConfig().mizukiRoot, getAppConfig().mode);
    return summarizeContentCapabilities(capabilities);
  }

  @ApiOperation({ summary: '捕获主题基线（重置漂移轴；探针轴不受影响）' })
  @Post('capture')
  @HttpCode(HttpStatus.CREATED)
  capture(): ThemeStatusView {
    return this.registry.captureBaseline();
  }
}
