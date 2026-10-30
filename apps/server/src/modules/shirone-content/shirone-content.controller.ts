/**
 * [T5b-2] Shirone 内容集合（`series` / `moments`）接口
 *
 * 路由（与既有 `/admin/posts`、`/admin/collections` 风格对齐）：
 *   GET    /admin/series              系列列表
 *   POST   /admin/series              创建（body：slug / frontmatter / content?）
 *   GET    /admin/series/:slug        读单个
 *   PATCH  /admin/series/:slug        修改（frontmatter 增量合并 / 正文）
 *   DELETE /admin/series/:slug        删除（先备份，可经备份恢复）
 *   GET    /admin/moments             动态列表
 *   POST   /admin/moments             创建
 *   GET    /admin/moments/:slug       读单个
 *   PATCH  /admin/moments/:slug       修改
 *   DELETE /admin/moments/:slug       删除
 *
 * 为什么不用两套控制器：两个集合的**行为完全同构**（同一服务、同一 schema 族、同一根部解析），
 * 只有 `kind` 不同 ⇒ 用 `:kind` 参数位把两族路由合并成一份实现，避免 10 个方法复制两遍。
 * `kind` 过 zod enum 白名单，非法值 400（不落到服务层）。
 *
 * [状态] ACTIVE
 *
 * 输入全部过 zod（参数级 ZodValidationPipe，避免路由级管道误校验 @Param）；
 * slug 白名单见 `ContentSlugSchema`（单段名，禁路径分隔符与 '..'）。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SHIRONE_COLLECTION_SUBDIRS, type ShironeCollectionSubdir } from '@mizuki/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ContentSlugSchema,
  CreateContentBodySchema,
  ShironeContentService,
  UpdateContentBodySchema,
} from './shirone-content.service';

/** 路径参数 `:kind` 白名单（枚举取值，非法值 400 且不触达服务层） */
const KindSchema = z.enum(SHIRONE_COLLECTION_SUBDIRS);

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/content')
export class ShironeContentController {
  constructor(private readonly content: ShironeContentService) {}

  @ApiOperation({ summary: 'series / moments 列表（扁平扫描，不进 article 索引）' })
  @Get(':kind')
  list(@Param('kind', new ZodValidationPipe(KindSchema)) kind: ShironeCollectionSubdir) {
    return this.content.list(kind);
  }

  @ApiOperation({ summary: 'series / moments 创建' })
  @Post(':kind')
  create(
    @Param('kind', new ZodValidationPipe(KindSchema)) kind: ShironeCollectionSubdir,
    @Body(new ZodValidationPipe(CreateContentBodySchema)) body: unknown,
  ) {
    return this.content.create(kind, body as never);
  }

  @ApiOperation({ summary: 'series / moments 读单个' })
  @Get(':kind/:slug')
  read(
    @Param('kind', new ZodValidationPipe(KindSchema)) kind: ShironeCollectionSubdir,
    @Param('slug', new ZodValidationPipe(ContentSlugSchema)) slug: string,
  ) {
    return this.content.read(kind, slug);
  }

  @ApiOperation({ summary: 'series / moments 修改（frontmatter 增量合并 / 正文）' })
  @Patch(':kind/:slug')
  update(
    @Param('kind', new ZodValidationPipe(KindSchema)) kind: ShironeCollectionSubdir,
    @Param('slug', new ZodValidationPipe(ContentSlugSchema)) slug: string,
    @Body(new ZodValidationPipe(UpdateContentBodySchema)) body: unknown,
  ) {
    return this.content.update(kind, slug, body as never);
  }

  @ApiOperation({ summary: 'series / moments 删除（先备份，可经备份恢复）' })
  @Delete(':kind/:slug')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('kind', new ZodValidationPipe(KindSchema)) kind: ShironeCollectionSubdir,
    @Param('slug', new ZodValidationPipe(ContentSlugSchema)) slug: string,
  ) {
    return this.content.remove(kind, slug);
  }
}
