/**
 * [Phase3-C7] site-config/site-config.controller — 站点配置管理接口（ADR-020）
 * [职责] 受控子集三端点（§0 写死）：
 *   GET  /admin/config          整体读（override 优先 + 基线对照；commentConfig
 *                               无真 secret 键 → 无脱敏，T1.1 结论）
 *   PUT  /admin/config/lang     siteConfig.lang 分立写（C5 口径共享终行；
 *                               键缺失/空串 → 归一缺省不落键）
 *   PUT  /admin/config/comments commentConfig 分立写（全量覆盖，.strict() 越界键 400）
 *   全部需认证（P6 全局守卫）；生效链：保存 → console build 任务 → dist。
 * [状态] ACTIVE
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommentConfigSchema, PutLangBodySchema, type CommentConfigValue } from '@mizuki/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminSiteConfigView, SiteConfigService } from './site-config.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/config')
export class SiteConfigController {
  constructor(private readonly siteConfig: SiteConfigService) {}

  @ApiOperation({ summary: '站点配置整体读（受控子集：lang + commentConfig）' })
  @Get()
  getConfig(): AdminSiteConfigView {
    return this.siteConfig.getConfig();
  }

  @ApiOperation({ summary: '设置 siteConfig.lang（空串/缺键 = 归一缺省）' })
  @Put('lang')
  @HttpCode(HttpStatus.OK)
  async putLang(
    @Body(new ZodValidationPipe(PutLangBodySchema)) body: { lang?: string },
  ): Promise<AdminSiteConfigView> {
    return this.siteConfig.putLang(body.lang);
  }

  @ApiOperation({ summary: '覆盖写入 commentConfig（全量，越界键 400）' })
  @Put('comments')
  @HttpCode(HttpStatus.OK)
  async putComments(
    @Body(new ZodValidationPipe(CommentConfigSchema)) body: CommentConfigValue,
  ): Promise<AdminSiteConfigView> {
    return this.siteConfig.putComments(body);
  }
}
