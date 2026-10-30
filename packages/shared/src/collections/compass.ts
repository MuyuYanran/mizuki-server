/**
 * [T2] shared/collections/compass — compass（站点罗盘）条目 schema，Shirone 独有集合
 * [职责] 逐字段镜像 Shirone 主题类型定义（权威源：
 *   .test-tmp/upstream-Shirone-20261029/src/data/compass.ts
 *   —— CompassShelf L26-36 / CompassEntry L12-23），无自创、无删减、无改名。
 *   一个 shelf（收纳格）即一个 item；**条目不携带 id，身份字段为 key**
 *   （L28 注释：锚点 id，字母数字，作分组定位与跳转）。
 *   嵌套条目数组 entries 原样镜像为 CompassEntrySchema 数组。
 *   未知字段拒绝（.strict()，与 anime 同口径）。
 * [状态] ACTIVE
 */
import { z } from 'zod';

/** 单条站点记录（镜像 CompassEntry，compass.ts L12-23） */
export const CompassEntrySchema = z
  .object({
    /** 站点名（瓷砖标题） */
    label: z.string(),
    /** 外链地址 */
    href: z.string(),
    /** 一句话说明（瓷砖副行；省略则显示域名） */
    note: z.string().optional(),
    /** 图标：Iconify 名或图片 URL；省略 = 首字母兜底 */
    icon: z.string().optional(),
    /** 用户自定义图片（http(s)/绝对路径）：优先于 icon 渲染；省略则走 icon/首字母 */
    image: z.string().optional(),
  })
  .strict();

/** 分组（Shelf = 罗盘上的收纳格）—— 整个 shelf 作为一个 item（镜像 CompassShelf，L26-36） */
export const CompassItemSchema = z
  .object({
    /** 锚点 id（字母数字，作分组定位与跳转） */
    key: z.string(),
    /** 分组名 */
    name: z.string(),
    /** 分组图标（Iconify 名，SectionTitle 行首） */
    icon: z.string().optional(),
    /** 分组副文案（标题下弱文本，可选） */
    blurb: z.string().optional(),
    /** 收纳格内的站点清单（数组顺序即展示顺序） */
    entries: z.array(CompassEntrySchema),
  })
  .strict();

export type CompassItem = z.infer<typeof CompassItemSchema>;
