/**
 * [阶段 P0b] infra/db/schema — Drizzle 全部 11 张表定义
 * [职责] 逐字对齐 MASTER-PLAN §3（表结构唯一事实来源）；
 *   时间戳统一 integer({ mode: 'timestamp' })，主键为 nanoid 文本（由写入方生成）。
 *   六类集合内容不建表（文件即数据库，REQUIREMENTS §6.0）。
 * [状态] ACTIVE
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 管理员 */
export const adminUser = sqliteTable('admin_user', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  /** argon2id 编码串 */
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  /** 连续失败计数 */
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  /** 锁定到期时间 */
  lockedUntil: integer('locked_until', { mode: 'timestamp' }),
  /** [B2/裁决 5] 会话版本：改密时 +1，refresh token 内 ver 与表内不一致 → 401
   *  （access 15min 自然过期，不做吊销） */
  tokenVersion: integer('token_version').notNull().default(0),
});

/** 统一文章索引（核心表）：Markdown 文章为文件哈希镜像，富文本以它为主存储 */
export const article = sqliteTable(
  'article',
  {
    id: text('id').primaryKey(),
    /** Markdown 文章取目录名 */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    /** 'markdown' | 'richtext' */
    sourceType: text('source_type').notNull(),
    /** 'draft' | 'published' */
    status: text('status').notNull().default('draft'),
    /** markdown 时记录相对 Mizuki 根的路径 */
    filePath: text('file_path'),
    /** 同步扫描用（sha256） */
    fileHash: text('file_hash'),
    /** 单分类，对齐 frontmatter */
    categoryId: text('category_id'),
    cover: text('cover'),
    summary: text('summary'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    pubDate: integer('pub_date', { mode: 'timestamp' }),
    /** 回收站软删 */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index('idx_article_status_date').on(t.status, t.pubDate),
    index('idx_article_source_type').on(t.sourceType),
  ],
);

/** 富文本正文 */
export const articleContent = sqliteTable('article_content', {
  articleId: text('article_id')
    .primaryKey()
    .references(() => article.id, { onDelete: 'cascade' }),
  /** TipTap 文档 JSON（信任源） */
  docJson: text('doc_json').notNull(),
  /** sanitize 后的 HTML 缓存 */
  htmlCache: text('html_cache'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** 分类 */
export const category = sqliteTable('category', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
});

/** 标签 */
export const tag = sqliteTable('tag', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
});

/** 文章-标签关联 */
export const articleTag = sqliteTable(
  'article_tag',
  {
    articleId: text('article_id').notNull(),
    tagId: text('tag_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.tagId] })],
);

/** 评论（建表，二期启用） */
export const comment = sqliteTable('comment', {
  id: text('id').primaryKey(),
  articleId: text('article_id').notNull(),
  /** 自引用父评论 */
  parentId: text('parent_id'),
  authorName: text('author_name').notNull(),
  authorEmail: text('author_email'),
  authorUrl: text('author_url'),
  content: text('content').notNull(),
  /** 'pending' | 'approved' | 'spam' */
  status: text('status').notNull().default('pending'),
  ipHash: text('ip_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** 审计日志 */
export const operationLog = sqliteTable('operation_log', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  method: text('method').notNull(),
  path: text('path').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull(),
  /** 脱敏 JSON 文本 */
  detail: text('detail'),
  ip: text('ip').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** 备份记录 */
export const backupRecord = sqliteTable('backup_record', {
  id: text('id').primaryKey(),
  /** 'pre_write' | 'manual' | 'auto' | 'db' */
  scope: text('scope').notNull(),
  manifestPath: text('manifest_path').notNull(),
  fileCount: integer('file_count').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** 媒体索引 */
export const mediaFile = sqliteTable('media_file', {
  id: text('id').primaryKey(),
  /** 相对 Mizuki 根 */
  path: text('path').notNull().unique(),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  sha256: text('sha256').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** 运行态配置（key-value）；启动配置存 data/config.json（DB 可用之前就需要） */
export const siteSetting = sqliteTable('site_setting', {
  key: text('key').primaryKey(),
  /** JSON 文本 */
  value: text('value').notNull(),
});
