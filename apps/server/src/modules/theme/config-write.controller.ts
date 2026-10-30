/**
 * [T3b-2b] theme/config-write.controller — 主题配置域读写端点（ADR-028 §17.6）
 *
 * [职责] admin 族 additive 端点（`/public` 零变化），挂在与 `site-config` 同一前缀
 *   `admin/config` 下（**无路径碰撞**：site-config 占 `@Get()` 与 `@Put('lang'|'comments'|
 *   'nav'|'site-info'|'profile'|'announcement'|'anime'|'effects')`，本控制器占 `domains*`）：
 *     GET    /admin/config/domains          域清单（含面板可编辑性 + 是否已有覆盖）
 *     GET    /admin/config/domains/:domain  单域覆盖值（含原始文本与解析失败信息）
 *     PUT    /admin/config/domains/:domain  写入覆盖（走内容分离落点 + 备份 + 原子写）
 *     DELETE /admin/config/domains/:domain  恢复该域全部上游默认值（删覆盖文件，幂等）
 *
 * [薄控制器] 本文件**零业务判断**：总闸 / 二维白名单 / `panelSupport` / 空对象 / 路径监狱 /
 *   备份 / 原子写全部在 `ConfigWriterService`；这里只做参数透传与请求体校验（仓规红线 5）。
 * [三档路由契约] 见 ADR-028 §17.6。要点：legacy 档清单为空、任何域都拒（可写面归 `site-config`）；
 *   HEAD 的 `navBarConfig` 只读原文 + 禁写 + **允许 DELETE**（删除不需要解析，是用户唯一逃生门）。
 * [状态] ACTIVE
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThemeConfigWriteBodySchema, type ThemeConfigWriteBody } from '@mizuki/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ConfigWriterService,
  type ThemeConfigDomainList,
  type ThemeConfigDomainRead,
  type ThemeConfigDomainReset,
  type ThemeConfigDomainWrite,
} from './config-writer.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/config')
export class ConfigWriteController {
  constructor(private readonly writer: ConfigWriterService) {}

  @ApiOperation({ summary: '主题配置域清单（面板可编辑性 + 是否已有覆盖；不含任何绝对路径）' })
  @Get('domains')
  list(): ThemeConfigDomainList {
    return this.writer.listDomains();
  }

  @ApiOperation({ summary: '读某域的覆盖值（解析失败时回原始文本 + parseError，不报错）' })
  @Get('domains/:domain')
  read(@Param('domain') domain: string): ThemeConfigDomainRead {
    return this.writer.readDomain(domain);
  }

  @ApiOperation({ summary: '写入某域的覆盖（落点在内容仓；needsSync=true 表示需触发一次内容同步）' })
  @Put('domains/:domain')
  @HttpCode(HttpStatus.OK)
  async write(
    @Param('domain') domain: string,
    @Body(new ZodValidationPipe(ThemeConfigWriteBodySchema)) body: ThemeConfigWriteBody,
  ): Promise<ThemeConfigDomainWrite> {
    return this.writer.writeDomain(domain, body.values);
  }

  @ApiOperation({ summary: '恢复某域的全部上游默认值（删除覆盖文件；幂等，不存在的文件视作成功）' })
  @Delete('domains/:domain')
  @HttpCode(HttpStatus.OK)
  async reset(@Param('domain') domain: string): Promise<ThemeConfigDomainReset> {
    return this.writer.resetDomain(domain);
  }
}
