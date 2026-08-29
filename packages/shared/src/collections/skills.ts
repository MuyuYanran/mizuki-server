/**
 * [阶段 P4] shared/collections/skills — skills 条目 schema
 * [Phase3-C2b/ADR-018] 官方字段面逐字对齐：id 为 string、level/category 枚举、
 *   experience 必填、projects[] 为 string 引用、未知字段拒绝（.strict()）。
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const SkillCategorySchema = z.enum(['frontend', 'backend', 'database', 'tools', 'other']);
export const SkillLevelSchema = z.enum(['beginner', 'intermediate', 'advanced', 'expert']);

export const SkillsExperienceSchema = z
  .object({
    years: z.number(),
    months: z.number(),
  })
  .strict();

export const SkillsItemSchema = z
  .object({
    /** [ADR-018] id 为 string：留空自动 slugify 生成（按 name），编辑不可修改 */
    id: z.string().min(1).describe('留空自动生成（按名称 slugify），编辑不可修改'),
    name: z.string(),
    description: z.string(),
    /** Iconify 图标集（官方规格） */
    icon: z.string().describe('Iconify 图标名，如 logos:typescript'),
    category: SkillCategorySchema,
    level: SkillLevelSchema,
    experience: SkillsExperienceSchema,
    /** 引用 projects 条目 id（string） */
    projects: z.array(z.string()).optional(),
    certifications: z.array(z.string()).optional(),
    color: z.string().optional(),
  })
  .strict();

export type SkillsItem = z.infer<typeof SkillsItemSchema>;
export type SkillsExperience = z.infer<typeof SkillsExperienceSchema>;
