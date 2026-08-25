/**
 * [阶段 P4] shared/collections/friends — friends 条目 schema
 * [职责] 与 REQUIREMENTS §6.4 字段表逐字对齐（P10 表单与后端共用同一字段规格）
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const FriendsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  imgurl: z.string(),
  desc: z.string().optional(),
  siteurl: z.string(),
  tags: z.array(z.string()).optional(),
});

export type FriendsItem = z.infer<typeof FriendsItemSchema>;
