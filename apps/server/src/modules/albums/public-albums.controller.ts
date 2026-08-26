/**
 * [阶段 P8] albums/public-albums.controller — 公开相册只读路由
 * [职责] `GET /public/albums`（路径自此定型，MASTER-PLAN §5）：
 *   相册列表——info.json 元信息 + 图片文件名列表；读取复用本模块
 *   AlbumsService.list()（不新增跨模块依赖）。
 * [状态] ACTIVE
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AlbumsService } from './albums.service';

@Public()
@Controller('public/albums')
export class PublicAlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get()
  list() {
    return this.albums.list();
  }
}
