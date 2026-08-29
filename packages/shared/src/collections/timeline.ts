/**
 * [阶段 P4] shared/collections/timeline — timeline 条目 schema
 * [Phase3-C2b/ADR-018] 官方字段面逐字对齐：id 为 string、type 枚举
 *   education|work|project|achievement（certificate/other 迁移映射见
 *   ADR-018）、links 对象数组、未知字段拒绝（.strict()）。
 * [状态] ACTIVE
 */
import { z } from 'zod';
import { DateYMD } from './projects';

export const TimelineTypeSchema = z.enum(['education', 'work', 'project', 'achievement']);
export type TimelineType = z.infer<typeof TimelineTypeSchema>;

export const TimelineLinkTypeSchema = z.enum(['website', 'certificate', 'project', 'other']);

export const TimelineLinkSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    type: TimelineLinkTypeSchema,
  })
  .strict();

export const TimelineItemSchema = z
  .object({
    /** [ADR-018] id 为 string：留空自动 slugify 生成（按 title），编辑不可修改 */
    id: z.string().min(1).describe('留空自动生成（按标题 slugify），编辑不可修改'),
    title: z.string(),
    description: z.string(),
    type: TimelineTypeSchema,
    startDate: DateYMD,
    endDate: DateYMD.optional(),
    location: z.string().optional(),
    organization: z.string().optional(),
    position: z.string().optional(),
    skills: z.array(z.string()).optional(),
    achievements: z.array(z.string()).optional(),
    links: z.array(TimelineLinkSchema).optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    featured: z.boolean().optional(),
  })
  .strict();

export type TimelineItem = z.infer<typeof TimelineItemSchema>;
export type TimelineLink = z.infer<typeof TimelineLinkSchema>;
