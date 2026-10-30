/**
 * [T4-1] posts-frontmatter-compat — 两主题 frontmatter 字段命运单源契约单测
 *
 * 权威源（只读）：`docs/refs/theme-compat/README.md` §2.1–§2.4（已逐字段对上游 postsCollection 核过）
 * + `docs/decisions/ADR-028-bi-theme-adapter.md` §2.1（已订正：Shirone 实为删 5）。
 *
 * 两轴（**正交，勿合并**）：
 * - `disposition` = 存在性轴（same 19 / added 8 / dropped 5 / changed 1，合计 33 行，field 全表唯一）；
 * - `POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP` = 搬运轴（4 条，多对一与嵌套落位）。
 * `licenseName`/`licenseUrl`/`author`/`sourceLink` **既 dropped 又有映射** —— 这正是两轴正交的证据。
 */
import { describe, expect, it } from 'vitest';
import {
  POSTS_FRONTMATTER_ADDED,
  POSTS_FRONTMATTER_CHANGED,
  POSTS_FRONTMATTER_COMPAT,
  POSTS_FRONTMATTER_DROPPED,
  POSTS_FRONTMATTER_INTERNAL,
  POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP,
  POSTS_MIZUKI_TO_SHIRONE_MAPPED,
  postsFieldDisposition,
  type PostsFieldDisposition,
} from '@mizuki/shared';

const ALL_DISPOSITIONS: readonly PostsFieldDisposition[] = ['same', 'added', 'dropped', 'changed'];

const byDisposition = (d: PostsFieldDisposition): string[] =>
  POSTS_FRONTMATTER_COMPAT.filter((row) => row.disposition === d).map((row) => row.field);

const NON_SAME: readonly PostsFieldDisposition[] = ['added', 'dropped', 'changed'];

/** 集合（src/data/*.ts）域名字与集合独有字段名：本表只讲 posts frontmatter，一个都不该出现 */
const COLLECTION_DOMAIN_NAMES: readonly string[] = [
  'diary',
  'moments',
  'friends',
  'projects',
  'timeline',
  'skills',
  'devices',
  'anime',
  'mood',
  'location',
];

describe('POSTS_FRONTMATTER_COMPAT — 表形状与行数账', () => {
  it('① 行数等于四类之和（表自身闭合）', () => {
    const sum = ALL_DISPOSITIONS.reduce((acc, d) => acc + byDisposition(d).length, 0);
    expect(POSTS_FRONTMATTER_COMPAT.length).toBe(sum);
    expect(POSTS_FRONTMATTER_COMPAT.length).toBe(33);
    expect(byDisposition('same')).toHaveLength(19);
  });

  it('② dropped 恰 5 项，且逐字等于 §2.4 的 5 个字段', () => {
    expect(POSTS_FRONTMATTER_DROPPED).toHaveLength(5);
    expect([...POSTS_FRONTMATTER_DROPPED]).toEqual([
      'priority',
      'author',
      'sourceLink',
      'licenseName',
      'licenseUrl',
    ]);
    expect(byDisposition('dropped')).toEqual([...POSTS_FRONTMATTER_DROPPED]);
  });

  it('③ changed 恰 1 项：password（存在性轴只剩它）', () => {
    expect(POSTS_FRONTMATTER_CHANGED).toHaveLength(1);
    expect([...POSTS_FRONTMATTER_CHANGED]).toEqual(['password']);
  });

  it('④ added 恰 8 项且包含 license（§2.3 的「新增 8」逐字对齐）', () => {
    expect(POSTS_FRONTMATTER_ADDED).toHaveLength(8);
    expect([...POSTS_FRONTMATTER_ADDED]).toEqual([
      'publishedAt',
      'updatedAt',
      'series',
      'seriesOrder',
      'hideHomeContent',
      'prevUrl',
      'nextUrl',
      'license',
    ]);
    expect(POSTS_FRONTMATTER_ADDED).toContain('license');
    expect(new Set(POSTS_FRONTMATTER_ADDED).size).toBe(8);
  });

  it('⑤ field 全表不重复', () => {
    const fields = POSTS_FRONTMATTER_COMPAT.map((row) => row.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('⑥ 每行 disposition 都在四档枚举内，detail 为 string，internal 为 boolean', () => {
    for (const row of POSTS_FRONTMATTER_COMPAT) {
      expect(ALL_DISPOSITIONS).toContain(row.disposition);
      expect(typeof row.field).toBe('string');
      expect(row.field.length).toBeGreaterThan(0);
      expect(typeof row.detail).toBe('string');
      expect(typeof row.internal).toBe('boolean');
    }
  });

  it('⑦ 两轴正交：dropped ∪ changed ∪ added 与 same 互斥且无交集', () => {
    const nonSame = NON_SAME.flatMap((d) => byDisposition(d));
    expect(nonSame).toHaveLength(14);
    expect(nonSame.filter((field) => byDisposition('same').includes(field))).toEqual([]);
    expect(new Set(nonSame).size).toBe(14);
  });
});

describe('POSTS_FRONTMATTER_COMPAT — internal 内部字段轴', () => {
  it('⑧ internal 必须包含 prevTitle / prevSlug / nextTitle / nextSlug / prevUrl / nextUrl', () => {
    for (const field of ['prevTitle', 'prevSlug', 'nextTitle', 'nextSlug', 'prevUrl', 'nextUrl']) {
      expect(POSTS_FRONTMATTER_INTERNAL).toContain(field);
      expect(postsFieldDisposition(field)?.internal).toBe(true);
    }
  });

  it('⑨ internal 集合恰为这 6 个（无多余内部标注，无非内部字段被误标）', () => {
    expect([...POSTS_FRONTMATTER_INTERNAL].sort()).toEqual(
      ['nextSlug', 'nextTitle', 'nextUrl', 'prevSlug', 'prevTitle', 'prevUrl'].sort(),
    );
    expect(POSTS_FRONTMATTER_INTERNAL).toHaveLength(6);
  });

  it('⑩ 四个 prev/next Title·Slug 在两档同义；prevUrl/nextUrl 只在 Shirone 侧存在', () => {
    for (const field of ['prevTitle', 'prevSlug', 'nextTitle', 'nextSlug']) {
      expect(postsFieldDisposition(field)?.disposition).toBe('same');
    }
    expect(postsFieldDisposition('prevUrl')?.disposition).toBe('added');
    expect(postsFieldDisposition('nextUrl')?.disposition).toBe('added');
  });
});

describe('POSTS_FRONTMATTER_COMPAT — detail 语义', () => {
  it('⑪ added / dropped / changed 行的 detail 必填非空', () => {
    for (const row of POSTS_FRONTMATTER_COMPAT) {
      if (NON_SAME.includes(row.disposition)) {
        expect(row.detail.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('⑫ same 行 detail 允许为空串（且本表统一取空串）', () => {
    const sameRows = POSTS_FRONTMATTER_COMPAT.filter((row) => row.disposition === 'same');
    expect(sameRows.length).toBe(19);
    expect(sameRows.every((row) => row.detail === '')).toBe(true);
  });

  it('⑬ dropped 行的 detail 指明去向（license 合并 或 seriesOrder 承接）', () => {
    for (const field of ['author', 'sourceLink', 'licenseName', 'licenseUrl']) {
      expect(postsFieldDisposition(field)?.detail).toContain('license');
    }
    expect(postsFieldDisposition('priority')?.detail).toContain('seriesOrder');
    expect(postsFieldDisposition('priority')?.detail).toContain('无字段级落点');
  });

  it('⑭ license 行的 detail 只陈述存在性，不再夹带搬运口径', () => {
    const detail = postsFieldDisposition('license')?.detail ?? '';
    expect(detail).toContain('Mizuki 侧不存在');
    expect(detail).toContain('POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP');
    expect(detail).not.toContain('合并为单字段');
  });
});

describe('postsFieldDisposition — 单字段查询', () => {
  it('⑮ 命中示例：priority→dropped / series→added / license→added / password→changed', () => {
    expect(postsFieldDisposition('priority')?.disposition).toBe('dropped');
    expect(postsFieldDisposition('series')?.disposition).toBe('added');
    expect(postsFieldDisposition('license')?.disposition).toBe('added');
    expect(postsFieldDisposition('password')?.disposition).toBe('changed');
  });

  it('⑯ 两档都有的同义字段命 same；查不到返回 null（不在任何一档 schema 里）', () => {
    expect(postsFieldDisposition('published')?.disposition).toBe('same');
    expect(postsFieldDisposition('no-such-field')).toBeNull();
    expect(postsFieldDisposition('')).toBeNull();
    expect(postsFieldDisposition('Posts')).toBeNull();
  });

  it('⑰ 返回的是表内同一行对象（引用相等，调用方无需深比较）', () => {
    const row = postsFieldDisposition('password');
    expect(row).toBe(
      POSTS_FRONTMATTER_COMPAT.find((candidate) => candidate.field === 'password'),
    );
  });
});

describe('派生集合 — 必须是现算而非第二份手写名单', () => {
  it('⑱ 四个派生数组与按表现算的结果深等', () => {
    expect([...POSTS_FRONTMATTER_DROPPED]).toEqual(byDisposition('dropped'));
    expect([...POSTS_FRONTMATTER_ADDED]).toEqual(byDisposition('added'));
    expect([...POSTS_FRONTMATTER_CHANGED]).toEqual(byDisposition('changed'));
    expect([...POSTS_FRONTMATTER_INTERNAL]).toEqual(
      POSTS_FRONTMATTER_COMPAT.filter((row) => row.internal).map((row) => row.field),
    );
  });

  it('⑲ 行序 = 文档顺序：§2.1 的 19 行同义字段在前、§2.2 的 password 紧随、§2.3 的 8 行 added、§2.4 的 5 行 dropped 收尾', () => {
    const fields = POSTS_FRONTMATTER_COMPAT.map((row) => row.field);
    expect(fields.slice(0, 19)).toEqual(byDisposition('same'));
    expect(fields[19]).toBe('password');
    expect(fields.slice(20, 28)).toEqual([...POSTS_FRONTMATTER_ADDED]);
    expect(fields.slice(-5)).toEqual([...POSTS_FRONTMATTER_DROPPED]);
  });
});

describe('POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP — 搬运轴', () => {
  it('⑳ 映射表恰 4 条，from 逐字等于那 4 个字段名，每条 to 以 `license.` 开头', () => {
    expect(POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP).toHaveLength(4);
    expect(POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP.map((entry) => entry.from)).toEqual([
      'licenseName',
      'licenseUrl',
      'author',
      'sourceLink',
    ]);
    for (const entry of POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP) {
      expect(entry.to.startsWith('license.')).toBe(true);
      expect(entry.detail.trim().length).toBeGreaterThan(0);
    }
    expect(POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP.map((entry) => entry.to)).toEqual([
      'license.name',
      'license.url',
      'license.author',
      'license.source',
    ]);
  });

  it('㉑ POSTS_MIZUKI_TO_SHIRONE_MAPPED 是派生列（与按表现算深等），且 from / to 各自唯一', () => {
    expect([...POSTS_MIZUKI_TO_SHIRONE_MAPPED]).toEqual(
      POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP.map((entry) => entry.from),
    );
    expect([...POSTS_MIZUKI_TO_SHIRONE_MAPPED]).toEqual([
      'licenseName',
      'licenseUrl',
      'author',
      'sourceLink',
    ]);
    const froms = POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP.map((entry) => entry.from);
    const tos = POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP.map((entry) => entry.to);
    expect(new Set(froms).size).toBe(froms.length);
    expect(new Set(tos).size).toBe(tos.length);
  });

  it('㉒ 两轴正交的证据：DROPPED(5) ∩ MAPPED(4) = 那 4 个既有映射又被删的名字；priority 只在 dropped', () => {
    const overlap = POSTS_FRONTMATTER_DROPPED.filter((field) =>
      POSTS_MIZUKI_TO_SHIRONE_MAPPED.includes(field),
    );
    expect(overlap).toEqual(['author', 'sourceLink', 'licenseName', 'licenseUrl']);
    expect(overlap).toHaveLength(4);
    expect(POSTS_MIZUKI_TO_SHIRONE_MAPPED).not.toContain('priority');
    expect(POSTS_FRONTMATTER_DROPPED).toContain('priority');
    expect(POSTS_FRONTMATTER_ADDED).toContain('license');
    expect(POSTS_MIZUKI_TO_SHIRONE_MAPPED).not.toContain('license');
  });

  it('㉓ 映射的 from 全部在表内（不存在指向未知字段的映射）', () => {
    const fields = POSTS_FRONTMATTER_COMPAT.map((row) => row.field);
    for (const entry of POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP) {
      expect(fields).toContain(entry.from);
    }
  });
});

describe('范围守卫 — 本表只讲 posts frontmatter', () => {
  it('㉔ 表内不含 diary 或任何集合（src/data/*.ts）域名字/集合独有字段名', () => {
    const fields = POSTS_FRONTMATTER_COMPAT.map((row) => row.field);
    for (const name of COLLECTION_DOMAIN_NAMES) {
      expect(fields).not.toContain(name);
    }
    // `author` 属 posts frontmatter 的 §2.4（Mizuki 独有），故必须在表内 —— 与集合域无关
    expect(fields).toContain('author');
    expect(fields).toContain('tags');
  });

  it('㉕ 集合域字段名不会被误登记为 posts 字段或映射来源', () => {
    for (const name of ['desc', 'date', 'url', 'cover', 'shelf', 'entry']) {
      expect(POSTS_FRONTMATTER_DROPPED).not.toContain(name);
      expect(POSTS_FRONTMATTER_ADDED).not.toContain(name);
      expect(POSTS_MIZUKI_TO_SHIRONE_MAPPED).not.toContain(name);
    }
  });
});
