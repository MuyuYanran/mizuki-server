/**
 * [阶段 P4] shared/collections/projects — projects 条目 schema
 * [职责] 与 REQUIREMENTS §6.5 字段表逐字对齐（P10 表单与后端共用同一字段规格）
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const ProjectsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
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
