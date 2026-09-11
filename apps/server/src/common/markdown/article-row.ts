/**
 * [重构/Wave-2] common/markdown/article-row — frontmatter → article 行映射与状态推导
 * [职责] 统一文章索引行（`article` 表）的字段投影与状态推导，消除此前的两份实现：
 *   - posts.service.articleValues（写入出口）+ articles.service.markdownRowValues
 *     （post.changed 订阅出口）——两份映射已发生真实漂移（filePath 口径不同、
 *     状态推导一侧带告警一侧不带）；
 *   - posts.service.deriveStatus（带告警）+ articles.service 内联判定（不带告警）。
 * [状态] ACTIVE
 *
 * ⚠️ 安全契约（ADR-025，不可删改）：`published === false` 是**遗留兼容分支**。
 *   官方语义中 published 是发布日期（YYYY-MM-DD），draft 才是布尔开关；但历史
 *   版本面板曾误写 `published: false`。存量文章依赖此分支维持「不公开」，
 *   一旦删除，这些草稿会被判为 published 而**公开**——属安全向回归。
 *   故：分支保留 + pino warn 提示迁移到 draft；同一篇文章在一次写入中可能经
 *   多处调用（判定 / 日志 / DB 投影）而重复告警，取舍为「宁可重复告警，
 *   不可漏报」（ADR-025 登记）。
 */
import { logger } from '../logger';

/** 文章状态（与 `article.status` 列的取值域一致） */
export type ArticleStatus = 'draft' | 'published';

/**
 * 状态推导：draft===true → 'draft'；published===false（遗留）→ 'draft' + warn；
 * 其余（含 published 为日期串/Date、缺键）→ 'published'。
 * @param slug 仅用于告警定位（可选；不参与判定）
 */
export function deriveStatus(frontmatter: Record<string, unknown>, slug?: string): ArticleStatus {
  if (frontmatter['draft'] === true) {
    return 'draft';
  }
  if (frontmatter['published'] === false) {
    logger.warn(
      { slug, key: 'published', value: false },
      '遗留 frontmatter：published 为布尔 false（官方语义为发布日期 YYYY-MM-DD）；按 draft 处理以免草稿被公开，建议迁移为 draft: true',
    );
    return 'draft';
  }
  return 'published';
}

/** date/pubDate → Date（string 或 YAML 解析出的 Date；非法 → null） */
export function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** `article` 行的可写字段投影（不含 id/slug/sourceType/deletedAt） */
export interface ArticleRowValues {
  title: string;
  status: ArticleStatus;
  filePath: string;
  fileHash: string;
  categoryId: string | null;
  cover: string | null;
  summary: string | null;
  pinned: boolean;
  pubDate: Date | null;
  updatedAt: Date;
}

/**
 * frontmatter → article 行字段（P5 §3.6 映射规则，P8 §4.4 订阅侧同源）。
 * @param filePath 实际盘上路径（目录式 `<posts>/<slug>/index.md` / 文件式
 *   `<posts>/<slug>.md`）。由调用方提供而非就地推导——文件形态自 B2 起合法，
 *   硬编码目录形态会让文件式文章在公开详情面读错路径。
 */
export function toArticleRow(
  slug: string,
  frontmatter: Record<string, unknown>,
  fileHash: string,
  filePath: string,
): ArticleRowValues {
  return {
    // title 为必填字段；防御性兜底：缺失时以 slug 代替（避免 NOT NULL 违约）
    title: typeof frontmatter['title'] === 'string' ? frontmatter['title'] : slug,
    status: deriveStatus(frontmatter, slug),
    filePath,
    fileHash,
    // ⚠ category_id 列直接存 frontmatter.category 名称：schema 未建 FK 约束，
    //   P5 映射规则仅有 frontmatter 值
    categoryId: typeof frontmatter['category'] === 'string' ? frontmatter['category'] : null,
    cover: typeof frontmatter['image'] === 'string' ? frontmatter['image'] : null,
    summary: typeof frontmatter['description'] === 'string' ? frontmatter['description'] : null,
    pinned: frontmatter['pinned'] === true,
    pubDate: toDateOrNull(frontmatter['pubDate'] ?? frontmatter['date']),
    updatedAt: new Date(),
  };
}
