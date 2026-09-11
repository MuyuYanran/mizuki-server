/**
 * [重构/Wave-1] common/validation/zod-issues — zod 失败 → 400 映射单源
 * [职责] 「safeParse 失败 → BadRequestException，detail.issues 为 {path,message}[]」
 *   的单源实现（原 5 处重复：ZodValidationPipe、collections.parseItemOrThrow、
 *   posts.validateSlug、posts.updatePost 内联、albums.parseWriteOrBadRequest）。
 * [状态] ACTIVE
 *
 * 为什么必须单源：前端字段级错误提示（SchemaForm / serverErrors）依赖
 * `detail.issues[].path` 与 `.message` 两个键名与 path 的「点号拼接」形态。
 * 5 份实现意味着这个契约有 5 个可能漂移的点——任一处改用 issue.path 数组
 * 直传，前端提示即静默失效。
 *
 * 纪律：`message` 由调用方提供并逐字保留（各入口文案不同，属对外可见信息）；
 * 本模块只统一 detail.issues 的构造。
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** 字段级校验错误（前端契约：path 为点号拼接的字段路径，message 为提示文本） */
export interface FieldIssue {
  path: string;
  message: string;
}

/** zod issues → 前端契约形态 */
export function zodFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * safeParse 包装：成功返回解析值；失败抛 BadRequestException({ message, detail: { issues } }）。
 * @param schema 待校验 schema
 * @param value 待校验值
 * @param message 失败时的顶层文案（逐字保留各调用点原文）
 */
export function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message,
      detail: { issues: zodFieldIssues(result.error) },
    });
  }
  return result.data;
}

/**
 * 同上但返回 Result 形态，供需要「自行决定处置」的调用点使用
 * （如 data-files 写管线第 3 步：校验失败应中断管线而非映射 400）。
 */
export function safeParseIssues<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; issues: FieldIssue[] } {
  const result = schema.safeParse(value);
  if (!result.success) {
    return { ok: false, issues: zodFieldIssues(result.error) };
  }
  return { ok: true, data: result.data };
}
