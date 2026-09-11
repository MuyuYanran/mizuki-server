/**
 * [阶段 P8] articles/articles.service — 富文本文章 + 统一索引 + 公开列表
 * [职责]
 *  1. 富文本 CRUD（MASTER-PLAN §5）：doc_json（TipTap JSON，信任源）→
 *     服务端生成 html_cache（sanitize 后）；slug 唯一（冲突 409）；
 *     DELETE 软删（回收站语义）；发布出口发射 article.published（richtext）。
 *  2. 订阅 post.changed（§4.4）：markdown 索引行增量 upsert / 软删——
 *     幂等、异常内部捕获不冒泡（与 P5 sync 全量重建互补）。
 *  3. 公开混合列表：article 统一索引（published 且未软删），两源按
 *     pub_date 降序交错分页；首页缓存（最简：内存变量 + 失效标记），
 *     订阅 article.published → 缓存失效（§3.6）。
 *  4. 公开详情：markdown 经 marked + sanitize 渲染；richtext 返回 html_cache。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ArticlePublishedPayload, EVENTS, PostChangedPayload } from '@mizuki/shared';
import { toMizukiAbs } from '../../common/fs/mizuki-root';
import { logger } from '../../common/logger';
import { toArticleRow, toDateOrNull } from '../../common/markdown/article-row';
import { parseMarkdown } from '../../common/markdown/frontmatter';
import { renderMarkdownToSafeHtml, renderTipTapDoc } from '../../common/render/render';
import { singleSegmentName } from '../../common/validation/segment-name';
import { type BackupOptions, BACKUP_OPTIONS } from '../../infra/backup/backup.service';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { article, articleContent } from '../../infra/db/schema';

// ── zod schema ──

/**
 * doc_json 校验（取舍见交付报告）：对象且含 type 字段即视为合法 TipTap 文档，
 * 深层结构按「信任源」不过度约束；输出侧安全由转义渲染 + sanitize 兜底。
 */
export const DocJsonSchema = z.object({ type: z.string() }).passthrough();

/** slug（richtext 可由调用方指定）：单段安全字符（穿越最小拒绝面单源） */
export const ArticleSlugSchema = singleSegmentName({
  max: 200,
  separatorMessage: 'slug 不得包含路径分隔符',
  invalidMessage: 'slug 非法',
});

export const CreateArticleBodySchema = z.object({
  title: z.string().min(1),
  docJson: DocJsonSchema,
  slug: ArticleSlugSchema.optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  cover: z.string().optional(),
  summary: z.string().optional(),
  pinned: z.boolean().optional(),
  /** ISO 8601 字符串 */
  pubDate: z.string().optional(),
  categoryId: z.string().optional(),
});
export type CreateArticleBody = z.infer<typeof CreateArticleBodySchema>;

export const UpdateArticleBodySchema = CreateArticleBodySchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: '至少提供一个待修改字段' },
);
export type UpdateArticleBody = z.infer<typeof UpdateArticleBodySchema>;

/** 公开列表项（字段集逐字 §3.4） */
export interface PublicListItem {
  id: string;
  slug: string;
  title: string;
  sourceType: string;
  cover: string | null;
  summary: string | null;
  category: string | null;
  pinned: boolean;
  pubDate: string | null;
}

export interface PublicListResult {
  items: PublicListItem[];
  total: number;
  page: number;
  limit: number;
}

/** markdown 文章目录（相对 Mizuki 根；filePath 缺省回退推导用） */
const POSTS_REL_DIR = 'src/content/posts';

/** 富文本文章管理视图 */
export interface ArticleAdminView {
  id: string;
  slug: string;
  title: string;
  status: string;
  cover: string | null;
  summary: string | null;
  categoryId: string | null;
  pinned: boolean;
  pubDate: string | null;
  createdAt: string;
  updatedAt: string;
  docJson?: unknown;
  htmlCache?: string | null;
}

@Injectable()
export class ArticlesService {
  /** 公开列表首页缓存（最简实现：内存变量 + 失效置 null，取舍记报告） */
  private publicPage1Cache: PublicListResult | null = null;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly emitter: EventEmitter2,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── 富文本 CRUD（admin，全部需认证——守卫在 P6 全局生效） ──

  /** 管理列表：富文本文章（含草稿，按更新时间倒序） */
  async list(): Promise<ArticleAdminView[]> {
    const rows = await this.db
      .select()
      .from(article)
      .where(and(eq(article.sourceType, 'richtext'), isNull(article.deletedAt)))
      .orderBy(desc(article.updatedAt));
    return rows.map((row) => this.toAdminView(row));
  }

  /** 读单篇（含 doc_json 与 html_cache） */
  async read(id: string): Promise<ArticleAdminView> {
    const row = await this.getRowOrThrow(id);
    const contents = await this.db
      .select()
      .from(articleContent)
      .where(eq(articleContent.articleId, row.id));
    const view = this.toAdminView(row);
    const contentRow = contents[0];
    view.docJson = contentRow ? safeJsonParse(contentRow.docJson) : null;
    view.htmlCache = contentRow?.htmlCache ?? null;
    return view;
  }

  /** 创建：slug 唯一性（指定冲突 → 409；生成则自动避碰）→ 双表写入 → 发布事件 */
  async create(body: CreateArticleBody): Promise<ArticleAdminView> {
    const slug = await this.resolveSlug(body.slug, body.title);
    const id = nanoid();
    const htmlCache = renderTipTapDoc(body.docJson);
    const values = {
      title: body.title,
      status: body.status,
      cover: body.cover ?? null,
      summary: body.summary ?? null,
      categoryId: body.categoryId ?? null,
      pinned: body.pinned ?? false,
      pubDate: toDateOrNull(body.pubDate),
      updatedAt: new Date(),
    };
    await this.db.insert(article).values({
      id,
      slug,
      sourceType: 'richtext',
      ...values,
    });
    await this.db.insert(articleContent).values({
      articleId: id,
      docJson: JSON.stringify(body.docJson),
      htmlCache,
      updatedAt: new Date(),
    });
    logger.info({ id, slug, status: body.status }, '富文本文章创建完成');
    if (body.status === 'published') {
      this.emitPublished({ id, slug, title: body.title });
    }
    return this.read(id);
  }

  /** 修改：字段合并 + 唯一性复核；doc_json 变化时重建 html_cache；发布事件 */
  async update(id: string, patch: UpdateArticleBody): Promise<ArticleAdminView> {
    const row = await this.getRowOrThrow(id);
    if (patch.slug !== undefined && patch.slug !== row.slug) {
      await this.assertSlugFree(patch.slug, row.id);
    }
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) values['title'] = patch.title;
    if (patch.slug !== undefined) values['slug'] = patch.slug;
    if (patch.status !== undefined) values['status'] = patch.status;
    if (patch.cover !== undefined) values['cover'] = patch.cover;
    if (patch.summary !== undefined) values['summary'] = patch.summary;
    if (patch.categoryId !== undefined) values['categoryId'] = patch.categoryId;
    if (patch.pinned !== undefined) values['pinned'] = patch.pinned;
    if (patch.pubDate !== undefined) values['pubDate'] = toDateOrNull(patch.pubDate);
    await this.db.update(article).set(values).where(eq(article.id, row.id));

    if (patch.docJson !== undefined) {
      const htmlCache = renderTipTapDoc(patch.docJson);
      await this.db
        .insert(articleContent)
        .values({
          articleId: row.id,
          docJson: JSON.stringify(patch.docJson),
          htmlCache,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: articleContent.articleId,
          set: { docJson: JSON.stringify(patch.docJson), htmlCache, updatedAt: new Date() },
        });
    }

    const statusAfter = patch.status ?? row.status;
    logger.info({ id, status: statusAfter }, '富文本文章修改完成');
    if (statusAfter === 'published') {
      this.emitPublished({
        id: row.id,
        slug: patch.slug ?? row.slug,
        title: patch.title ?? row.title,
      });
    }
    return this.read(id);
  }

  /** 删除：软删（回收站语义，对齐 markdown 侧行为） */
  async delete(id: string): Promise<{ deleted: true }> {
    const row = await this.getRowOrThrow(id);
    await this.db
      .update(article)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(article.id, row.id));
    logger.info({ id, slug: row.slug }, '富文本文章软删完成');
    return { deleted: true };
  }

  // ── 订阅 post.changed：markdown 索引增量维护（§3.3） ──

  /**
   * 幂等：删除 → 软删行；否则按 fileHash 判断——哈希一致且未软删则零写入，
   * 其余情况 upsert（含恢复：清 deleted_at）。异常内部捕获，不冒泡。
   */
  @OnEvent(EVENTS.PostChanged)
  async onPostChanged(rawPayload: unknown): Promise<void> {
    try {
      const payload = PostChangedPayload.parse(rawPayload);
      if (payload.deleted) {
        await this.db
          .update(article)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(article.slug, payload.slug), eq(article.sourceType, 'markdown')));
        logger.info({ slug: payload.slug }, 'post.changed：markdown 索引行已软删');
        return;
      }
      // [Wave-2/B1] 盘上路径由载荷下发（目录式 index.md / 文件式 <slug>.md）；
      // 缺省（旧发射方或未携带）回退目录形态推导，保持向后兼容。
      const filePath = payload.filePath ?? `${POSTS_REL_DIR}/${payload.slug}/index.md`;
      const values = toArticleRow(payload.slug, payload.frontmatter, payload.fileHash, filePath);
      const rows = await this.db
        .select()
        .from(article)
        .where(and(eq(article.slug, payload.slug), eq(article.sourceType, 'markdown')));
      const existing = rows[0];
      if (!existing) {
        await this.db
          .insert(article)
          .values({ id: nanoid(), slug: payload.slug, sourceType: 'markdown', ...values });
        logger.info({ slug: payload.slug }, 'post.changed：markdown 索引行已插入');
      } else if (existing.fileHash !== payload.fileHash || existing.deletedAt !== null) {
        await this.db.update(article).set({ ...values, deletedAt: null }).where(eq(article.id, existing.id));
        logger.info({ slug: payload.slug }, 'post.changed：markdown 索引行已更新');
      }
      // 哈希一致且未软删 → 零写入（幂等）
    } catch (error) {
      logger.error({ err: error }, 'post.changed 处理失败（已内部捕获，不冒泡）');
    }
  }

  // ── 订阅 article.published：公开列表缓存失效（§3.6） ──

  @OnEvent(EVENTS.ArticlePublished)
  onArticlePublished(rawPayload: unknown): void {
    try {
      const payload = ArticlePublishedPayload.parse(rawPayload);
      this.publicPage1Cache = null;
      logger.info(
        { slug: payload.slug, sourceType: payload.sourceType },
        'article.published：公开列表缓存已失效',
      );
    } catch (error) {
      logger.error({ err: error }, 'article.published 处理失败（已内部捕获，不冒泡）');
    }
  }

  // ── 公开 API（@Public 路由的数据侧） ──

  /** 混合列表：published 且未软删，pub_date 降序，两源交错；首页缓存 */
  async publicList(page: number, limit: number): Promise<PublicListResult> {
    if (page === 1 && limit === 10 && this.publicPage1Cache) {
      return this.publicPage1Cache;
    }
    const whereClause = and(eq(article.status, 'published'), isNull(article.deletedAt));
    const rows = await this.db
      .select()
      .from(article)
      .where(whereClause)
      .orderBy(desc(article.pubDate), desc(article.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const counted = await this.db.select({ total: count() }).from(article).where(whereClause);
    const result: PublicListResult = {
      items: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        sourceType: row.sourceType,
        cover: row.cover,
        summary: row.summary,
        category: row.categoryId,
        pinned: row.pinned,
        pubDate: row.pubDate === null ? null : row.pubDate.toISOString(),
      })),
      total: counted[0]?.total ?? 0,
      page,
      limit,
    };
    if (page === 1 && limit === 10) {
      this.publicPage1Cache = result;
    }
    return result;
  }

  /** 公开详情：markdown 渲染 sanitized HTML + frontmatter；richtext 返回 html_cache */
  async publicDetail(slug: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(article)
      .where(and(eq(article.slug, slug), eq(article.status, 'published'), isNull(article.deletedAt)));
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`文章不存在或未发布：${slug}`);
    }
    if (row.sourceType === 'markdown') {
      if (row.filePath === null) {
        throw new NotFoundException(`文章源文件路径缺失：${slug}`);
      }
      const fileAbs = this.joinWithinRoot(row.filePath);
      if (!fs.existsSync(fileAbs)) {
        throw new NotFoundException(`文章源文件缺失：${slug}`);
      }
      const parsed = parseMarkdown(fs.readFileSync(fileAbs, 'utf8'));
      // [Phase3-C1/REQUIREMENTS-PHASE3 §1.2] 公开 API 双泄漏点修复（存量安全缺陷，
      // 公开 API 冻结语义内优先级最高的安全例外：路径与响应形状不变）：
      // - 泄漏点 B（无条件剥离）：password 永不出公开面——无论 encrypted 与否，
      //   frontmatter 浅拷贝后删除 password 键（禁止原地修改 parse 产物，防共享引用污染）；
      // - 泄漏点 A（条件清空）：encrypted === true 时 html 固定为 ''（正文由主题构建期
      //   客户端加密接管，公开面只保证不泄露明文）；非加密文章 html 行为逐字节不变。
      const publicFrontmatter = { ...parsed.frontmatter };
      delete publicFrontmatter['password'];
      const encrypted = parsed.frontmatter['encrypted'] === true;
      return {
        slug: row.slug,
        title: row.title,
        sourceType: 'markdown',
        frontmatter: publicFrontmatter,
        html: encrypted ? '' : renderMarkdownToSafeHtml(parsed.content),
      };
    }
    const contents = await this.db
      .select()
      .from(articleContent)
      .where(eq(articleContent.articleId, row.id));
    return {
      slug: row.slug,
      title: row.title,
      sourceType: 'richtext',
      html: contents[0]?.htmlCache ?? '',
    };
  }

  // ── 内部实现 ──

  /** article.published 发射（richtext 侧；payload 先 parse，恰好一次） */
  private emitPublished(info: { id: string; slug: string; title: string }): void {
    const payload = ArticlePublishedPayload.parse({
      id: info.id,
      slug: info.slug,
      sourceType: 'richtext',
      title: info.title,
    });
    this.emitter.emit(EVENTS.ArticlePublished, payload);
  }

  /** slug 解析：显式指定 → 冲突 409；未指定 → title 生成并自动避碰 */
  private async resolveSlug(explicit: string | undefined, title: string): Promise<string> {
    if (explicit !== undefined) {
      await this.assertSlugFree(explicit);
      return explicit;
    }
    const base = slugifyFromTitle(title);
    let candidate = base;
    // 生成式 slug 自动避碰（服务端责任，不用 409 打断调用方）
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await this.db.select({ id: article.id }).from(article).where(eq(article.slug, candidate));
      if (rows.length === 0) {
        return candidate;
      }
      candidate = `${base}-${nanoid(4)}`;
    }
    throw new ConflictException(`slug 生成冲突过多：${base}`);
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const rows = await this.db.select({ id: article.id }).from(article).where(eq(article.slug, slug));
    const conflict = rows.some((row) => row.id !== exceptId);
    if (conflict) {
      throw new ConflictException(`slug 已存在：${slug}`);
    }
  }

  private async getRowOrThrow(id: string): Promise<typeof article.$inferSelect> {
    const rows = await this.db
      .select()
      .from(article)
      .where(and(eq(article.id, id), isNull(article.deletedAt)));
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`文章不存在：${id}`);
    }
    return row;
  }

  private toAdminView(row: typeof article.$inferSelect): ArticleAdminView {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      cover: row.cover,
      summary: row.summary,
      categoryId: row.categoryId,
      pinned: row.pinned,
      pubDate: row.pubDate === null ? null : row.pubDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** root 内相对路径 → 绝对路径（未配置 400 / 越界 403，单源见 common/fs/mizuki-root） */
  private joinWithinRoot(rel: string): string {
    return toMizukiAbs(this.options.mizukiRoot, rel);
  }
}

// ── 纯工具 ──
// frontmatter → article 行映射与状态推导已上收 common/markdown/article-row（单源）：
// 此前本文件与 posts.service 各持一份映射，filePath 口径与告警行为已发生漂移。

/** title → slug（保留字母数字与中日韩字符，其余转 '-'） */
function slugifyFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? `article-${nanoid(6)}` : slug;
}

/** JSON 安全解析（doc_json 出库回显；损坏不抛错） */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
