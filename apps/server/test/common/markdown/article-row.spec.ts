/**
 * [Wave-2 补测] common/markdown/article-row 单测
 * [覆盖] frontmatter → article 行的字段映射 + 状态推导（含 ADR-025 安全分支）
 * [背景] ADR-025 登记的 `published === false` 兼容分支是**安全向**逻辑：删掉它，
 *   存量「以 published:false 表示草稿」的文章会被判为 published 而**公开**。
 *   故此处把该分支与告警行为一并钉死——它是红线，不是可清理的兼容代码。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 捕获 pino 告警（article-row 唯一副作用） */
const warn = vi.fn();
vi.mock('../../../src/common/logger', () => ({
  logger: { warn: (...args: unknown[]) => warn(...args) },
}));

const { deriveStatus, toArticleRow, toDateOrNull } = await import('../../../src/common/markdown/article-row');

describe('[Wave-2] common/markdown/article-row', () => {
  beforeEach(() => {
    warn.mockClear();
  });

  describe('deriveStatus（含 ADR-025 红线分支）', () => {
    it('draft: true → draft', () => {
      expect(deriveStatus({ draft: true })).toBe('draft');
    });

    it('published: false（遗留布尔写法）→ draft，并产出 ADR-025 告警', () => {
      expect(deriveStatus({ published: false }, 'legacy-post')).toBe('draft');
      // 告警必须存在：漏报会让运维无从发现存量脏数据
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls[0])).toContain('legacy-post');
    });

    it('published 为发布日期（官方语义，字符串/Date）→ published 且不告警', () => {
      expect(deriveStatus({ published: '2026-01-02' })).toBe('published');
      expect(deriveStatus({ published: new Date('2026-01-02T00:00:00Z') })).toBe('published');
      expect(deriveStatus({ published: true })).toBe('published');
      expect(warn).not.toHaveBeenCalled();
    });

    it('缺键 → published（默认发布）', () => {
      expect(deriveStatus({})).toBe('published');
    });

    it('draft:true 优先于 published:false（不重复告警）', () => {
      expect(deriveStatus({ draft: true, published: false })).toBe('draft');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('toDateOrNull', () => {
    it('合法 Date / 可解析字符串 → Date', () => {
      const d = new Date('2026-01-02T03:04:05Z');
      expect(toDateOrNull(d)).toEqual(d);
      expect(toDateOrNull('2026-01-02')).toBeInstanceOf(Date);
    });

    it('非法 Date / 不可解析字符串 / 其他类型 → null', () => {
      expect(toDateOrNull(new Date('nope'))).toBeNull();
      expect(toDateOrNull('not-a-date')).toBeNull();
      expect(toDateOrNull(123)).toBeNull();
      expect(toDateOrNull(undefined)).toBeNull();
    });
  });

  describe('toArticleRow', () => {
    it('字段映射：title 缺失回落 slug、可选字段缺失落 null、pinned 严格判 true', () => {
      const row = toArticleRow('slug-a', {}, 'hash-1', 'src/content/posts/slug-a/index.md');
      expect(row).toMatchObject({
        title: 'slug-a',
        status: 'published',
        filePath: 'src/content/posts/slug-a/index.md',
        fileHash: 'hash-1',
        categoryId: null,
        cover: null,
        summary: null,
        pinned: false,
        pubDate: null,
      });
      expect(row.updatedAt).toBeInstanceOf(Date);
    });

    it('image/description/category/pinned 正确投影', () => {
      const row = toArticleRow(
        'slug-b',
        {
          title: '标题',
          image: 'cover.jpg',
          description: '摘要',
          category: '随笔',
          pinned: true,
          pubDate: '2026-02-03',
        },
        'hash-2',
        'src/content/posts/slug-b.md',
      );
      expect(row).toMatchObject({
        title: '标题',
        cover: 'cover.jpg',
        summary: '摘要',
        categoryId: '随笔',
        pinned: true,
        filePath: 'src/content/posts/slug-b.md', // 文件形态路径原样透传（B1/B2 修复点）
      });
      expect(row.pubDate).toBeInstanceOf(Date);
    });

    it('pubDate 优先于 date；draft:true → status draft', () => {
      const row = toArticleRow('s', { draft: true, date: '2020-01-01', pubDate: '2026-01-01' }, 'h', 'p');
      expect(row.status).toBe('draft');
      expect(row.pubDate?.toISOString().startsWith('2026-01-01')).toBe(true);
    });
  });
});
