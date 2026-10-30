/**
 * [T2] shared/collections/games — games（游戏展示）条目 schema，Shirone 独有集合
 * [职责] 逐字段镜像 Shirone 主题类型定义（权威源：
 *   .test-tmp/upstream-Shirone-20261029/src/types/gamesConfig.ts §GameItem L28-61；
 *   数据形态见 .test-tmp/upstream-Shirone-20261029/src/data/games.ts L15-51）。
 *   GameItem 引用的 GameStatus（gamesConfig.ts L13）为四值枚举，照抄为
 *   GameStatusSchema；GameCategory / GamesConfig / PageMeta 不是本集合条目的
 *   字段面（属配置层），不纳入。
 *   身份字段为 id（L32 注释：稳定标识，URL 片段 / 测试选择器）。
 *   未知字段拒绝（.strict()，与 anime 同口径）。
 * [状态] ACTIVE
 */
import { z } from 'zod';

/** 游玩状态（镜像 GameStatus，gamesConfig.ts L13） */
export const GameStatusSchema = z.enum(['playing', 'completed', 'backlog', 'wishlist']);

/** 单个游戏条目（镜像 GameItem，gamesConfig.ts L28-61；字段顺序与原 interface 一致） */
export const GameItemSchema = z
  .object({
    /** 可选独立开关；关闭后不参与渲染与计数（优先使用 config.disabledIds） */
    enable: z.boolean().optional(),
    /** 稳定标识（URL 片段 / 测试选择器） */
    id: z.string(),
    /** 游戏名称 */
    name: z.string(),
    /** 开发商/工作室（如 miHoYo, FromSoftware） */
    developer: z.string(),
    /** 所属分类（对应 GameCategory.key） */
    category: z.string(),
    /** 游玩状态 */
    status: GameStatusSchema,
    /** 横屏封面图（站内绝对路径，建议 16:9 或更宽的本地 WebP/AVIF） */
    cover: z.string().optional(),
    /** 无封面时使用的 Iconify 图标 */
    icon: z.string().optional(),
    /** 评分（0–5，支持 0.5 步进） */
    rating: z.number().optional(),
    /** 已游玩时长（小时） */
    hours: z.number().optional(),
    /** 平台（如 PC / PlayStation / Switch / Mobile） */
    platform: z.string().optional(),
    /** 发行年份（自由格式，如 "2024"） */
    year: z.string().optional(),
    /** 类型标签（渲染为卡片上的 chips） */
    tags: z.array(z.string()).optional(),
    /** 游戏简评/感受 */
    description: z.string(),
    /** 商店页、官网或评测链接 */
    link: z.string().optional(),
    /** 特别推荐标记（渲染 Featured 徽章） */
    featured: z.boolean().optional(),
  })
  .strict();

export type GameItem = z.infer<typeof GameItemSchema>;
