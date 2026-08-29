/**
 * [Phase3-C2b] shared/collections/anime — anime（番剧）条目 schema，第七集合
 * [职责] 官方 local 模式 AnimeItem 字段面逐字对齐（ADR-018）：无 id 字段
 *   （title 为定位器）、status 枚举、startDate/endDate 为 YYYY-MM（注意非
 *   YYYY-MM-DD）、未知字段拒绝（.strict()）。禁止向条目注入任何 id 字段
 *   （幽灵字段禁令，ADR-013）。
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const AnimeStatusSchema = z.enum(['watching', 'completed', 'planned']);

/** 官方月份格式：YYYY-MM（与 projects/timeline 的 YYYY-MM-DD 不同） */
export const DateYM = z
  .string()
  .regex(/^\d{4}-\d{2}$/, '日期格式须为 YYYY-MM');

export const AnimeItemSchema = z
  .object({
    title: z.string().min(1).describe('番剧标题（唯一定位键，编辑不可修改）'),
    status: AnimeStatusSchema,
    rating: z.number(),
    cover: z.string().describe('封面图片路径或外链 URL'),
    description: z.string(),
    /** 如 "12 episodes" */
    episodes: z.string().describe('集数描述，如 "12 episodes"'),
    year: z.string(),
    genre: z.array(z.string()),
    studio: z.string(),
    link: z.string(),
    progress: z.number(),
    totalEpisodes: z.number(),
    startDate: DateYM,
    endDate: DateYM.optional(),
  })
  .strict();

export type AnimeItem = z.infer<typeof AnimeItemSchema>;
