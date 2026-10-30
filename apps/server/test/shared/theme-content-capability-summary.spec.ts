/**
 * [T4-2..T4-4 汇总] `summarizeContentCapabilities` —— 能力画像的人读投影单测
 *
 * 钉三件事：
 * ① 三档主题各自产出正确摘要（Mizuki 两档 / Shirone / unknown）；
 * ② 返回的数组是**副本**（调用方改它不得污染能力画像 —— 防跨请求共享可变状态）；
 * ③ 判定规则只此一处（面板不再自己按六个字段拼文案）。
 */
import { describe, expect, it } from 'vitest';
import {
  type ThemeCapabilities,
  ThemeCapabilitiesSchema,
  summarizeContentCapabilities,
} from '@mizuki/shared';

function caps(overrides: Partial<ThemeCapabilities> = {}): ThemeCapabilities {
  return ThemeCapabilitiesSchema.parse({
    config: { supported: true, strategy: 'none', domains: [] },
    dataFiles: { supported: true, collections: [] },
    posts: { supported: true, extensions: ['.md'], frontmatterSchemaId: 'mizuki-posts' },
    contentCollections: { supported: false, ids: [] },
    themeLock: { supported: true, profileId: 'mizuki-tier1' },
    serverMode: { mode: 'manage', enforcement: 'declared-only' },
    ...overrides,
  });
}

describe('[汇总] summarizeContentCapabilities', () => {
  it('① Mizuki 档：仅 Markdown 文章', () => {
    const s = summarizeContentCapabilities(caps());
    expect(s.postExtensions).toEqual(['.md']);
    expect(s.contentCollections).toBe(false);
    expect(s.contentCollectionIds).toEqual([]);
    expect(s.frontmatterSchemaId).toBe('mizuki-posts');
    expect(s.headline).toContain('Markdown 文章');
    expect(s.headline).not.toContain('内容集合');
  });

  it('① Shirone 档：文章（.md/.mdx）+ 内容集合（series/moments）', () => {
    const s = summarizeContentCapabilities(
      caps({
        posts: { supported: true, extensions: ['.md', '.mdx'], frontmatterSchemaId: 'shirone-posts' },
        contentCollections: { supported: true, ids: ['series', 'moments'] },
      }),
    );
    expect(s.postExtensions).toEqual(['.md', '.mdx']);
    expect(s.contentCollections).toBe(true);
    expect(s.contentCollectionIds).toEqual(['series', 'moments']);
    expect(s.headline).toContain('.mdx');
    expect(s.headline).toContain('series');
    expect(s.headline).toContain('moments');
  });

  it('① unknown 档：posts 不支持 ⇒ 明确文案', () => {
    const s = summarizeContentCapabilities(
      caps({
        posts: { supported: false, extensions: [], frontmatterSchemaId: '' },
        contentCollections: { supported: false, ids: [] },
      }),
    );
    expect(s.headline).toBe('当前主题不支持内容管理');
    expect(s.frontmatterSchemaId).toBe('');
  });

  it('② 返回的数组是副本（改它不污染能力画像）', () => {
    const source = caps({
      posts: { supported: true, extensions: ['.md', '.mdx'], frontmatterSchemaId: 'shirone-posts' },
      contentCollections: { supported: true, ids: ['series'] },
    });
    const s = summarizeContentCapabilities(source);
    s.postExtensions.push('.evil');
    s.contentCollectionIds.push('evil');
    expect(source.posts.extensions).toEqual(['.md', '.mdx']);
    expect(source.contentCollections.ids).toEqual(['series']);
  });
});
