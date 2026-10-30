/**
 * [阶段 P0b] infra/db/schema — Drizzle 全部 12 张表定义（[U3-P3/K3] +task_run）
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

/**
 * [U3-P3/K3] 任务运行历史（控制台「历史记录」区）
 * 启动写行（finished_at/exit_code/log_text 暂空）→ 退出时更新三字段。
 * log_text 尾部截断保留 ≤256KB（写入时保尾截断，见 process-manager）。
 */
export const taskRun = sqliteTable('task_run', {
  id: text('id').primaryKey(),
  /** 白名单任务名（install/dev/build/preview） */
  task: text('task').notNull(),
  /** 执行计划快照（JSON 文本：{ file, args }），与 pino plan* 字段同源 */
  commandSnapshot: text('command_snapshot').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  exitCode: integer('exit_code'),
  /** 环形缓冲全量日志（保尾截断 ≤256KB） */
  logText: text('log_text'),
});

/**
 * [U4-AI3/A] AI 调用用量台账（每次上游调用一行）。
 *
 * [职责] 回答「这台机器在 AI 上花了多少、花在哪」。U4-AI1 当时**刻意不做**用量表
 *   （只做单次 `maxOutputTokens` 上限 + 每分钟限流，见 u4-ai1 交付报告 §93），
 *   本表补齐 token 计数与统计面。
 *
 * [为什么是「每次调用一行」而不是按天聚合]
 *   聚合可以后算，原始行无法反推。保留每次调用才能回答「哪个动作最费 token」、
 *   「哪个档案在失败」这类问题；体量由保留策略控制（见 `AI_USAGE_KEEP`）。
 *
 * [列设计要点]
 *   - `action` 可空：非动作调用（如连通性测试 ping、自由聊天）没有 action；
 *   - `status` 三态：`ok` / `error` / `aborted` —— **aborted 必须与 error 分开**：
 *     用户主动停止或客户端断连不是故障，混进错误率会让统计失真；
 *   - token 三列可空：上游不保证给 usage（拿不到时**不写 0** —— 0 是「零消耗」，
 *     而 null 才是「未知」，两者对统计的意义完全不同）；
 *   - `durationMs` 记录**实际耗时**（首字节到收流结束之外，含完整流），
 *     用于发现「慢但成功」的退化；
 *   - `errorCode` 存**结构化码**（如 `upstream_5xx` / `timeout`），不存上游原文
 *     —— 后者可能含敏感信息，且行长不可控（仓规红线 6 的同精神）。
 *
 * [写入纪律] 用量写入是**旁路**：任何失败只 warn，绝不阻断或改变主响应
 *   （见 `ai-usage.service.ts`）。这正是「台账不能成为单点故障」的要求。
 */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    /** 写作动作名（AI_ACTIONS 之一）；自由聊天 / ping 为 null */
    action: text('action'),
    /** 调用场景：`chat`（流式聊天）/ `ping`（连通性测试） */
    scene: text('scene').notNull(),
    /** 使用的档案 id（配置被改后仍可追溯当时用的是哪个） */
    profileId: text('profile_id'),
    /** 上游模型名（档案快照，非实时读配置） */
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    /** 上游未给 usage 时为 null（**不写 0**：0 是零消耗，null 是未知） */
    totalTokens: integer('total_tokens'),
    durationMs: integer('duration_ms').notNull(),
    /** `ok` / `error` / `aborted`（用户停止或客户端断连，非故障） */
    status: text('status').notNull(),
    /** 结构化错误码（不含上游原文） */
    errorCode: text('error_code'),
  },
  (table) => [
    index('ai_usage_created_at_idx').on(table.createdAt),
    index('ai_usage_action_idx').on(table.action),
  ],
);
