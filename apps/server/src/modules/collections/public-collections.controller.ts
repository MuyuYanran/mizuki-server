/**
 * [阶段 P8] collections/public-collections.controller — 公开集合只读路由
 * [职责] `GET /public/collections/:type`（路径自此定型，MASTER-PLAN §5）：
 *   :type 白名单校验同 P4（未知 type → 400）；仅 `public: true` 的注册表项
 *   可读（非公开 → 404）；读取经 DataFileService（L1 引擎 value-cache，
 *   P3 写管线第 8 步负责失效）——公开 API 直读文件缓存，零数据库表
 *   （MASTER-PLAN §2 决策 1）。
 * [状态] ACTIVE
 */
import { BadRequestException, Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { DataFileService } from '../data-files/data-file.service';
import { currentThemeKind, findCollectionDef, unknownCollectionMessage } from './registry';

@ApiTags('公开')
@Public()
@Controller('public/collections')
export class PublicCollectionsController {
  constructor(private readonly dataFiles: DataFileService) {}

  @ApiOperation({ summary: '公开集合读取（:type 白名单；仅 public: true 注册项，非公开 → 404）' })
  @Get(':type')
  read(@Param('type') type: string): unknown {
    // [T2] 白名单按当前主题档位取表（unknown → 空表：不得拿假地址去读别的主题的数据文件）
    const kind = currentThemeKind();
    const def = findCollectionDef(type, kind);
    if (!def) {
      throw new BadRequestException(unknownCollectionMessage(type, kind));
    }
    if (!def.public) {
      throw new NotFoundException(`集合未公开：${type}`);
    }
    return this.dataFiles.readCollection(def.file, def.varName);
  }
}
