/**
 * [阶段 P7] albums/albums.controller — 相册 CRUD 接口
 * [职责] MASTER-PLAN §5 Albums 路由清单逐字（全部需认证，:id = 目录名，
 *   命名经 zod + safeJoin 校验）：
 *   GET    /admin/albums                  相册列表
 *   POST   /admin/albums                  创建（目录 + info.json）
 *   PATCH  /admin/albums/:id              修改元信息
 *   DELETE /admin/albums/:id              删除（引用检查 → 备份 → 删目录）
 *   POST   /admin/albums/:id/images       上传图片（非 JPG 自动转 JPG）
 *   DELETE /admin/albums/:id/images/:name 删除单张图片
 * [状态] ACTIVE
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AlbumImageNameSchema,
  AlbumNameSchema,
  AlbumsService,
  CreateAlbumBodySchema,
  UpdateAlbumBodySchema,
  type UploadedFileLike,
} from './albums.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/albums')
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @ApiOperation({ summary: '相册列表（info.json 元信息 + 图片文件名列表）' })
  @Get()
  list() {
    return this.albums.list();
  }

  @ApiOperation({ summary: '创建相册（目录 + info.json）' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateAlbumBodySchema)) body: unknown) {
    return this.albums.create(body as Parameters<AlbumsService['create']>[0]);
  }

  @ApiOperation({ summary: '修改相册元信息（:id 为目录名）' })
  @Patch(':id')
  update(
    @Param('id', new ZodValidationPipe(AlbumNameSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateAlbumBodySchema)) body: unknown,
  ) {
    return this.albums.update(id, body as Parameters<AlbumsService['update']>[1]);
  }

  @ApiOperation({ summary: '删除相册（引用检查 → 备份 → 删目录）' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', new ZodValidationPipe(AlbumNameSchema)) id: string) {
    return this.albums.delete(id);
  }

  @ApiOperation({ summary: '上传相册图片（multipart 字段 file，非 JPG 自动转 JPG）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post(':id/images')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('id', new ZodValidationPipe(AlbumNameSchema)) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('缺少上传文件（multipart 字段名：file）');
    }
    return this.albums.uploadImage(id, file);
  }

  @ApiOperation({ summary: '删除单张相册图片（引用检查）' })
  @Delete(':id/images/:name')
  @HttpCode(HttpStatus.OK)
  deleteImage(
    @Param('id', new ZodValidationPipe(AlbumNameSchema)) id: string,
    @Param('name', new ZodValidationPipe(AlbumImageNameSchema)) name: string,
  ) {
    return this.albums.deleteImage(id, name);
  }
}
