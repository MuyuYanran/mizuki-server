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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MediaIdSchema, MediaService, type UploadedFileLike } from './media.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @ApiOperation({ summary: '媒体上传（multipart 字段 file，五件套管线：白名单/魔数/10MB/随机名/sharp 重编码）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: UploadedFileLike | undefined) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('缺少上传文件（multipart 字段名：file）');
    }
    return this.media.upload(file);
  }

  @ApiOperation({ summary: '媒体列表' })
  @Get()
  list() {
    return this.media.list();
  }

  @ApiOperation({ summary: '删除媒体（删除前引用检查，被引用 → 409 + 明细）' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', new ZodValidationPipe(MediaIdSchema)) id: string) {
    return this.media.delete(id);
  }
}
