/**
 * [阶段 P4] shared/collections/diary — diary 条目 schema
 * [职责] 与 REQUIREMENTS §6.3 字段表逐字对齐（P10 表单与后端共用同一字段规格）
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const DiaryItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  /** ISO 8601 */
  date: z.string(),
  images: z.array(z.string()).optional(),
  location: z.string().optional(),
  mood: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type DiaryItem = z.infer<typeof DiaryItemSchema>;
