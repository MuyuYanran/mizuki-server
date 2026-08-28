/**
 * [阶段 P4] shared/collections/diary — diary 条目 schema
 * [职责] 与 REQUIREMENTS §6.3 字段表逐字对齐（P10 表单与后端共用同一字段规格）
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const DiaryItemSchema = z.object({
  /** [B2/裁决 9] id 为 number（max+1 自动生成）；迁移语义见 ADR-014 */
  id: z.number().int().min(1).describe('id 自动分配（新增无需填写，编辑不可修改）'),
  content: z.string(),
  /** ISO 8601 */
  date: z.string(),
  /** [R2-12] 图片类字段引导（SchemaForm 渲染为帮助文案） */
  images: z
    .array(z.string())
    .optional()
    .describe('本地图片填媒体库回传的相对路径（public/images/uploads/…），外链直接粘贴 URL'),
  location: z.string().optional(),
  mood: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type DiaryItem = z.infer<typeof DiaryItemSchema>;
