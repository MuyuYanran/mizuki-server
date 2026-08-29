/**
 * [阶段 P4] collections/collections.controller — 动态 CRUD 控制器
 * [职责] 单一控制器 + :type 参数路由注册表白名单校验（MASTER-PLAN §5）：
 *   GET    /admin/collections/:type       全量列表（含分组结构）
 *   POST   /admin/collections/:type       新增（grouped 时 body 含 group）
 *   PATCH  /admin/collections/:type/:id   修改
 *   DELETE /admin/collections/:type/:id   删除（grouped 自动清理空分组）
 * [状态] ACTIVE
 *
 * [Phase3-C2b/ADR-018] :id 校验 registry 驱动：diary/friends（numericId）
 *   仅接受正整数字符串；projects/skills/timeline/anime 接受字符串（URL
 *   解码后按 idField 定位）。
 * :type 先对注册表白名单校验（未知 type → 400，不产生任何文件读写）；
 * 输入校验由 CollectionsService（itemSchema）完成；P6 前无认证守卫属预期。
 */
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CollectionsService } from './collections.service';
import { findCollectionDef, REGISTRY, type CollectionDef } from './registry';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @ApiOperation({ summary: '集合全量列表（:type 白名单校验，未知 → 400）' })
  @Get(':type')
  async list(@Param('type') type: string): Promise<unknown> {
    const def = this.requireDef(type);
    return await this.collections.list(def);
  }

  @ApiOperation({ summary: '集合新增（grouped 类型 body 含 group）' })
  @Post(':type')
  @HttpCode(HttpStatus.CREATED)
  create(@Param('type') type: string, @Body() body: unknown): unknown {
    const def = this.requireDef(type);
    return this.collections.create(def, body);
  }

  @ApiOperation({ summary: '集合项修改（:type/:id；numericId 集合 :id 须为数字）' })
  @Patch(':type/:id')
  update(@Param('type') type: string, @Param('id') id: string, @Body() body: unknown): unknown {
    const def = this.requireDef(type);
    return this.collections.update(def, routeId(def, id), body);
  }

  @ApiOperation({ summary: '集合项删除（grouped 自动清理空分组；numericId 集合 :id 须为数字）' })
  @Delete(':type/:id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('type') type: string, @Param('id') id: string): Promise<{ deleted: true }> {
    const def = this.requireDef(type);
    await this.collections.remove(def, routeId(def, id));
    return { deleted: true };
  }

  /** 注册表白名单校验：未知 type 一律 400，且不做任何文件读写 */
  private requireDef(type: string): CollectionDef {
    const def = findCollectionDef(type);
    if (!def) {
      throw new BadRequestException(`未知的集合类型：${type}（可用：${REGISTRY.map((d) => d.type).join('/')}）`);
    }
    return def;
  }
}

/** [B2/裁决 9 + ADR-018] :id 路由参数校验 registry 驱动：
 * numericId（diary/friends）仅接受正整数字符串；字符串 id 集合原样透传
 * （express 已 URL 解码，由服务层按 idField 定位，不存在 → 404） */
function routeId(def: CollectionDef, id: string): string {
  if (def.numericId && !/^\d+$/.test(id)) {
    throw new BadRequestException(`id 须为正整数：${def.type}/${id}`);
  }
  return id;
}
