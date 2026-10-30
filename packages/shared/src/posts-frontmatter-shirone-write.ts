/**
 * [T4-3] Shirone 主题 posts frontmatter —— **写入口面** schema + null 删键集
 *
 * [为什么需要第二份 schema] `posts-frontmatter-shirone.ts` 那份是**上游构造面逐字转录**
 * （带 19 个 `.default()`、1 个 `.transform()`、`published: z.date()` 必填）。
 * 它**不能**直接当写入口用，三条硬碰硬的理由（架构师 2026-10-30 读 `posts.service.ts` 后裁决）：
 *
 * ① **默认值会污染文件**——读写不对称：本仓读路径（`scanPosts` / `readPostOrThrow`）走的是
 *    `common/markdown/frontmatter.ts` 的 `parseMarkdown()`，即**裸 YAML 解析**，不过 schema。
 *    而写路径（`createPost` / `updatePost` / `uploadCover`）走 `Schema.parse()`。
 *    若写路径用构造面 schema，用户保存一篇最小文章会被**物化出 19 个默认键**
 *    （`draft:false` / `description:''` / `image:''` / `tags:[]` / `category:''` / `lang:''` /
 *    `pinned:false` / `comment:true` / `encrypted:false` / `passwordHint:''` /
 *    `prevTitle:''` / `prevSlug:''` / `nextTitle:''` / `nextSlug:''` / `series:''` /
 *    `hideHomeContent:true` …）。
 *    上游构建期在**内存**里补默认值，**从不回写源文件**——本服务若回写，就是在替用户改文件。
 *
 * ② **转换器会静默改写用户输入**——`password` 的 `String()` 会把 YAML 里的 `12345` 改写成 `"12345"`，
 *    `series` 的 `.trim()` 会剪掉用户写的空白。写入口只该**校验**，不该改字。
 *
 * ③ **`z.date()` 与读路径产物不同型**——读路径给的是 YAML 原物（裸日期是 `Date`，带引号是 `string`）；
 *    `published: z.date()` 会把字符串形直接判死。Mizuki 那份 schema 早就为此放宽为
 *    `union([boolean, string, date])`（见 `posts.service.ts:75` 注记）。本面沿用同一放宽（去掉 boolean）。
 *
 * [两面的分工]
 * - `ShironePostFrontmatterSchema`（构造面）= **上游契约锚**：用于与 `POSTS_FRONTMATTER_COMPAT`
 *   交叉校验、将来承接构建期语义。**不入写路径**。
 * - `ShironePostFrontmatterWriteSchema`（本文件）= **本服务写路径唯一入口**：零 `.default()`、
 *   零 `.transform()`、日期放宽为 string|Date、可删键加 `.nullable()`。
 *   两面**字段名集合必须恒等（28 == 28）**，由单测钉住（字段面漂移即红）。
 *
 * [L0] 分层：`packages/shared/src` —— 只 import `zod`；零 I/O、零 `node:*`、零仓内 import。
 */
import { z } from 'zod';

/** 盘上日期形态：YAML 裸日期解析为 `Date`，带引号或带时间戳则为 `string`，两者都必须收 */
const DateLikeSchema = z.union([z.string(), z.date()]);

/**
 * [T4-3] Shirone 档 null 删键集（16 键）—— 与 `SHIRONE_NULL_DELETE_KEYS` **完全等幂**：
 * 本集合的每一个键，在 `ShironePostFrontmatterWriteSchema` 里**都带 `.nullable()`**
 * （写入口「parse 先于 strip」，null 若被 schema 拒就根本到不了 `stripNullDeleteKeys`）。
 *
 * [推导口径] 不是手挑的，是**两段并集**（单测按此推导断言，不靠注释）：
 *   ① `posts.service.ts` 的 `NULL_DELETE_KEYS`（Mizuki 12 键）**∩** Shirone 字段面 = **8 键**
 *      —— 被 Shirone 删掉的 4 键（`priority` / `licenseName` / `licenseUrl` / `sourceLink`）
 *      在 Shirone 面**不存在**，其语义被归并进 `license` 对象（见 `POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP`），
 *      故不入集；
 *   ② `POSTS_FRONTMATTER_ADDED`（Shirone 新增 8 键）**全部**入集 —— 它们均为 `.optional()` 无默认，
 *      缺失在上游完全合法。
 *   8 + 8 = 16。
 *
 * ⚠ **与 Mizuki 面的一处有意不对称**：`publishedAt` / `updatedAt` 是日期键，而 Mizuki 面对
 * `date` / `pubDate` / `updated` **刻意不给删键路径**（口径：「空值不写键」，避免清空日期即销毁元数据）。
 * 这里仍把两者入集，理由是 Shirone 这两个键在上游是**裸 `.optional()`、无伴生约定**，
 * 且「可写入却无法经 API 删除、只能手工删行」正是 Mizuki 那份集合一路在补的缺口（`:158-161`）。
 * Mizuki 面的排除规则**不动**（ADR 锚定，冻结）。
 */
export const SHIRONE_NULL_DELETE_KEYS = [
  // ① Mizuki 12 键中 Shirone 仍存在的 8 个
  'encrypted',
  'password',
  'comment',
  'permalink',
  'lang',
  'draft',
  'alias',
  'passwordHint',
  // ② Shirone 新增 8 个
  'publishedAt',
  'updatedAt',
  'series',
  'seriesOrder',
  'hideHomeContent',
  'prevUrl',
  'nextUrl',
  'license',
] as const;

/** [T4-3] Shirone 档「上游原文即可空」的键 —— 唯一不属于删键哨兵的可空键，测试里要单独豁免 */
export const SHIRONE_UPSTREAM_NULLABLE_KEYS = ['category'] as const;

/**
 * Shirone 写入口 frontmatter —— 28 字段，字段序与 `ShironePostFrontmatterSchema` 逐行对齐，
 * 便于两面并排审读。**语义差异只允许出现在**：`.default()` / `.transform()` / `.nullable()` / 日期放宽。
 */
export const ShironePostFrontmatterWriteSchema = z
  .object({
    // ── 必填（2）── 上游同样必填，保持收紧：缺 `published` 的 Shirone 文章在上游构建期就是坏的
    title: z.string(),
    // 上游是 `z.date()` 必填；此处只放宽**类型**（string|Date），**不放宽必填**
    published: DateLikeSchema,

    // ── §2.1 与 Mizuki 同义同型（19）──
    // 日期键沿用 Mizuki 口径：可空性不加（无删键语义）
    updated: DateLikeSchema.optional(),
    draft: z.boolean().nullable().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    tags: z.array(z.string()).optional(),
    // ⚠ `category` 的 `.nullable()` 是**上游原文**，不是本仓哨兵（故不在 SHIRONE_NULL_DELETE_KEYS 内）
    category: z.string().nullable().optional(),
    lang: z.string().nullable().optional(),
    pinned: z.boolean().optional(),
    comment: z.boolean().nullable().optional(),
    encrypted: z.boolean().nullable().optional(),
    alias: z.string().nullable().optional(),
    permalink: z.string().nullable().optional(),
    passwordHint: z.string().nullable().optional(),
    // 主题标注 "For internal use"（构建期回填）—— 写面同样不给默认值，缺键就让它缺
    prevTitle: z.string().optional(),
    prevSlug: z.string().optional(),
    nextTitle: z.string().optional(),
    nextSlug: z.string().optional(),

    // ── §2.2 改型（1）── 保留 number 接受面（YAML 无引号数字），去掉 `String()` 转换器
    password: z.union([z.string(), z.number()]).nullable().optional(),

    // ── §2.3 Shirone 新增（8）──
    publishedAt: DateLikeSchema.nullable().optional(),
    updatedAt: DateLikeSchema.nullable().optional(),
    // 去掉上游的 `.trim()`：写入口不改字（空白由用户自己决定）
    series: z.string().nullable().optional(),
    seriesOrder: z.number().int().nullable().optional(),
    hideHomeContent: z.boolean().nullable().optional(),
    prevUrl: z.string().nullable().optional(),
    nextUrl: z.string().nullable().optional(),
    // 上游 license：`string` 简写 或 对象形态；对象键恰为 enable?/name?/url?/author?/source?
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
      .nullable()
      .optional(),
  })
  // 与两面其余 schema 同一取舍：未知键原样保留，绝不在保存时销毁用户自定义键
  .passthrough();

/** Shirone 写入口 frontmatter 解析类型（**不等同** `ShironePostFrontmatter`：无默认值落位） */
export type ShironePostFrontmatterWrite = z.infer<typeof ShironePostFrontmatterWriteSchema>;
