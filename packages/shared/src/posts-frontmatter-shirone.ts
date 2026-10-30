/**
 * [T4-2] Shirone 主题 posts frontmatter schema —— 逐字转录自上游 `content.config.ts`
 *
 * [职责] 只做一件事：把 Shirone 主题 `postsCollection.schema` 的 **28** 个字段**逐字**搬进本仓
 *        （类型 / `.optional()` / `.default()` / `.transform()` 一个不多、一个不少、一个不改）。
 *        本文件是**纯 schema 转录**：不读写文件、不做迁移、不认识路径（L0 纯数据契约）。
 * [状态] ACTIVE
 *
 * 上游来源（只读，禁止在别处再抄一份名单）：
 * - `.test-tmp/upstream-Shirone-20261029/src/content.config.ts` 的 `postsCollection.schema`
 *   （架构师 2026-10-30 逐行核对：same 19 + changed 1 + added 8 = 28）；
 * - `docs/refs/theme-compat/README.md` §2.1（一致 19）/ §2.2（改型 1）/ §2.3（Shirone 新增 8）；
 * - 与本仓 `packages/shared/src/posts-frontmatter-compat.ts` 的 `POSTS_FRONTMATTER_COMPAT` 表
 *   **精确吻合**（该表 same ∪ changed ∪ added 的字段名集合 == 本 schema 的字段面，由单测交叉校验钉住）。
 *
 * ⚠ 两处**有意偏离**（相对上游裸图，两处都必须保留）：
 * ① **`.loose()`**（上游是裸 `z.object({...})` ⇒ zod 默认 **strip** 未知键）：
 *    本仓 Mizuki 那份 schema（`apps/server/src/modules/posts/posts.service.ts` 的
 *    `PostFrontmatterSchema`）用 `.loose()` 是**有意**取舍 —— 「未知字段原样保留」，
 *    避免面板保存时**毁掉用户自定义键**。Shirone 这份**沿用同一取舍**。代价已知：
 *    上游会在**构建期** strip 未知键，我们在**文件层**不销毁（宁可留给构建期判，也不在保存时丢失用户数据）。
 * ② **不给任何字段加 `.nullable()`**（与 Mizuki 那份**刻意不同**）：
 *    Mizuki 侧的 `.nullable()` 是 `posts.service.ts` 的 null 删键哨兵
 *    （`NULL_DELETE_KEYS` / `stripNullDeleteKeys`）的**写路径机制入口通行前提**
 *    （写入口「parse 先于 strip」，null 若被 schema 拒就根本到不了 strip）；
 *    本批是**纯 schema 转录**，**不承接**该机制 ⇒ 零 `.nullable()`。
 *    （`category` 的 `.nullable()` 是**上游原文**，不是本仓哨兵，两者勿混同。）
 *    「删键哨兵如何与 Shirone 档共存」是 **T4-3（架构师亲自做）** 的决策，本批不碰。
 *
 * [L0] 分层：`packages/shared/src` —— 只 import `zod`；零 I/O、零 `node:*`、零仓内 import、
 *      不 import `posts-frontmatter-compat.ts`（那张表是文档契约，本文件是 schema，各自独立）。
 */
import { z } from 'zod';

/**
 * Shirone 主题 posts frontmatter —— 28 字段，字段序按 `POSTS_FRONTMATTER_COMPAT` 的行序分组
 * （§2.1 同义 19 → §2.2 改型 1 → §2.3 新增 8），便于与对照表并排阅读。
 */
export const ShironePostFrontmatterSchema = z
  .object({
    // ── §2.1 与 Mizuki 同义同型（19）──
    title: z.string(), // 必填
    published: z.date(), // 必填；⚠ 是 z.date()，不是 coerce ⇒ 字符串会被拒
    updated: z.date().optional(),
    draft: z.boolean().optional().default(false),
    description: z.string().optional().default(''),
    image: z.string().optional().default(''),
    tags: z.array(z.string()).optional().default([]),
    category: z.string().optional().nullable().default(''), // 上游原文即可空
    lang: z.string().optional().default(''),
    pinned: z.boolean().optional().default(false),
    comment: z.boolean().optional().default(true),
    encrypted: z.boolean().optional().default(false),
    alias: z.string().optional(),
    permalink: z.string().optional(),
    passwordHint: z.string().optional().default(''),
    // 主题标注 "For internal use"（构建期回填，非作者字段）——
    // ⚠ 上游是 `.default("")` 而**非** `.optional()`：缺键落空串
    prevTitle: z.string().default(''),
    prevSlug: z.string().default(''),
    nextTitle: z.string().default(''),
    nextSlug: z.string().default(''),

    // ── §2.2 改型（1）—— 与 Mizuki 的 `z.string().optional().default("")` 形态不同 ──
    // 接受数字口令（YAML 里 12345 会被解析成 number），统一 String() 归一；
    // ⚠ **无 `.default()`**：未写该字段时结果里**不含** `password` 键（不再落 ""）。
    password: z
      .union([z.string(), z.number()])
      .transform((v) => String(v))
      .optional(),

    // ── §2.3 Shirone 新增（8）—— Mizuki 侧不存在 ──
    publishedAt: z.date().optional(), // 与必填 published 并存（首次发布时刻）
    updatedAt: z.date().optional(),
    series: z
      .string()
      .optional()
      .default('')
      .transform((v) => v.trim()), // ⚠ 上游带 trim（剪缘空白）
    seriesOrder: z.number().int().optional(),
    hideHomeContent: z.boolean().optional().default(true),
    prevUrl: z.string().optional(), // 内部字段（构建期回填）
    nextUrl: z.string().optional(), // 内部字段（构建期回填）
    // 上游 license：`string` 简写 或 对象形态；对象键恰为 enable?/name?/url?/author?/source?
    // （与 POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP 的 4 条 `to` 后缀逐条对上，见 compat.spec ㉖）
    license: z
      .union([
        z.string(),
        z.object({
          enable: z.boolean().optional(),
          name: z.string().optional(),
          url: z.string().optional(),
          author: z
            .union([
              z.string(),
              z.object({
                name: z.string().optional(),
                url: z.string().optional(),
              }),
            ])
            .optional(),
          source: z.string().optional(),
        }),
      ])
      .optional(),
  })
  // 有意偏离 ①：未知键原样保留（上游构建期 strip，我们文件层不销毁用户自定义键）
  .loose();

/** Shirone posts frontmatter 的解析结果类型（输出版，默认值均已落位） */
export type ShironePostFrontmatter = z.infer<typeof ShironePostFrontmatterSchema>;
