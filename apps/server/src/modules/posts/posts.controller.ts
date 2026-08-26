/**
 * [阶段 P5] posts/posts.controller — Markdown 文章与 about 页接口
 * [职责] MASTER-PLAN §5 Posts 路由清单逐字 + P5 §3.5 about 补白：
 *   GET    /admin/posts              文章列表（含 frontmatter 摘要）
 *   POST   /admin/posts              创建（body：slug/frontmatter/content）
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
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreatePostBodySchema,
  PostSlugSchema,
  PostsService,
  UpdateAboutBodySchema,
  UpdatePostBodySchema,
  type UploadedFileLike,
} from './posts.service';

@Controller()
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  // ── Posts ──

  @Get('admin/posts')
  list() {
    return this.posts.listPosts();
  }

  @Post('admin/posts')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreatePostBodySchema)) body: unknown) {
    return this.posts.createPost(body as Parameters<PostsService['createPost']>[0]);
  }

  @Post('admin/posts/sync')
  sync() {
    return this.posts.syncIndex();
  }

  @Get('admin/posts/:slug')
  read(@Param('slug', new ZodValidationPipe(PostSlugSchema)) slug: string) {
    return this.posts.readPost(slug);
  }

  @Patch('admin/posts/:slug')
  update(
    @Param('slug', new ZodValidationPipe(PostSlugSchema)) slug: string,
    @Body(new ZodValidationPipe(UpdatePostBodySchema)) body: unknown,
  ) {
    return this.posts.updatePost(slug, body as Parameters<PostsService['updatePost']>[1]);
  }

  @Delete('admin/posts/:slug')
  @HttpCode(HttpStatus.OK)
  remove(@Param('slug', new ZodValidationPipe(PostSlugSchema)) slug: string) {
    return this.posts.deletePost(slug);
  }

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

  @Get('admin/about')
  readAbout() {
    return this.posts.readAbout();
  }

  @Put('admin/about')
  updateAbout(@Body(new ZodValidationPipe(UpdateAboutBodySchema)) body: { content: string }) {
    return this.posts.writeAbout(body.content);
  }
}
