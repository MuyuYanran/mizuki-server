/**
 * [阶段 P4] shared/collections/friends — friends 条目 schema
 * [职责] 与官方 FriendItem interface 对齐（B4 审计，摘录
 *   docs/refs/mizuki-docs/special-friends.md §2）：全字段必填、tags 至少一个。
 *   与官方的差异：id 为服务器生成的 string（nanoid）而非官方 number——
 *   id 类型对齐涉及集合服务 id 生成/定位行为，转 B4 T4 审计追加裁决项。
 * [状态] ACTIVE（B4 必填面对齐修订）
 */
import { z } from 'zod';

export const FriendsItemSchema = z.object({
  /** [B2/裁决 9] 官方 FriendItem id: number（special-friends.md §2）；max+1 自动生成，迁移语义见 ADR-014 */
  id: z.number().int().min(1).describe('id 自动分配（新增无需填写，编辑不可修改）'),
  title: z.string(),
  /** [R2-12] 图片类字段引导（SchemaForm 渲染为帮助文案 + 必填 tooltip） */
  imgurl: z.string().describe('本地图片填媒体库回传的相对路径（public/images/uploads/…），外链直接粘贴 URL'),
  desc: z.string(),
  siteurl: z.string(),
  tags: z
    .array(z.string())
    .min(1, '至少包含一个标签（官方 FriendItem 规定 tags 必填且至少一个）'),
});

export type FriendsItem = z.infer<typeof FriendsItemSchema>;
