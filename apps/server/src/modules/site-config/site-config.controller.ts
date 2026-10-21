/**
 * [Phase3-C7] site-config/site-config.controller — 站点配置管理接口（ADR-020）
 * [职责] 受控子集端点（§0 写死）：
 *   GET  /admin/config              整体读（override 优先 + 基线对照；commentConfig
 *                                   无真 secret 键 → 无脱敏，T1.1 结论）
 *   PUT  /admin/config/lang         siteConfig.lang 分立写（C5 口径共享终行；
 *                                   键缺失/空串 → 归一缺省不落键）
 *   PUT  /admin/config/comments     commentConfig 分立写（全量覆盖，.strict() 越界键 400）
 *   [U3-P1] PUT /admin/config/site-info | profile | announcement
 *                                   配置域一期三端点（body 直载受控 schema；无逐键/
 *                                   清除端点，覆盖写入即管理权转移）
 *   [U3-P4a/K7] PUT /admin/config/anime   番剧/B站三域（按域整对象替换；缺省域 = 还原）
 *   全部需认证（P6 全局守卫）；生效链：保存 → console build 任务 → dist。
 * [状态] ACTIVE
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AnnouncementConfigSchema,
  CommentConfigSchema,
  ProfileConfigSchema,
  PutLangBodySchema,
  PutNavBodySchema,
  PutSiteAnimeBodySchema,
  SiteInfoSchema,
  type AnnouncementConfigValue,
  type CommentConfigValue,
  type NavConfigValue,
  type ProfileConfigValue,
  type SiteAnimeValues,
  type SiteInfoValues,
} from '@mizuki/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminSiteConfigView, SiteConfigService } from './site-config.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/config')
export class SiteConfigController {
  constructor(private readonly siteConfig: SiteConfigService) {}

  @ApiOperation({
    summary: '站点配置整体读（受控子集：lang + commentConfig + nav + siteInfo + profile + announcement）',
  })
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

  /** [Phase4-D3] nav 受控子集（#8）：links 缺键 = 清除还原；[] = 合法清空（破坏性语义）；非法 400 */
  @ApiOperation({ summary: '覆盖写入导航（全量，links 缺键 = 还原主题默认，空数组 = 清空导航）' })
  @Put('nav')
  @HttpCode(HttpStatus.OK)
  async putNav(
    @Body(new ZodValidationPipe(PutNavBodySchema)) body: { links?: NavConfigValue['links'] },
  ): Promise<AdminSiteConfigView> {
    return this.siteConfig.putNav(body.links);
  }

  // ── [U3-P1] 配置域一期：站点信息档 / 个人资料 / 公告（body 直载受控 schema） ──

  /** [U3-P1] 站点信息档：15 受管键整档覆盖（lang 及非受管键不在此档；可选键缺省零触碰） */
  @ApiOperation({
    summary: '覆盖写入站点信息档（siteConfig 15 受管键，越界键 400，可选键缺省 = 零触碰）',
  })
  @Put('site-info')
  @HttpCode(HttpStatus.OK)
  async putSiteInfo(
    @Body(new ZodValidationPipe(SiteInfoSchema)) body: SiteInfoValues,
  ): Promise<AdminSiteConfigView> {
    return this.siteConfig.putSiteInfo(body);
  }

  /** [U3-P1] 个人资料档：整档覆盖（links 空数组 = 合法清空） */
  @ApiOperation({ summary: '覆盖写入个人资料档（全量，links 空数组 = 合法清空）' })
  @Put('profile')
  @HttpCode(HttpStatus.OK)
  async putProfile(
    @Body(new ZodValidationPipe(ProfileConfigSchema)) body: ProfileConfigValue,
  ): Promise<AdminSiteConfigView> {
    return this.siteConfig.putProfile(body);
  }

  /** [U3-P1] 公告档：整档覆盖（content 非空必填） */
  @ApiOperation({ summary: '覆盖写入公告档（全量，content 非空必填）' })
  @Put('announcement')
  @HttpCode(HttpStatus.OK)
  async putAnnouncement(
    @Body(new ZodValidationPipe(AnnouncementConfigSchema)) body: AnnouncementConfigValue,
  ): Promise<AdminSiteConfigView> {
    return this.siteConfig.putAnnouncement(body);
  }

  /**
   * [U3-P4a/K7] 番剧/B站配置档：三域**按域整对象替换**（域内不做键级 merge）。
   * body = SiteAnimeSchema.partial()（三域均可缺省；缺省域 = 清除该域 override 并
   * 还原留档原文，故 `{}` = 三域全部还原主题默认）；越界键 .strict() → 400 零物化。
   * 与 PUT /site-info 的 15 键契约完全隔离（两个分区互不影响）。
   */
  @ApiOperation({
    summary: '覆盖写入番剧/B站配置档（三域按域整对象替换，缺省域 = 还原主题默认，越界键 400）',
  })
  @Put('anime')
  @HttpCode(HttpStatus.OK)
  async putAnime(
    @Body(new ZodValidationPipe(PutSiteAnimeBodySchema)) body: Partial<SiteAnimeValues>,
  ): Promise<AdminSiteConfigView> {
    return this.siteConfig.putSiteAnime(body);
  }
}
