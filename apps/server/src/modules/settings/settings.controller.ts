/**
 * [阶段 P8] settings/settings.controller — 站点设置接口
 * [职责] 运行态设置 REST（规格补白，MASTER-PLAN §5 未列，见交付报告疑问清单）：
 *   GET    /admin/settings        全量键值
 *   PUT    /admin/settings/:key   设置单键（body { value }）
 *   DELETE /admin/settings/:key   删除单键
 *   全部需认证（P6 全局守卫）；全部输入过 zod。
 * [状态] ACTIVE
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PutSettingBodySchema, SettingKeySchema, SettingsService } from './settings.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @ApiOperation({ summary: '全量站点设置键值' })
  @Get()
  getAll() {
    return this.settings.getAll();
  }

  @ApiOperation({ summary: '设置单键（body { value }）' })
  @Put(':key')
  @HttpCode(HttpStatus.OK)
  put(
    @Param('key', new ZodValidationPipe(SettingKeySchema)) key: string,
    @Body(new ZodValidationPipe(PutSettingBodySchema)) body: { value: unknown },
  ) {
    return this.settings.put(key, body.value);
  }

  @ApiOperation({ summary: '删除单键' })
  @Delete(':key')
  @HttpCode(HttpStatus.OK)
  remove(@Param('key', new ZodValidationPipe(SettingKeySchema)) key: string) {
    return this.settings.delete(key);
  }
}
