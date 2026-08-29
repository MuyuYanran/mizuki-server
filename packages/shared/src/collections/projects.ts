/**
 * [阶段 P4] shared/collections/projects — projects 条目 schema
 * [Phase3-C2b/ADR-018] 官方字段面逐字对齐：id 为 string（名称串）、
 *   category/status 枚举、必填面收紧、未知字段拒绝（.strict()）。
 * [状态] ACTIVE
 */
import { z } from 'zod';

/** 官方日期格式：YYYY-MM-DD */
export const DateYMD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD');

export const ProjectCategorySchema = z.enum(['web', 'mobile', 'desktop', 'other']);
export const ProjectStatusSchema = z.enum(['completed', 'in-progress', 'planned']);

export const ProjectsItemSchema = z
  .object({
    /** [ADR-018] id 为 string：留空自动 slugify 生成，编辑不可修改 */
    id: z.string().min(1).describe('留空自动生成（按标题 slugify），编辑不可修改'),
    title: z.string(),
    description: z.string(),
    /** [R2-12] 图片类字段引导（SchemaForm 渲染为帮助文案） */
    image: z
      .string()
      .describe('本地图片填媒体库回传的相对路径（public/images/uploads/…），外链直接粘贴 URL'),
    category: ProjectCategorySchema,
    techStack: z.array(z.string()),
    status: ProjectStatusSchema,
    startDate: DateYMD,
    liveDemo: z.string().optional(),
    sourceCode: z.string().optional(),
    endDate: DateYMD.optional(),
    featured: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    visitUrl: z.string().optional(),
  })
  .strict();

export type ProjectsItem = z.infer<typeof ProjectsItemSchema>;
