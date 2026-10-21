/**
 * [阶段 P5] posts/posts.controller — Markdown 文章与 about 页接口
 * [职责] MASTER-PLAN §5 Posts 路由清单逐字 + P5 §3.5 about 补白：
 *   GET    /admin/posts              文章列表（含 frontmatter 摘要）
 *   POST   /admin/posts              创建（body：slug/frontmatter/content）
 *   POST   /admin/posts/import/preview  导入预览（multipart 字段 files，**只读**）
 *   POST   /admin/posts/sync         重建 article 索引（幂等）
 *   GET    /admin/posts/:slug        读单篇（frontmatter + 正文）
 *   PATCH  /admin/posts/:slug        修改（frontmatter 增量合并 / 正文）
 *   DELETE /admin/posts/:slug        删除（先备份，可经备份恢复）
 *   POST   /admin/posts/:slug/cover  上传封面（multipart，转 JPG）
 *   GET    /admin/about              about 原文
 *   PUT    /admin/about              about 写入（写前备份，可回滚）
 * [状态] ACTIVE
 *
 * 全部输入过 zod（参数级 ZodValidationPipe，避免路由级管道误校验 @Param）；
 * slug 白名单校验拒绝路径穿越（400）；P6 前无认证守卫属预期设计。
 * [U3-P4c] 例外：`import/preview` 的输入是 multipart 文件（无 JSON body），无 body 可过
 * zod——上限与扩展名由 multer + service 逐条判定，解析结果再经 shared 契约自校验。
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
  Put,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILES } from '@mizuki/shared';
import { type UploadedFileLike } from '../../common/http/uploaded-file';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreatePostBodySchema,
  PostSlugSchema,
  PostsService,
  UpdateAboutBodySchema,
  UpdatePostBodySchema,
} from './posts.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller()
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  // ── Posts ──

  @ApiOperation({ summary: 'Markdown 文章列表（含 frontmatter 摘要）' })
  @Get('admin/posts')
  list() {
    return this.posts.listPosts();
  }

  @ApiOperation({ summary: '创建文章（body：slug/frontmatter/content）' })
  @Post('admin/posts')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreatePostBodySchema)) body: unknown) {
    return this.posts.createPost(body as Parameters<PostsService['createPost']>[0]);
  }

  /**
   * [U3-P4c/K1] Markdown 通用导入预览（**只读**：纯解析、零落盘、零缓存、无会话态）。
   * - multipart 而非 JSON：绕开 Nest/Express 缺省的 100kb JSON 上限（30 个 md 必超），
   *   且不为一条导入端点抬全局 body limit（那会放松所有路由的 DoS 面）；
   * - 三道上限：文件数 ≤ 30（`FilesInterceptor` maxCount + service 纵深防御）、
   *   单文件 ≤ 65536 字节（multer `limits.fileSize` → 413）、扩展名仅 .md/.markdown（逐条判定）；
   * - 提交阶段**不新增端点**：面板逐条复用 `POST /admin/posts`（再裁 B）。
   */
  @ApiOperation({ summary: 'Markdown 导入预览（只读解析，逐条结果，不落盘）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @Post('admin/posts/import/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', IMPORT_MAX_FILES, { limits: { fileSize: IMPORT_MAX_FILE_BYTES } }),
  )
  previewImport(@UploadedFiles() files: UploadedFileLike[] | undefined) {
    return this.posts.previewImport(files ?? []);
  }

  @ApiOperation({ summary: '重建 article 索引（幂等）' })
  @Post('admin/posts/sync')
  sync() {
    return this.posts.syncIndex();
  }

  @ApiOperation({ summary: '读单篇文章（frontmatter + 正文）' })
  @Get('admin/posts/:slug')
  read(@Param('slug', new ZodValidationPipe(PostSlugSchema)) slug: string) {
    return this.posts.readPost(slug);
  }

  @ApiOperation({ summary: '修改文章（frontmatter 增量合并 / 正文替换）' })
  @Patch('admin/posts/:slug')
  update(
    @Param('slug', new ZodValidationPipe(PostSlugSchema)) slug: string,
    @Body(new ZodValidationPipe(UpdatePostBodySchema)) body: unknown,
  ) {
    return this.posts.updatePost(slug, body as Parameters<PostsService['updatePost']>[1]);
  }

  @ApiOperation({ summary: '删除文章（先备份，可经备份恢复）' })
  @Delete('admin/posts/:slug')
  @HttpCode(HttpStatus.OK)
  remove(@Param('slug', new ZodValidationPipe(PostSlugSchema)) slug: string) {
    return this.posts.deletePost(slug);
  }

  @ApiOperation({ summary: '上传文章封面（multipart 字段 file，非 JPG 自动转 JPG）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post('admin/posts/:slug/cover')
  @UseInterceptors(FileInterceptor('file'))
  uploadCover(
    @Param('slug', new ZodValidationPipe(PostSlugSchema)) slug: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('缺少上传文件（multipart 字段名：file）');
    }
    return this.posts.uploadCover(slug, file);
  }

  // ── about 页（归入 posts 控制器，P5 §3.5） ──

  @ApiOperation({ summary: 'about 页原文' })
  @Get('admin/about')
  readAbout() {
    return this.posts.readAbout();
  }

  @ApiOperation({ summary: '写入 about 页（写前备份，可回滚）' })
  @Put('admin/about')
  updateAbout(@Body(new ZodValidationPipe(UpdateAboutBodySchema)) body: { content: string }) {
    return this.posts.writeAbout(body.content);
  }
}
