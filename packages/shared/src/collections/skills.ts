/**
 * [阶段 P4] shared/collections/skills — skills 条目 schema
 * [职责] 与 REQUIREMENTS §6.7 字段表逐字对齐（P10 表单与后端共用同一字段规格）
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const SkillsExperienceSchema = z.object({
  years: z.number(),
  months: z.number(),
});

export const SkillsItemSchema = z.object({
  /** [B2/裁决 9] id 为 number（max+1 自动生成）；迁移语义见 ADR-014 */
  id: z.number().int().min(1).describe('id 自动分配（新增无需填写，编辑不可修改）'),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  level: z.number().optional(),
  experience: SkillsExperienceSchema.optional(),
  color: z.string().optional(),
});

export type SkillsItem = z.infer<typeof SkillsItemSchema>;
export type SkillsExperience = z.infer<typeof SkillsExperienceSchema>;
