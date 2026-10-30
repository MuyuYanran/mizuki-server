/**
 * [T5b-1] Shirone 内容集合 `series` / `moments` —— 上游构造面 + 本仓写入口面（两面制）
 *
 * [为什么又是两面] 与 T4-2 / T4-3 的结论**同构**（ADR-028 §21.2）：
 * 上游 `content.config.ts` 的 schema 是**构建期读取时的内存归一化器**（补默认值、`z.date()` 强转），
 * 而本服务在**落盘前**校验用户 YAML。读写路径不对称 ⇒ 构造面不可当写入口。
 * 本文件一次性把两面都立好，不让 T4-3 那种「先只做构造面、回头再补写入口面」的返工重演。
 *
 * 上游权威源（`LyraVoid/Shirone`，本机存档 `.test-tmp/upstream-Shirone-20261029/src/content.config.ts`）：
 *
 * ```js
 * const seriesCollection = defineCollection({
 *   loader: glob({ base: "./src/content/series", pattern: "**\/*.md" }),
 *   schema: z.object({
 *     title: z.string(),
 *     status: z.enum(["ongoing", "completed"]).optional().default("ongoing"),
 *     defaultCategory: z.string().optional().default(""),
 *   }),
 * });
 *
 * const momentsCollection = defineCollection({
 *   loader: glob({ base: "./src/content/moments", pattern: "**\/*.md" }),
 *   schema: z.object({
 *     published: z.date(),
 *     pinned: z.boolean().optional().default(false),
 *     location: z.string().optional().default(""),
 *     mood: z.string().optional().default(""),
 *     tags: z.array(z.string()).optional().default([]),
 *     images: z.array(z.object({
 *       src: z.string(),
 *       alt: z.string().optional().default(""),
 *     })).optional().default([]),
 *     draft: z.boolean().optional().default(false),
 *   }),
 * });
 * ```
 *
 * ⚠ **两处需当场纠正的旧记忆**（本文件按源码写，不按记忆写）：
 * ① `moments` 的图片字段名是 **`images`**（复数），不是 `image`；
 * ② 其元素是 **`{ src, alt? }` 对象**，不是字符串数组。
 * 记忆里「`image?: []`」是错的 —— 若照记忆写，写入口会拒掉所有真实 Shirone 数据。
 *
 * ⚠ **身份标识**：两个集合**都没有 frontmatter `id` 字段**，身份 = 去掉 `.md` 的文件名（slug）。
 * 上游 `pattern: "**\/*.md"` 理论上允许子目录，但集合语义是**扁平同名寻址**；
 * 本仓一律按**单段文件名**处理（调用方必须 `singleSegmentName` + `safeJoin`，禁跨目录穿越）。
 *
 * [L0] `packages/shared/src` —— 只 import `zod`；零 I/O、零 `node:*`、零仓内 import。
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// 构造面（上游契约锚）—— 逐字转录，含默认值与 z.date()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `series` 构造面 —— 3 字段，与上游逐字一致（含 2 个 `.default()`）。
 * **不入写路径**：`.default()` 会在保存时把默认值物化进用户文件（`status: ongoing`、
 * `defaultCategory: ""`），而上游只在构建期内存里补，从不回写源文件。
 */
export const ShironeSeriesConstructSchema = z
  .object({
    title: z.string(),
    status: z.enum(['ongoing', 'completed']).optional().default('ongoing'),
    defaultCategory: z.string().optional().default(''),
  })
  .passthrough();

/**
 * `moments` 构造面 —— 7 字段，与上游逐字一致（含 6 个 `.default()` 与必填 `z.date()`）。
 * **不入写路径**：`published: z.date()` 会把读路径产出的字符串日期判死；
 * 6 个 `.default()` 会在保存时凭空造键。
 */
export const ShironeMomentsConstructSchema = z
  .object({
    published: z.date(),
    pinned: z.boolean().optional().default(false),
    location: z.string().optional().default(''),
    mood: z.string().optional().default(''),
    tags: z.array(z.string()).optional().default([]),
    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string().optional().default(''),
        }),
      )
      .optional()
      .default([]),
    draft: z.boolean().optional().default(false),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// 写入口面 —— 零默认、零转换、日期放宽、可选键配 null 删键哨兵
// ─────────────────────────────────────────────────────────────────────────────

/** 盘上日期形态：YAML 裸日期解析为 `Date`，带引号或带时间戳则为 `string` */
const DateLikeSchema = z.union([z.string(), z.date()]);

/**
 * `series` 写入口面 —— 3 字段。
 *
 * 与构造面的差异**只允许**出现在「默认值」与「null 哨兵」两处：
 * - 去掉全部 `.default()`（`status` / `defaultCategory` 缺键就是缺键）；
 * - 两个可选键加 `.nullable()`（null = 删键指令，见 `SERIES_NULL_DELETE_KEYS`）。
 *
 * `title` 保持**必填**（上游同样是裸 `z.string()` 必填）：缺标题的 series 在上游构建期就是坏的。
 */
export const ShironeSeriesWriteSchema = z
  .object({
    title: z.string(),
    status: z.enum(['ongoing', 'completed']).nullable().optional(),
    defaultCategory: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * `moments` 写入口面 —— 7 字段。
 *
 * 与构造面的差异：
 * - `published` 保留**必填**，但类型放宽为 `string | Date`（上游 `z.date()` 会拒掉读路径
 *   可能给出的字符串日期；这与 T4-3 对 `posts.published` 的处置同一口径）；
 * - 其余 6 个可选键去掉 `.default()` 并加 `.nullable()`；
 * - `images` 的结构（`{ src, alt? }`）**保持**，但 `alt` 去掉 `.default("")`。
 */
export const ShironeMomentsWriteSchema = z
  .object({
    published: DateLikeSchema,
    pinned: z.boolean().nullable().optional(),
    location: z.string().nullable().optional(),
    mood: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    images: z
      .array(
        z
          .object({
            src: z.string(),
            alt: z.string().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
    draft: z.boolean().nullable().optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// null 删键集（推导式，不手挑）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `series` 删键集 —— **恰好等于**其写入口面里除必填键外的全部字段（2 个）。
 *
 * 推导口径（单测按此断言，不靠注释）：`series` 的字段面里，「非必填」的键就是删键集。
 * 该集合**恒等于** `Object.keys(WriteSchema.shape)` 减去必填键集合，字段面一变即红。
 */
export const SERIES_NULL_DELETE_KEYS = ['status', 'defaultCategory'] as const;

/**
 * `moments` 删键集 —— **恰好等于**其写入口面里除必填 `published` 外的全部字段（6 个）。
 *
 * ⚠ 与 `posts` 面的**一处有意差异**：`posts` 面对日期键（`date` / `pubDate` / `updated`）
 * 刻意不给删键路径（口径「空值不写键」，避免清空日期即销毁元数据）。
 * 但 `moments.published` 是**必填**键 —— 它根本不能为空、更不能被删，
 * 故它既不在删键集内，也不加 `.nullable()`。这与 `posts` 的「可选日期键不给删键」不是同一条规则，
 * 两条规则各自成立，勿混同。
 */
export const MOMENTS_NULL_DELETE_KEYS = [
  'pinned',
  'location',
  'mood',
  'tags',
  'images',
  'draft',
] as const;

/** 各集合的**必填键**（删键推导的补集；单测据此校验删键集完整性） */
export const SERIES_REQUIRED_KEYS = ['title'] as const;
export const MOMENTS_REQUIRED_KEYS = ['published'] as const;

/** `series` / `moments` 的内容子目录名（与「内容挂载点寻址底座」的 `ContentSubdir` 同名同域） */
export const SHIRONE_COLLECTION_SUBDIRS = ['series', 'moments'] as const;
export type ShironeCollectionSubdir = (typeof SHIRONE_COLLECTION_SUBDIRS)[number];

/** 两个集合统一的可纳管扩展名（上游 `glob pattern: "**\/*.md"` ⇒ **仅 `.md`**，无 `.mdx`） */
export const SHIRONE_COLLECTION_EXTENSIONS = ['.md'] as const;

/** 构造面类型（默认值已落位） */
export type ShironeSeriesConstruct = z.infer<typeof ShironeSeriesConstructSchema>;
export type ShironeMomentsConstruct = z.infer<typeof ShironeMomentsConstructSchema>;

/** 写入口面类型（无默认值落位） */
export type ShironeSeriesWrite = z.infer<typeof ShironeSeriesWriteSchema>;
export type ShironeMomentsWrite = z.infer<typeof ShironeMomentsWriteSchema>;
