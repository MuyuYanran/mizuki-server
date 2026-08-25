/**
 * [阶段 P0b] shared/events — 事件目录骨架
 * [职责] 事件名常量 + 每事件 payload zod schema（MASTER-PLAN §4.4 逐字）
 * [状态] ACTIVE
 *
 * 纪律：本文件只允许常量与 zod schema，禁止任何业务逻辑；
 * 全项目禁止字符串字面量形式的 emit/on，一律引用 EVENTS 常量；
 * 发射方在写入管线成功出口恰好一次 parse 后发射。
 */
import { z } from 'zod';

/** 事件名常量（跨模块交互唯一合法引用） */
export const EVENTS = {
  ContentChanged: 'content.changed',
  PostChanged: 'post.changed',
  ArticlePublished: 'article.published',
  MediaChanged: 'media.changed',
  BackupCompleted: 'backup.completed',
  ProcessFinished: 'process.finished',
} as const;

/** content.changed — 值缓存失效 / 统计（发射方：data-files、posts、albums、settings） */
export const ContentChangedPayload = z.object({
  scope: z.enum(['collection', 'post', 'album', 'about', 'settings']),
  type: z.string().optional(),
  filePaths: z.array(z.string()),
});

/** post.changed — articles 索引增量 upsert/移除（发射方：posts） */
export const PostChangedPayload = z.object({
  slug: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  fileHash: z.string(),
  deleted: z.boolean(),
});

/** article.published — 公开列表缓存失效（发射方：posts、articles） */
export const ArticlePublishedPayload = z.object({
  id: z.string(),
  slug: z.string(),
  sourceType: z.enum(['markdown', 'richtext']),
  title: z.string(),
});

/** media.changed — 媒体索引 / 统计（发射方：media、albums） */
export const MediaChangedPayload = z.object({
  path: z.string(),
  op: z.enum(['save', 'delete']),
});

/** backup.completed — 仪表盘备份状态（发射方：infra/backup） */
export const BackupCompletedPayload = z.object({
  id: z.string(),
  scope: z.string(),
  fileCount: z.number(),
});

/** process.finished — 仪表盘（发射方：process） */
export const ProcessFinishedPayload = z.object({
  task: z.string(),
  exitCode: z.number(),
  durationMs: z.number(),
});

// ── 推断类型（供发射方 / 订阅方签名使用） ──

export type ContentChangedPayload = z.infer<typeof ContentChangedPayload>;
export type PostChangedPayload = z.infer<typeof PostChangedPayload>;
export type ArticlePublishedPayload = z.infer<typeof ArticlePublishedPayload>;
export type MediaChangedPayload = z.infer<typeof MediaChangedPayload>;
export type BackupCompletedPayload = z.infer<typeof BackupCompletedPayload>;
export type ProcessFinishedPayload = z.infer<typeof ProcessFinishedPayload>;
