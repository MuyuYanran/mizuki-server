/**
 * [阶段 P7] media/media.controller — 媒体上传与索引接口
 * [职责] MASTER-PLAN §5 Media 路由清单逐字（全部需认证，P6 全局守卫生效）：
 *   POST   /admin/media       multipart 上传（字段 file）
 *   GET    /admin/media       媒体列表
 *   DELETE /admin/media/:id   删除（删除前引用检查，409 + 明细）
 * [状态] ACTIVE
 */
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MediaIdSchema, MediaService, type UploadedFileLike } from './media.service';

@Controller('admin/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: UploadedFileLike | undefined) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('缺少上传文件（multipart 字段名：file）');
    }
    return this.media.upload(file);
  }

  @Get()
  list() {
    return this.media.list();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', new ZodValidationPipe(MediaIdSchema)) id: string) {
    return this.media.delete(id);
  }
}
