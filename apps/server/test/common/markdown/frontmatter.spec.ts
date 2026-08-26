import { parseMarkdown, stringifyMarkdown } from '../../../src/common/markdown/frontmatter';

/**
 * P5 §3.2 往返保真（硬性）单元依据：
 * 字段集合不增不减、未知字段原样保留、键顺序不变、已知字段类型不漂移。
 */

describe('common/markdown/frontmatter（gray-matter 包装）', () => {
  it('解析：frontmatter 与正文分离', () => {
    const raw = '---\ntitle: 标题\npinned: true\n---\n\n正文内容。\n';
    const parsed = parseMarkdown(raw);
    expect(parsed.frontmatter['title']).toBe('标题');
    expect(parsed.frontmatter['pinned']).toBe(true);
    expect(parsed.content).toContain('正文内容。');
  });

  it('解析：无 frontmatter 块 → 空对象 + 原正文', () => {
    const parsed = parseMarkdown('# 纯正文\n没有 frontmatter。\n');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.content).toContain('# 纯正文');
  });

  it('往返保真：12 已知字段 + 自定义字段，集合一致、类型不变', () => {
    const frontmatter: Record<string, unknown> = {
      title: '保真测试',
      published: true,
      description: 'SEO 摘要',
      tags: ['a', 'b'],
      category: '随笔',
      author: '暮雨',
      permalink: '/posts/rt',
      pinned: true,
      draft: false,
      image: 'cover.jpg',
      date: '2026-08-26',
      pubDate: '2026-08-26',
      customExtra: '自定义字段值',
    };
    const content = '# 正文\n\n保真正文。';
    const reparsed = parseMarkdown(stringifyMarkdown(frontmatter, content));

    // 字段集合一致（额外字段保留，不增不减）
    expect(Object.keys(reparsed.frontmatter).sort()).toEqual(Object.keys(frontmatter).sort());
    // 类型不变：boolean 不变字符串、数组仍是数组
    expect(reparsed.frontmatter['published']).toBe(true);
    expect(reparsed.frontmatter['pinned']).toBe(true);
    expect(reparsed.frontmatter['draft']).toBe(false);
    expect(Array.isArray(reparsed.frontmatter['tags'])).toBe(true);
    expect(reparsed.frontmatter['tags']).toEqual(['a', 'b']);
    expect(reparsed.frontmatter['date']).toBe('2026-08-26');
    expect(reparsed.frontmatter['pubDate']).toBe('2026-08-26');
    // 未知字段原样保留
    expect(reparsed.frontmatter['customExtra']).toBe('自定义字段值');
    // 正文一致
    expect(reparsed.content).toBe(content);
  });

  it('往返保真：键顺序保持（序列化后字段顺序不变）', () => {
    const frontmatter: Record<string, unknown> = { zeta: '1', alpha: '2', mid: 3 };
    const reparsed = parseMarkdown(stringifyMarkdown(frontmatter, 'body'));
    expect(Object.keys(reparsed.frontmatter)).toEqual(['zeta', 'alpha', 'mid']);
  });

  it('空 frontmatter：不产生分隔符块，正文原样返回', () => {
    const content = '只有正文。';
    expect(stringifyMarkdown({}, content)).toBe(content);
  });

  it('YAML 日期语义：无引号日期解析为 Date，往返类型不漂移', () => {
    const raw = '---\ntitle: t\npubDate: 2026-01-01\n---\nbody';
    const parsed = parseMarkdown(raw);
    expect(parsed.frontmatter['pubDate']).toBeInstanceOf(Date);
    const reparsed = parseMarkdown(stringifyMarkdown(parsed.frontmatter, parsed.content));
    expect(reparsed.frontmatter['pubDate']).toBeInstanceOf(Date);
    expect((reparsed.frontmatter['pubDate'] as Date).toISOString()).toBe(
      (parsed.frontmatter['pubDate'] as Date).toISOString(),
    );
  });
});
