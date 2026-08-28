/**
 * [阶段 P4] shared/collections/projects — projects 条目 schema
 * [职责] 与 REQUIREMENTS §6.5 字段表逐字对齐（P10 表单与后端共用同一字段规格）
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const ProjectsItemSchema = z.object({
  /** [B2/裁决 9] id 为 number（max+1 自动生成）；迁移语义见 ADR-014 */
  id: z.number().int().min(1).describe('id 自动分配（新增无需填写，编辑不可修改）'),
  title: z.string(),
  description: z.string().optional(),
  /** [R2-12] 图片类字段引导（SchemaForm 渲染为帮助文案） */
  image: z
    .string()
    .optional()
    .describe('本地图片填媒体库回传的相对路径（public/images/uploads/…），外链直接粘贴 URL'),
  category: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  status: z.string().optional(),
  liveDemo: z.string().optional(),
  sourceCode: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  featured: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  visitUrl: z.string().optional(),
});

export type ProjectsItem = z.infer<typeof ProjectsItemSchema>;
