/**
 * [T4-1] posts frontmatter 两主题逐字段对照 —— 字段命运单源（single source of truth）
 *
 * [职责] 只回答两个**正交**的问题：
 *        ① **在不在** —— 一个 posts frontmatter 字段在各档 schema 里是否存在（`disposition` 轴）；
 *        ② **搬到哪** —— Mizuki 侧字段值落到 Shirone 侧的哪个位置（`POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP` 轴）。
 *        本表是「两主题互转时的字段命运单源」，供转换摘要、迁移预检与面板提示消费；
 *        不参与任何读写、不做校验、不认识文件路径（纯数据契约 + 纯函数）。
 * [状态] ACTIVE
 *
 * 上游依据（只读，禁在别处再抄一份名单）：
 * - `docs/refs/theme-compat/README.md` §2.1（一致字段）/ §2.2（改型）/ §2.3（Shirone 新增 8）/
 *   §2.4（Mizuki 独有 5）—— 该文档已逐字段对上游 `src/content.config.ts` 的 `postsCollection` 核过，
 *   `Mizuki/src/content.config.ts` ↔ `Shirone/src/content.config.ts`。
 * - `docs/decisions/ADR-028-bi-theme-adapter.md` §2.1（**已订正**：曾误写为「Shirone 仅无 `priority`」，
 *   实为**删 5**：`priority` / `author` / `sourceLink` / `licenseName` / `licenseUrl`）。
 *   ⚠ 保留这条历史：若有人按旧口径把 `DROPPED` 「修回」成 1 项，那是回退到错误结论，不是简化。
 *
 * 两轴拆分的由来（2026-10-29 架构师裁决，**勿合并回去**）：
 *   曾把「存在性」与「值怎么搬」压进同一个 `disposition` 字段 ⇒ `license` 被计入两处
 *   （§2.3 的「新增 8」+ §2.2 的「改型 2」）⇒ 上游口径「8/5/2」与「`field` 全表唯一」互斥。
 *   事实是：Mizuki 侧**根本没有** `license` 这个字段（其版权信息由 `licenseName` / `licenseUrl` /
 *   `author` 三个独立字段承担），「三合一」是**搬运规则**而非存在形态。
 *   现拆为两轴：`disposition`（same / added / dropped / changed，纯存在性）
 *   + `POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP`（搬运）。故 **added 8 与 changed 1 同时成立、
 *   `field` 仍全表唯一**，行数不变（33）。
 *
 * [L0] 分层：`packages/shared/src` —— 只用 TS 类型与常量，零 zod、零 I/O、零 node:*、零仓内 import。
 *      禁止把读写/迁移逻辑搬进来（那是 L1/L2 的事）。
 */

/** 两档主题标识（与 theme-adapter 的能力画像 id 对齐） */
export type PostsFrontmatterTheme = 'mizuki' | 'shirone';

/**
 * 一个 frontmatter 字段在**两档之间**的命运（**存在性轴**：只管「在不在」）。
 * - `same`    两档同义同型（含「两档都没有」以外的全部一致情形）
 * - `added`   仅 Shirone 有（Mizuki 无）
 * - `dropped` 仅 Mizuki 有（Shirone **删**掉了它）
 * - `changed` 两档都有但形态不同（类型/默认值/结构）
 *
 * ⚠ 「值怎么搬」是另一根轴，见 `POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP`；本字段**不得**再承载映射信息。
 */
export type PostsFieldDisposition = 'same' | 'added' | 'dropped' | 'changed';

export interface PostsFrontmatterCompatRow {
  /** 字段名（Mizuki 侧命名；`added` 行用 Shirone 侧命名） */
  readonly field: string;
  readonly disposition: PostsFieldDisposition;
  /** 人读差异说明；`changed` / `added` / `dropped` 必填非空，`same` 可为 '' */
  readonly detail: string;
  /** 是否「主题标注为内部字段」（构建期回填，非作者字段） */
  readonly internal: boolean;
}

/**
 * 全量逐字段对照表：覆盖 `docs/refs/theme-compat/README.md` §2.1–§2.4 的**每一行**，
 * 行序 = 文档顺序（`license` 归 §2.3，故列在该段末位）。
 */
export const POSTS_FRONTMATTER_COMPAT: readonly PostsFrontmatterCompatRow[] = [
  // ── §2.1 共有字段（19：两行合写的 prev/next 对已逐字段展开，便于按名单查询） ──
  { field: 'title', disposition: 'same', detail: '', internal: false },
  { field: 'published', disposition: 'same', detail: '', internal: false },
  { field: 'updated', disposition: 'same', detail: '', internal: false },
  { field: 'draft', disposition: 'same', detail: '', internal: false },
  { field: 'description', disposition: 'same', detail: '', internal: false },
  { field: 'image', disposition: 'same', detail: '', internal: false },
  { field: 'tags', disposition: 'same', detail: '', internal: false },
  { field: 'category', disposition: 'same', detail: '', internal: false },
  { field: 'lang', disposition: 'same', detail: '', internal: false },
  { field: 'pinned', disposition: 'same', detail: '', internal: false },
  { field: 'comment', disposition: 'same', detail: '', internal: false },
  { field: 'encrypted', disposition: 'same', detail: '', internal: false },
  { field: 'alias', disposition: 'same', detail: '', internal: false },
  { field: 'permalink', disposition: 'same', detail: '', internal: false },
  { field: 'passwordHint', disposition: 'same', detail: '', internal: false },
  // 主题标注的内部字段（构建期回填，非作者字段）
  { field: 'prevTitle', disposition: 'same', detail: '', internal: true },
  { field: 'prevSlug', disposition: 'same', detail: '', internal: true },
  { field: 'nextTitle', disposition: 'same', detail: '', internal: true },
  { field: 'nextSlug', disposition: 'same', detail: '', internal: true },

  // ── §2.2 改型字段（1） —— 两档同名同存，仅形态不同 ──
  {
    field: 'password',
    disposition: 'changed',
    detail:
      'Mizuki `z.string().optional().default("")`；Shirone `z.union([z.string(), z.number()]).transform(String).optional()`（无 default）—— 接受数字口令，且未写该字段时不再落 ""。',
    internal: false,
  },

  // ── §2.3 Shirone 新增字段（8） —— Mizuki 侧不存在 ──
  {
    field: 'publishedAt',
    disposition: 'added',
    detail:
      'Shirone 新增 `z.date().optional()`；与必填的 `published` 并存，语义为「首次发布时刻」。Mizuki schema 中不存在。',
    internal: false,
  },
  {
    field: 'updatedAt',
    disposition: 'added',
    detail:
      'Shirone 新增 `z.date().optional()`；与 `updated` 并存。Mizuki schema 中不存在。',
    internal: false,
  },
  {
    field: 'series',
    disposition: 'added',
    detail:
      'Shirone 新增单归属系列 slug：`string`，默认 ""，并 `.transform(trim)`；Mizuki 无系列概念（系列在 Shirone 是独立集合 `src/content/series/*.md`）。',
    internal: false,
  },
  {
    field: 'seriesOrder',
    disposition: 'added',
    detail: 'Shirone 新增系列内顺序：`z.number().int().optional()`。Mizuki schema 中不存在。',
    internal: false,
  },
  {
    field: 'hideHomeContent',
    disposition: 'added',
    detail:
      'Shirone 新增：`boolean`，默认 `true` —— 加密文章在首页隐藏正文。Mizuki 无对应开关。',
    internal: false,
  },
  {
    field: 'prevUrl',
    disposition: 'added',
    detail:
      'Shirone 新增：`string`（可选）。主题标注的**内部字段**，构建期回填相邻文章 URL，非作者字段。',
    internal: true,
  },
  {
    field: 'nextUrl',
    disposition: 'added',
    detail:
      'Shirone 新增：`string`（可选）。主题标注的**内部字段**，构建期回填相邻文章 URL，非作者字段。',
    internal: true,
  },
  {
    field: 'license',
    disposition: 'added',
    detail:
      '仅 Shirone 有该字段；Mizuki 侧不存在（其版权信息由 `licenseName` / `licenseUrl` / `author` 三个独立字段承担，搬运规则见 `POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP`）。',
    internal: false,
  },

  // ── §2.4 Mizuki 独有字段（Shirone posts schema 中不存在，5 —— 全为 dropped） ──
  {
    field: 'priority',
    disposition: 'dropped',
    detail:
      'Shirone 删除（Mizuki `z.number().optional()`）。**无字段级落点**：转入 Shirone 时该值无处安放，可考虑用 `seriesOrder` 承接，否则丢弃（本表刻意不给映射，需人工取舍）。',
    internal: false,
  },
  {
    field: 'author',
    disposition: 'dropped',
    detail: 'Shirone 删除该独立字段；作者署名改由单篇 `license.author` 承担（见映射表）。',
    internal: false,
  },
  {
    field: 'sourceLink',
    disposition: 'dropped',
    detail: 'Shirone 删除；转载来源改由单篇 `license.source` 承担（见映射表）。',
    internal: false,
  },
  {
    field: 'licenseName',
    disposition: 'dropped',
    detail: 'Shirone 删除；并入 `license`（`license` 为 string 时即名称，为对象时取 `name`，见映射表）。',
    internal: false,
  },
  {
    field: 'licenseUrl',
    disposition: 'dropped',
    detail: 'Shirone 删除；并入 `license`（对象形态的 `url` 键，见映射表）。',
    internal: false,
  },
];

/**
 * **字段映射**（与 `disposition` 正交的第二个轴）：Mizuki 侧字段值落到 Shirone 侧的哪个位置。
 * 与 disposition 的区别：disposition 说「在不在」，本表说「搬到哪」。
 * 曾把两者压成一个字段 ⇒ `license` 被数两次。**禁止再合并回去。**
 */
export interface PostsFrontmatterFieldMap {
  /** Mizuki 侧字段名 */
  readonly from: string;
  /** Shirone 侧落点（可含子路径，如 `license.author`） */
  readonly to: string;
  /** 人读说明（不可逆之处必须写明） */
  readonly detail: string;
}

/**
 * ⚠ 本表 4 条**全部转录自** `docs/refs/theme-compat/README.md` §2.4 各行自带的 `detail` 文案
 *   （那是已对上游核过的权威表），**不是架构师新推断的映射**。
 *   T4-2 写 Shirone schema 时需带两档 schema 并排复核，届时如有出入以复核结果为准。
 *
 * 覆盖范围：`licenseName` / `licenseUrl` / `author` / `sourceLink` 四条多对一（三合一 + 作者）
 * 与嵌套落位。`priority` **不在本表**：上游未给出落点（§2.4 无映射文案），需人工取舍。
 *
 * **[已源证 2026-10-30]** 上游 `content.config.ts` 的 `license` 对象键**恰为** `enable?/name?/url?/author?/source?`，
 *   与本表 4 条的 `to` 后缀（`name`/`url`/`author`/`source`）逐条对上 ⇒ 本表由「推导」升格为**源证**，无需再复核。
 */
export const POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP: readonly PostsFrontmatterFieldMap[] = [
  {
    from: 'licenseName',
    to: 'license.name',
    detail:
      '`license` 为 string 时即名称（写入该串），为对象时取 `name` 键；Mizuki 侧为独立 `string`，默认 ""。',
  },
  {
    from: 'licenseUrl',
    to: 'license.url',
    detail: '对象形态的 `url` 键；Mizuki 侧为独立 `string`，默认 ""。',
  },
  {
    from: 'author',
    to: 'license.author',
    detail:
      'Shirone `license.author` 收 `string` 或 `{ name, url }`；Mizuki 侧为独立 `string`，默认 ""。',
  },
  {
    from: 'sourceLink',
    to: 'license.source',
    detail: '转载来源；Mizuki 侧为独立 `string`，默认 ""。',
  },
];

/** 派生集合：[dropped] 仅 Mizuki 有、Shirone 删掉的字段（行序 = 表序） */
export const POSTS_FRONTMATTER_DROPPED: readonly string[] = POSTS_FRONTMATTER_COMPAT.filter(
  (row) => row.disposition === 'dropped',
).map((row) => row.field);

/** 派生集合：[added] 仅 Shirone 有的字段（行序 = 表序；含 `license`） */
export const POSTS_FRONTMATTER_ADDED: readonly string[] = POSTS_FRONTMATTER_COMPAT.filter(
  (row) => row.disposition === 'added',
).map((row) => row.field);

/** 派生集合：[changed] 两档同名异型/异结构的字段（行序 = 表序） */
export const POSTS_FRONTMATTER_CHANGED: readonly string[] = POSTS_FRONTMATTER_COMPAT.filter(
  (row) => row.disposition === 'changed',
).map((row) => row.field);

/** 派生集合：[internal] 主题标注为内部字段（构建期回填，非作者字段） */
export const POSTS_FRONTMATTER_INTERNAL: readonly string[] = POSTS_FRONTMATTER_COMPAT.filter(
  (row) => row.internal,
).map((row) => row.field);

/** 派生集合：映射表 `from` 列（Mizuki 侧有值、Shirone 侧需搬运的字段；禁手写第二份名单） */
export const POSTS_MIZUKI_TO_SHIRONE_MAPPED: readonly string[] =
  POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP.map((entry) => entry.from);

/** 字段名 → 行 的查询索引（模块级只读，表本身不变） */
const COMPAT_BY_FIELD: ReadonlyMap<string, PostsFrontmatterCompatRow> = new Map(
  POSTS_FRONTMATTER_COMPAT.map((row) => [row.field, row]),
);

/**
 * 单字段查询：查不到（不在两档任何一档的 schema 里）⇒ `null`。
 * 返回的是表内同一行对象（引用相等），调用方可直接取 `disposition` / `detail`。
 */
export function postsFieldDisposition(field: string): PostsFrontmatterCompatRow | null {
  return COMPAT_BY_FIELD.get(field) ?? null;
}
