/**
 * [阶段 P4] shared/collections/timeline — timeline 条目 schema
 * [职责] 与 REQUIREMENTS §6.6 字段表逐字对齐（P10 表单与后端共用同一字段规格）
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const TimelineTypeSchema = z.enum(['education', 'certificate', 'project', 'other']);
export type TimelineType = z.infer<typeof TimelineTypeSchema>;

export const TimelineItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  type: TimelineTypeSchema,
  icon: z.string().optional(),
  color: z.string().optional(),
  startDate: z.string(),
  location: z.string().optional(),
  organization: z.string().optional(),
  skills: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
});

export type TimelineItem = z.infer<typeof TimelineItemSchema>;
