/**
 * [阶段 P7] albums/albums.controller — 相册 CRUD 接口
 * [职责] MASTER-PLAN §5 Albums 路由清单逐字（全部需认证，:id = 目录名，
 *   命名经 zod + safeJoin 校验）：
 *   GET    /admin/albums                  相册列表
 *   POST   /admin/albums                  创建（目录 + info.json）
 *   PATCH  /admin/albums/:id              修改元信息（含 mode 切换）
 *   DELETE /admin/albums/:id              删除（引用检查 → 备份 → 删目录）
 *   POST   /admin/albums/:id/images       上传图片（非 JPG 自动转 JPG）
 *   DELETE /admin/albums/:id/images/:name 删除单张图片
 *   [R2-14] 外链照片 CRUD（仅外链模式相册）：
 *   POST   /admin/albums/:id/external-photos          追加外链照片
 *   PATCH  /admin/albums/:id/external-photos/:index   修改外链照片字段
 *   DELETE /admin/albums/:id/external-photos/:index   删除外链照片
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
import { type UploadedFileLike } from '../../common/http/uploaded-file';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AlbumImageNameSchema,
  AlbumNameSchema,
  AlbumsService,
  CreateAlbumBodySchema,
  ExternalPhotoIndexSchema,
  ExternalPhotoSchema,
  UpdateAlbumBodySchema,
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

  /** [R2-14] 追加一条外链照片（仅外链模式相册） */
  @ApiOperation({ summary: '追加外链照片（仅外链模式相册，写入 info.json.photos）' })
  @Post(':id/external-photos')
  @HttpCode(HttpStatus.CREATED)
  addExternalPhoto(
    @Param('id', new ZodValidationPipe(AlbumNameSchema)) id: string,
    @Body(new ZodValidationPipe(ExternalPhotoSchema)) body: unknown,
  ) {
    return this.albums.addExternalPhoto(id, body);
  }

  /** [R2-14] 修改外链照片字段（:index 数组下标，增量合并） */
  @ApiOperation({ summary: '修改外链照片字段（:index 数组下标，增量合并）' })
  @Patch(':id/external-photos/:index')
  updateExternalPhoto(
    @Param('id', new ZodValidationPipe(AlbumNameSchema)) id: string,
    @Param('index', new ZodValidationPipe(ExternalPhotoIndexSchema)) index: number,
    @Body() body: unknown,
  ) {
    return this.albums.updateExternalPhoto(id, index, body);
  }

  /** [R2-14] 删除外链照片（:index 数组下标） */
  @ApiOperation({ summary: '删除外链照片（:index 数组下标）' })
  @Delete(':id/external-photos/:index')
  @HttpCode(HttpStatus.OK)
  deleteExternalPhoto(
    @Param('id', new ZodValidationPipe(AlbumNameSchema)) id: string,
    @Param('index', new ZodValidationPipe(ExternalPhotoIndexSchema)) index: number,
  ) {
    return this.albums.deleteExternalPhoto(id, index);
  }
}
