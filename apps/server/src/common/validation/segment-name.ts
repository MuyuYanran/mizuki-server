/**
 * [重构/Wave-1] common/validation/segment-name — 单段名 schema 工厂
 * [职责] 「不得含路径分隔符、不得为 '.'/'..'、长度受限」的单段名校验单源
 *   （原 3 处同构：posts.PostSlugSchema、articles.ArticleSlugSchema 逐字相同、
 *   albums.AlbumNameSchema 同构）。
 * [状态] ACTIVE
 *
 * 为什么必须单源：这是**路径穿越的最小拒绝面**（纵深防御的第一层，之后仍须过
 * safeJoin / safeRealJoin）。三份实现意味着新增穿越变体（如 Windows 保留名
 * `CON`、Unicode 归一化等价形式）时可能只加固其中一处。
 *
 * 文案逐字保留（对外可见）：正则失败与点段拒绝的 message 由调用方显式传入，
 * 不用 label 自动拼接——现有三处的空格与主体词并不一致（'slug 不得…' 带空格、
 * '相册名不得…' 不带），自动拼接会改变对外提示文本。
 */
import { z } from 'zod';

export interface SingleSegmentNameOptions {
  /** 长度上限 */
  max: number;
  /** 含路径分隔符时的错误文案（逐字保留调用点原文） */
  separatorMessage: string;
  /** 为 '.'/'..' 时的错误文案（逐字保留调用点原文） */
  invalidMessage: string;
}

/** 单段名 schema：min(1) + max + 无分隔符 + 非点段 */
export function singleSegmentName(options: SingleSegmentNameOptions): z.ZodString {
  return z
    .string()
    .min(1)
    .max(options.max)
    .regex(/^[^\\/]+$/, options.separatorMessage)
    .refine((value) => !value.includes('..') && value !== '.', options.invalidMessage);
}
