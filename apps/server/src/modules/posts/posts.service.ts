/**
 * [阶段 P5] posts/posts.service — Markdown 文章读写与索引同步
 * [职责] 文章目录管理（创建/读取/修改/删除+恢复）、封面上传（sharp 转 JPG）、
 *   about 页读写、`article` 表 `source_type='markdown'` 索引同步（幂等）；
 *   写管线成功出口发射 post.changed / article.published / content.changed。
 * [状态] ACTIVE
 *
 * 纪律（P5 §3.3）：
 * - 所有 Mizuki 目录写入 = pre_write 备份 + 原子写（同目录临时文件 → rename），
 *   不得裸写覆盖；所有路径解析经 safeJoin（越界 → 403）；
 * - 删除先对文章目录逐文件备份再删目录（可经备份恢复回滚）；
 * - 禁止实现富文本（P8）；operation_log 表由 P6 拦截器接管，本阶段仅 pino 日志。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import { ArticlePublishedPayload, ContentChangedPayload, EVENTS, PostChangedPayload } from '@mizuki/shared';
import { logger } from '../../common/logger';
import { parseMarkdown, stringifyMarkdown } from '../../common/markdown/frontmatter';
import { ForbiddenPathError, safeJoin } from '../../common/security/safe-join';
import { getAppConfig } from '../../config/app-config';
import { type BackupOptions, BACKUP_OPTIONS, BackupService } from '../../infra/backup/backup.service';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { article } from '../../infra/db/schema';

// ── zod schema（全部输入边界） ──

/** slug：目录名，禁止路径分隔符与 '..'（路径穿越的最小拒绝面，纵深防御再过 safeJoin） */
export const PostSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\\/]+$/, 'slug 不得包含路径分隔符')
  .refine((value) => !value.includes('..') && value !== '.', 'slug 非法');

/**
 * frontmatter 字段（P5 §3.2 逐字）：12 个已知字段 + 未知字段原样保留。
 * published ⚠ 类型以 Mizuki 为准（可能为日期），故放宽为 boolean | string | Date；
 * date/pubDate 允许 string 或 YAML 解析出的 Date。
 */
const DateLikeSchema = z.union([z.string(), z.date()]);

export const PostFrontmatterSchema = z
  .object({
    title: z.string(),
    published: z.union([z.boolean(), z.string(), z.date()]).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional(),
    author: z.string().optional(),
    permalink: z.string().optional(),
    pinned: z.boolean().optional(),
    draft: z.boolean().optional(),
    image: z.string().optional(),
    date: DateLikeSchema.optional(),
    pubDate: DateLikeSchema.optional(),
  })
  .passthrough();

/**
 * [B2.1/裁决 8] description 服务端必填（官方 frontmatter title/description 必填，
 * SPEC-ALIGNMENT-B4 T4-8）：trim 后非空（拒绝缺失/空串/纯空白）。
 * 仅用于 API 写入口（创建 + PATCH 出现时校验）；读取/列表/sync/盘上存量不校验——
 * PostFrontmatterSchema（optional）继续服务于合并整体校验与 uploadCover（存量防误伤）。
 */
export const PostDescriptionRequiredSchema = z.string().trim().min(1);

/** 写入口专用 frontmatter（仅 description 收紧，其余字段与读取面逐字一致） */
export const PostFrontmatterWriteSchema = PostFrontmatterSchema.extend({
  description: PostDescriptionRequiredSchema,
});

/** POST /admin/posts body */
export const CreatePostBodySchema = z.object({
  slug: PostSlugSchema,
  frontmatter: PostFrontmatterWriteSchema,
  content: z.string(),
});

/** PATCH /admin/posts/:slug body（frontmatter 为增量合并，合并后整体过 schema） */
export const UpdatePostBodySchema = z
  .object({
    frontmatter: z.record(z.string(), z.unknown()).optional(),
    content: z.string().optional(),
  })
  .refine((value) => value.frontmatter !== undefined || value.content !== undefined, {
    message: 'frontmatter 与 content 至少提供一项',
  });

/** PUT /admin/about body */
export const UpdateAboutBodySchema = z.object({
  content: z.string(),
});

/** multipart 上传文件（memory storage）的最小结构（不依赖 @types/multer） */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

/** 封面上传扩展名白名单（P5 §3.4 最小版本，魔数嗅探以 sharp 可解码校验替代） */
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/** 相对 Mizuki 根的固定路径（POSIX 风格，与 manifest/事件 filePaths 一致） */
const POSTS_REL_DIR = 'src/content/posts';
const ABOUT_REL_PATH = 'src/content/spec/about.md';

/** 对外文章视图 */
export interface PostView {
  slug: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

/** sync 结果统计（pino 日志同步输出） */
export interface SyncResult {
  scanned: number;
  inserted: number;
  updated: number;
  softDeleted: number;
}

type ArticleStatus = 'draft' | 'published';

@Injectable()
export class PostsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly backup: BackupService,
    private readonly emitter: EventEmitter2,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── 文章 CRUD ──

  /** 文章列表（含 frontmatter 摘要 + 派生 status），按 slug 升序 */
  listPosts(): (PostView & { status: ArticleStatus })[] {
    return this.scanPosts().map(({ slug, frontmatter, content }) => ({
      slug,
      frontmatter,
      content,
      status: deriveStatus(frontmatter),
    }));
  }

  /** 读单篇（frontmatter + 正文）；不存在 → 404 */
  readPost(slug: string): PostView {
    const parsed = this.readPostOrThrow(slug);
    return { slug, frontmatter: parsed.frontmatter, content: parsed.content };
  }

  /** 创建文章：目录已存在 → 409；写入后经统一管线（备份 + 原子写） */
  async createPost(body: z.infer<typeof CreatePostBodySchema>): Promise<PostView> {
    const slug = validateSlug(body.slug);
    // [B2.1/裁决 8] 创建入口 description 必填（控制器 pipe 已校验，此为纵深防御，保持同 schema）
    const frontmatter = PostFrontmatterWriteSchema.parse(body.frontmatter);
    const dirAbs = this.postDirAbs(slug);
    if (fs.existsSync(dirAbs)) {
      throw new ConflictException(`文章已存在：${slug}`);
    }
    fs.mkdirSync(dirAbs, { recursive: true });
    const fileAbs = this.postFileAbs(slug);
    const text = stringifyMarkdown(frontmatter, body.content);
    await this.backup.preWriteBackup(fileAbs, `post create: ${slug}`); // 新文件 → 跳过（无物可备）
    this.atomicWrite(fileAbs, text);

    const fileHash = sha256Text(text);
    const articleId = await this.upsertArticleRow(slug, frontmatter, fileHash);
    this.emitPostWrite(slug, frontmatter, fileHash, false);
    if (deriveStatus(frontmatter) === 'published') {
      this.emitPublished(articleId, slug, frontmatter);
    }
    logger.info({ slug, status: deriveStatus(frontmatter) }, '文章创建完成');
    return { slug, frontmatter, content: body.content };
  }

  /** 修改文章：frontmatter 增量合并后整体校验，正文缺省保留原值 */
  async updatePost(slug: string, body: z.infer<typeof UpdatePostBodySchema>): Promise<PostView> {
    const existing = this.readPostOrThrow(slug);
    const mergedFrontmatter =
      body.frontmatter !== undefined ? { ...existing.frontmatter, ...body.frontmatter } : existing.frontmatter;
    const parsed = PostFrontmatterSchema.safeParse(mergedFrontmatter);
    if (!parsed.success) {
      throw new BadRequestException({
        message: `frontmatter 校验失败（${slug}）`,
        detail: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    // [B2.1/裁决 8] PATCH 增量语义：body 中出现 description 才过必填校验（拒绝空串/纯空白），
    // 不出现则放行保留既有值——存量盘上文件缺 description 不因此被误伤（读取/列表零复用必填面）。
    // 创建必填 + PATCH 拒空 ⇒ 终态恒有 description，无需额外终态校验。
    if (body.frontmatter !== undefined && 'description' in body.frontmatter) {
      const descriptionCheck = PostDescriptionRequiredSchema.safeParse(body.frontmatter['description']);
      if (!descriptionCheck.success) {
        throw new BadRequestException({
          message: `frontmatter 校验失败（${slug}）`,
          detail: {
            issues: descriptionCheck.error.issues.map((issue) => ({
              path: 'frontmatter.description',
              message: issue.message,
            })),
          },
        });
      }
    }
    const frontmatter = parsed.data as Record<string, unknown>;
    const content = body.content ?? existing.content;

    const fileAbs = this.postFileAbs(slug);
    await this.backup.preWriteBackup(fileAbs, `post update: ${slug}`);
    const text = stringifyMarkdown(frontmatter, content);
    this.atomicWrite(fileAbs, text);

    const fileHash = sha256Text(text);
    const articleId = await this.upsertArticleRow(slug, frontmatter, fileHash);
    this.emitPostWrite(slug, frontmatter, fileHash, false);
    if (deriveStatus(frontmatter) === 'published') {
      this.emitPublished(articleId, slug, frontmatter);
    }
    logger.info({ slug, status: deriveStatus(frontmatter) }, '文章修改完成');
    return { slug, frontmatter, content };
  }

  /** 删除文章：目录逐文件备份 → 删除目录（可经备份恢复）→ 索引行软删 */
  async deletePost(slug: string): Promise<{ deleted: true; backupIds: string[] }> {
    const existing = this.readPostOrThrow(slug);
    const fileHash = sha256Text(fs.readFileSync(this.postFileAbs(slug), 'utf8'));
    const dirAbs = this.postDirAbs(slug);

    const backupIds: string[] = [];
    for (const name of fs.readdirSync(dirAbs)) {
      const abs = path.join(dirAbs, name);
      if (!fs.statSync(abs).isFile()) {
        continue;
      }
      const info = await this.backup.preWriteBackup(abs, `post delete: ${slug}`);
      if (info) {
        backupIds.push(info.id);
      }
    }
    fs.rmSync(dirAbs, { recursive: true, force: true });

    await this.softDeleteArticleRow(slug);
    this.emitPostWrite(slug, existing.frontmatter, fileHash, true);
    logger.info({ slug, backupIds }, '文章删除完成（目录已备份，可恢复）');
    return { deleted: true, backupIds };
  }

  /**
   * 封面上传（P5 §3.4）：扩展名白名单 + sharp 可解码校验 + 大小上限（配置）
   *   → sharp 转 JPG（顺带去 EXIF）→ 原子写 cover.jpg → frontmatter.image 更新。
   */
  async uploadCover(slug: string, file: UploadedFileLike): Promise<PostView> {
    const existing = this.readPostOrThrow(slug);
    const ext = path.extname(file.originalname).toLowerCase();
    if (!COVER_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`封面扩展名不在白名单：${ext || '(空)'}（允许 jpg/jpeg/png/webp/gif）`);
    }
    const limitBytes = getAppConfig().uploadLimitMb * 1024 * 1024;
    if (file.buffer.length > limitBytes) {
      throw new PayloadTooLargeException(`封面超出上传上限 ${getAppConfig().uploadLimitMb}MB`);
    }
    let jpegBuffer: Buffer;
    try {
      jpegBuffer = await sharp(file.buffer).rotate().jpeg().toBuffer(); // 解码校验 + 转 JPG + 去 EXIF
    } catch {
      throw new BadRequestException('封面文件无法解码为图片（魔数校验失败）');
    }

    const coverAbs = path.join(this.postDirAbs(slug), 'cover.jpg');
    await this.backup.preWriteBackup(coverAbs, `post cover: ${slug}`);
    this.atomicWrite(coverAbs, jpegBuffer);

    // frontmatter.image 更新（随同一次写管线落盘）
    const frontmatter = PostFrontmatterSchema.parse({ ...existing.frontmatter, image: 'cover.jpg' });
    const fileAbs = this.postFileAbs(slug);
    await this.backup.preWriteBackup(fileAbs, `post cover(fm): ${slug}`);
    const text = stringifyMarkdown(frontmatter, existing.content);
    this.atomicWrite(fileAbs, text);

    const fileHash = sha256Text(text);
    const articleId = await this.upsertArticleRow(slug, frontmatter, fileHash);
    this.emitPostWrite(slug, frontmatter, fileHash, false);
    if (deriveStatus(frontmatter) === 'published') {
      this.emitPublished(articleId, slug, frontmatter);
    }
    logger.info({ slug, cover: 'cover.jpg' }, '封面写入完成（已转 JPG）');
    return { slug, frontmatter, content: existing.content };
  }

  // ── 索引同步 ──

  /**
   * 重建 article 表 source_type='markdown' 索引（P5 §3.6，幂等）：
   * - 磁盘有、表无 → insert；磁盘有、表有且哈希变化（或行处于软删态）→ update；
   * - 磁盘有、表有且哈希一致 → 零写入（第二次执行不产生任何写的依据）；
   * - 表有、磁盘无 → 标记 deleted_at（软删，回收站语义）。
   */
  async syncIndex(): Promise<SyncResult> {
    const diskPosts = this.scanPosts();
    const rows = await this.db
      .select()
      .from(article)
      .where(eq(article.sourceType, 'markdown'));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const diskSlugs = new Set<string>();

    let inserted = 0;
    let updated = 0;
    for (const post of diskPosts) {
      diskSlugs.add(post.slug);
      const fileHash = sha256Text(fs.readFileSync(this.postFileAbs(post.slug), 'utf8'));
      const values = this.articleValues(post.slug, post.frontmatter, fileHash);
      const existing = bySlug.get(post.slug);
      if (!existing) {
        await this.db.insert(article).values({ id: nanoid(), slug: post.slug, sourceType: 'markdown', ...values });
        inserted += 1;
      } else if (existing.fileHash !== fileHash || existing.deletedAt !== null) {
        await this.db.update(article).set({ ...values, deletedAt: null }).where(eq(article.id, existing.id));
        updated += 1;
      }
      // 哈希一致且未软删 → 零写入（幂等）
    }

    let softDeleted = 0;
    for (const row of rows) {
      if (!diskSlugs.has(row.slug) && row.deletedAt === null) {
        await this.db
          .update(article)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(article.id, row.id));
        softDeleted += 1;
      }
    }

    const result: SyncResult = { scanned: diskPosts.length, inserted, updated, softDeleted };
    logger.info(result, 'sync 执行完成');
    return result;
  }

  // ── about 页（REQUIREMENTS §6.11，P5 §3.5 补白） ──

  /** 读 about 原文；不存在 → 404 */
  readAbout(): { content: string } {
    const abs = this.aboutFileAbs();
    if (!fs.existsSync(abs)) {
      throw new NotFoundException('about 页尚未创建（PUT /admin/about 可创建）');
    }
    return { content: fs.readFileSync(abs, 'utf8') };
  }

  /** 写 about：pre_write 备份 + 原子写（覆盖不删除）；成功出口发射 content.changed(scope='about') */
  async writeAbout(content: string): Promise<{ content: string }> {
    const abs = this.aboutFileAbs();
    await this.backup.preWriteBackup(abs, 'about update');
    this.atomicWrite(abs, content);
    const payload = ContentChangedPayload.parse({ scope: 'about', filePaths: [ABOUT_REL_PATH] });
    this.emitter.emit(EVENTS.ContentChanged, payload);
    logger.info({ path: ABOUT_REL_PATH }, 'about 写入完成');
    return { content };
  }

  // ── 内部实现 ──

  /** 扫描文章目录：每个含 index.md 的子目录即一篇文章（按 slug 升序） */
  private scanPosts(): PostView[] {
    const postsDirAbs = this.resolveWithinRoot(POSTS_REL_DIR);
    if (!fs.existsSync(postsDirAbs)) {
      return [];
    }
    const posts: PostView[] = [];
    for (const entry of fs.readdirSync(postsDirAbs, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const fileAbs = path.join(postsDirAbs, entry.name, 'index.md');
      if (!fs.existsSync(fileAbs)) {
        continue;
      }
      const parsed = parseMarkdown(fs.readFileSync(fileAbs, 'utf8'));
      posts.push({ slug: entry.name, frontmatter: parsed.frontmatter, content: parsed.content });
    }
    return posts.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /** 读单篇（含 slug 复核 + 存在性检查），不存在 → 404 */
  private readPostOrThrow(slug: string): PostView {
    const validated = validateSlug(slug);
    const fileAbs = this.postFileAbs(validated);
    if (!fs.existsSync(fileAbs)) {
      throw new NotFoundException(`文章不存在：${validated}`);
    }
    const parsed = parseMarkdown(fs.readFileSync(fileAbs, 'utf8'));
    return { slug: validated, frontmatter: parsed.frontmatter, content: parsed.content };
  }

  /** frontmatter → article 表字段映射（P5 §3.6） */
  private articleValues(slug: string, frontmatter: Record<string, unknown>, fileHash: string) {
    return {
      // title 为必填字段；防御性兜底：缺失时以 slug 代替（避免 NOT NULL 违约）
      title: typeof frontmatter['title'] === 'string' ? frontmatter['title'] : slug,
      status: deriveStatus(frontmatter),
      filePath: `${POSTS_REL_DIR}/${slug}/index.md`,
      fileHash,
      // ⚠ category_id 列直接存 frontmatter.category 名称：schema 未建 FK 约束，
      //   P5 映射规则仅有 frontmatter 值（见交付报告偏差清单，P8 公开 API 消费时留意）
      categoryId: typeof frontmatter['category'] === 'string' ? frontmatter['category'] : null,
      cover: typeof frontmatter['image'] === 'string' ? frontmatter['image'] : null,
      summary: typeof frontmatter['description'] === 'string' ? frontmatter['description'] : null,
      pinned: frontmatter['pinned'] === true,
      pubDate: toDate(frontmatter['pubDate'] ?? frontmatter['date']),
      updatedAt: new Date(),
    };
  }

  /** 写入成功后 upsert 索引行（published 事件需要行 id；未入库的行先入库再发射） */
  private async upsertArticleRow(
    slug: string,
    frontmatter: Record<string, unknown>,
    fileHash: string,
  ): Promise<string> {
    const values = this.articleValues(slug, frontmatter, fileHash);
    const existing = await this.db
      .select()
      .from(article)
      .where(eq(article.slug, slug));
    const row = existing[0];
    if (row && row.sourceType === 'markdown') {
      await this.db.update(article).set({ ...values, deletedAt: null }).where(eq(article.id, row.id));
      return row.id;
    }
    const id = nanoid();
    await this.db.insert(article).values({ id, slug, sourceType: 'markdown', ...values });
    return id;
  }

  /** 删除文章 → 索引行软删（回收站语义；文件已备份可恢复） */
  private async softDeleteArticleRow(slug: string): Promise<void> {
    await this.db
      .update(article)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(article.slug, slug));
  }

  /** post.changed + content.changed(scope='post')：写入成功出口恰好一次，payload 先 parse */
  private emitPostWrite(slug: string, frontmatter: Record<string, unknown>, fileHash: string, deleted: boolean): void {
    const postChanged = PostChangedPayload.parse({ slug, frontmatter, fileHash, deleted });
    this.emitter.emit(EVENTS.PostChanged, postChanged);
    const contentChanged = ContentChangedPayload.parse({
      scope: 'post',
      filePaths: [`${POSTS_REL_DIR}/${slug}/index.md`],
    });
    this.emitter.emit(EVENTS.ContentChanged, contentChanged);
  }

  /** article.published：文章进入已发布状态时发射（sourceType='markdown'） */
  private emitPublished(id: string, slug: string, frontmatter: Record<string, unknown>): void {
    const payload = ArticlePublishedPayload.parse({
      id,
      slug,
      sourceType: 'markdown',
      title: typeof frontmatter['title'] === 'string' ? frontmatter['title'] : slug,
    });
    this.emitter.emit(EVENTS.ArticlePublished, payload);
  }

  /**
   * 原子写：同目录临时文件 → rename 覆盖（P5 §3.3；与 P3 写管线第 7 步同款）。
   * 这是统一写管线的组成部分（写前已完成 pre_write 备份），非裸写。
   */
  private atomicWrite(absPath: string, data: Buffer | string): void {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const tmp = path.join(path.dirname(absPath), `.tmp-${nanoid(8)}`);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, absPath);
  }

  /** mizukiRoot 必须已配置（未初始化 → 400） */
  private requireRoot(): string {
    if (this.options.mizukiRoot === '') {
      throw new BadRequestException('Mizuki 项目根目录未配置（请先完成初始化）');
    }
    return path.resolve(this.options.mizukiRoot);
  }

  /** safeJoin 包装：越界 → 403 */
  private resolveWithinRoot(rel: string): string {
    try {
      return safeJoin(this.requireRoot(), rel);
    } catch (error) {
      if (error instanceof ForbiddenPathError) {
        throw new ForbiddenException(`路径越界，已拒绝：${rel}`);
      }
      throw error;
    }
  }

  private postDirAbs(slug: string): string {
    return this.resolveWithinRoot(`${POSTS_REL_DIR}/${slug}`);
  }

  private postFileAbs(slug: string): string {
    return this.resolveWithinRoot(`${POSTS_REL_DIR}/${slug}/index.md`);
  }

  private aboutFileAbs(): string {
    return this.resolveWithinRoot(ABOUT_REL_PATH);
  }
}

// ── 纯工具 ──

/** slug 复核：非法 → 400（控制器管道已校验，此为纵深防御，保持错误形态一致） */
function validateSlug(slug: string): string {
  const result = PostSlugSchema.safeParse(slug);
  if (!result.success) {
    throw new BadRequestException({
      message: 'slug 校验失败',
      detail: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

/** 状态推导（P5 §3.6）：draft===true 或 published===false → 'draft'，否则 'published' */
function deriveStatus(frontmatter: Record<string, unknown>): ArticleStatus {
  if (frontmatter['draft'] === true || frontmatter['published'] === false) {
    return 'draft';
  }
  return 'published';
}

/** date/pubDate → Date（string 或 YAML 解析出的 Date；非法 → null） */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** 文本 sha256（hex） */
function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
