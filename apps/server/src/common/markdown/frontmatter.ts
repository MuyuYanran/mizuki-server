/**
 * [阶段 P5] common/markdown/frontmatter — gray-matter 包装（纯工具提升至 common/）
 * [职责] Markdown frontmatter 的解析与序列化，往返保真保证（P5 §3.2 硬性）：
 *   - 未知字段原样保留（不在 §3.2 表中的额外字段不丢弃）；
 *   - 键顺序按插入顺序保持（序列化后字段不增不减）；
 *   - 已知字段类型不漂移（boolean 不变字符串、数组仍是数组；
 *     YAML 无引号日期解析出的 Date 往返仍为 Date）。
 * [状态] ACTIVE
 *
 * 分层：L0 纯工具，不依赖任何模块（MASTER-PLAN §4「纯工具提升至 common/
 * 属合法解耦手段」）；posts（P5）与 articles（P8）复用。
 */
import matter from 'gray-matter';

/** 解析结果：frontmatter 键值 + 正文 */
export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * 解析：原始 Markdown 文本 → { frontmatter, content }。
 * 无 frontmatter 块时返回空对象与原文正文。
 */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const parsed = matter(raw);
  return {
    frontmatter: parsed.data as Record<string, unknown>,
    content: parsed.content,
  };
}

/**
 * 序列化：{ frontmatter, content } → 原始 Markdown 文本。
 * frontmatter 为空对象时不产生分隔符块（直接返回正文）。
 * 键顺序按对象插入顺序输出（js-yaml dump 默认不排序）。
 *
 * 正文精确往返：gray-matter stringify 会给无结尾换行的正文追加 '\n'，
 * 此处补偿剥离，保证 parse(stringify(x)).content === x 逐字节成立。
 */
export function stringifyMarkdown(frontmatter: Record<string, unknown>, content: string): string {
  if (Object.keys(frontmatter).length === 0) {
    return content;
  }
  const output = matter.stringify(content, frontmatter);
  if (!content.endsWith('\n') && output.endsWith(content + '\n')) {
    return output.slice(0, -1);
  }
  return output;
}
