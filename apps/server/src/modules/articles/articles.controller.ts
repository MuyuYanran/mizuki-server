/**
 * [阶段 P8] articles/articles.controller — 富文本管理 + 公开端点
 * [职责]
 *  - ArticlesController（admin，需认证）：
 *    GET/POST /admin/articles、GET/PATCH/DELETE /admin/articles/:id
 *  - PublicArticlesController（@Public + 全局限流继承）：
 *    GET /public/articles（混合分页，路径自此定型不再变更）、
 *    GET /public/articles/:slug（详情：markdown 渲染 sanitized HTML /
 *    richtext 返回 html_cache，公开输出一律安全 HTML）
 * [状态] ACTIVE
 *
 * 分页参数：?page=&limit=（默认 1/10；limit 上限 50，超限 400）。
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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { parseStrictLimit, parseStrictPage } from '../../common/http/pagination';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ArticleSlugSchema,
  ArticlesService,
  CreateArticleBodySchema,
  UpdateArticleBodySchema,
  type CreateArticleBody,
  type UpdateArticleBody,
} from './articles.service';

/** :id 参数（nanoid 字符集） */
import { z } from 'zod';
const ArticleIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @ApiOperation({ summary: '富文本文章全量列表（管理视图）' })
  @Get()
  list() {
    return this.articles.list();
  }

  @ApiOperation({ summary: '创建富文本文章' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateArticleBodySchema)) body: CreateArticleBody) {
    return this.articles.create(body);
  }

  @ApiOperation({ summary: '读单篇富文本文章（:id 为 nanoid）' })
  @Get(':id')
  read(@Param('id', new ZodValidationPipe(ArticleIdSchema)) id: string) {
    return this.articles.read(id);
  }

  @ApiOperation({ summary: '修改富文本文章' })
  @Patch(':id')
  update(
    @Param('id', new ZodValidationPipe(ArticleIdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateArticleBodySchema)) body: UpdateArticleBody,
  ) {
    return this.articles.update(id, body);
  }

  @ApiOperation({ summary: '删除富文本文章（引用检查后删除）' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', new ZodValidationPipe(ArticleIdSchema)) id: string) {
    return this.articles.delete(id);
  }
}

/** 公开端点（豁免清单含 /public/**，P6 守卫识别 @Public；限流沿用全局 60 次/分） */
@ApiTags('公开')
@Public()
@Controller('public/articles')
export class PublicArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  /** 混合列表：markdown+richtext 按 pub_date 降序聚合分页 */
  @ApiOperation({ summary: '公开文章混合分页（?page=&limit=，默认 1/10，limit 上限 50）' })
  @Get()
  async list(@Query('page') pageRaw?: string, @Query('limit') limitRaw?: string) {
    // strict 口径（公开面，limit 超 50 → 400）——口径单源见 common/http/pagination
    const page = parseStrictPage(pageRaw, 1);
    const limit = parseStrictLimit(limitRaw, 10, 50);
    return this.articles.publicList(page, limit);
  }

  /** 详情：一律返回安全 HTML（markdown 渲染过 sanitize；richtext 为存储的 html_cache） */
  @ApiOperation({ summary: '公开文章详情（:slug，一律返回安全 HTML）' })
  @Get(':slug')
  detail(@Param('slug', new ZodValidationPipe(ArticleSlugSchema)) slug: string) {
    return this.articles.publicDetail(slug);
  }
}

// ── 纯工具 ──


