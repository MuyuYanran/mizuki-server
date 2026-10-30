/**
 * [T4-2] posts-frontmatter-shirone — Shirone posts frontmatter schema「逐字忠实」单测
 *
 * 权威源（只读）：
 * - `.test-tmp/upstream-Shirone-20261029/src/content.config.ts` 的 `postsCollection.schema`（恰 28 字段）；
 * - `docs/refs/theme-compat/README.md` §2.1（一致 19）/ §2.2（改型 1）/ §2.3（Shirone 新增 8）；
 * - `packages/shared/src/posts-frontmatter-compat.ts` 的 `POSTS_FRONTMATTER_COMPAT`
 *   —— 本 spec 的**交叉校验基准**（same ∪ changed ∪ added 必须与 schema 字段面逐字相等）。
 *
 * 三组钉子：
 * ① **字段面**：28 个，且与 compat 表精确相等（本批最关键的一条）；
 * ② **上游逐字形态**：必填 / 默认值 / transform / 类型（含 published 是 `z.date()` 不是 coerce）；
 * ③ **两处有意偏离**：`.passthrough()` 保留未知键；**零** `.nullable()` —— 不承接 Mizuki 的 null 删键哨兵。
 */
import { describe, expect, it } from 'vitest';
import {
  POSTS_FRONTMATTER_ADDED,
  POSTS_FRONTMATTER_CHANGED,
  POSTS_FRONTMATTER_COMPAT,
  type ShironePostFrontmatter,
  ShironePostFrontmatterSchema,
} from '@mizuki/shared';

/** 最小合法 frontmatter：只有两个必填键（`title` / `published`） */
const minimal = (): Record<string, unknown> => ({
  title: 'T',
  published: new Date('2026-10-30T00:00:00Z'),
});

/** 裸对象视图（便于按键取值断言；`.passthrough()` 的未知键也在这里面） */
const parseRaw = (input: Record<string, unknown>): Record<string, unknown> =>
  ShironePostFrontmatterSchema.parse(input) as unknown as Record<string, unknown>;

const shapeKeys = (): string[] => Object.keys(ShironePostFrontmatterSchema.shape);

/** compat 表里「Shirone 侧存在」的字段名（same + changed + added），按表序 */
const compatShironeFields = (): string[] =>
  POSTS_FRONTMATTER_COMPAT.filter(
    (row) =>
      row.disposition === 'same' || row.disposition === 'changed' || row.disposition === 'added',
  ).map((row) => row.field);

describe('[T4-2] ShironePostFrontmatterSchema — 字段面与 compat 表交叉校验', () => {
  it('① 字段数恰 28，且无重名', () => {
    expect(shapeKeys()).toHaveLength(28);
    expect(new Set(shapeKeys()).size).toBe(28);
  });

  it('② 字段名集合与 compat 表 same ∪ changed ∪ added **完全相等**（本批最关键的交叉校验）', () => {
    const compat = compatShironeFields();
    expect(compat).toHaveLength(28);
    expect([...shapeKeys()].sort()).toEqual([...compat].sort());
    expect(new Set(shapeKeys())).toEqual(new Set(compat));
    // 三档各自的账也必须对上（same 19 / changed 1 / added 8）
    expect([...POSTS_FRONTMATTER_CHANGED]).toEqual(['password']);
    expect([...POSTS_FRONTMATTER_ADDED]).toHaveLength(8);
    expect(compat).toContain('password');
    for (const field of POSTS_FRONTMATTER_ADDED) expect(shapeKeys()).toContain(field);
  });

  it('③ dropped 的字段一个都不在本 schema 里（priority/author/sourceLink/licenseName/licenseUrl）', () => {
    for (const row of POSTS_FRONTMATTER_COMPAT) {
      if (row.disposition === 'dropped') expect(shapeKeys()).not.toContain(row.field);
    }
    for (const dropped of ['priority', 'author', 'sourceLink', 'licenseName', 'licenseUrl']) {
      expect(shapeKeys()).not.toContain(dropped);
    }
  });

  it('④ 类型导出可用（ShironePostFrontmatter 承接 parse 结果）', () => {
    const typed: ShironePostFrontmatter = ShironePostFrontmatterSchema.parse(minimal());
    expect(typed.title).toBe('T');
    expect(typed.published).toBeInstanceOf(Date);
    expect(typed.hideHomeContent).toBe(true);
  });
});

describe('[T4-2] 上游逐字形态 — 必填 / 类型', () => {
  it('⑤ title 与 published 均必填：各缺一个都失败，都给则通过', () => {
    expect(ShironePostFrontmatterSchema.safeParse({ published: new Date() }).success).toBe(false);
    expect(ShironePostFrontmatterSchema.safeParse({ title: 'T' }).success).toBe(false);
    expect(ShironePostFrontmatterSchema.safeParse(minimal()).success).toBe(true);
  });

  it('⑥ published 是 z.date()（非 coerce）：字符串 ⇒ 失败，Date ⇒ 通过', () => {
    expect(
      ShironePostFrontmatterSchema.safeParse({ title: 'T', published: '2026-01-01' }).success,
    ).toBe(false);
    expect(parseRaw(minimal()).published).toBeInstanceOf(Date);
  });

  it('⑦ publishedAt / updatedAt 为可选 z.date()：Date 通过、字符串失败', () => {
    const withDates = { ...minimal(), publishedAt: new Date(), updatedAt: new Date() };
    expect(ShironePostFrontmatterSchema.safeParse(withDates).success).toBe(true);
    expect(
      ShironePostFrontmatterSchema.safeParse({ ...minimal(), publishedAt: '2026-01-01' }).success,
    ).toBe(false);
    expect(parseRaw(minimal()).publishedAt).toBeUndefined();
  });

  it('⑧ seriesOrder 是 z.number().int().optional()：3 通过、1.5 失败、"3" 失败', () => {
    expect(ShironePostFrontmatterSchema.safeParse({ ...minimal(), seriesOrder: 3 }).success).toBe(
      true,
    );
    expect(ShironePostFrontmatterSchema.safeParse({ ...minimal(), seriesOrder: 1.5 }).success).toBe(
      false,
    );
    expect(
      ShironePostFrontmatterSchema.safeParse({ ...minimal(), seriesOrder: '3' }).success,
    ).toBe(false);
    expect(parseRaw(minimal()).seriesOrder).toBeUndefined();
  });
});

describe('[T4-2] 上游逐字形态 — 默认值', () => {
  it('⑨ 布尔四键默认：pinned false / draft false / comment true / encrypted false', () => {
    const p = parseRaw(minimal());
    expect(p.pinned).toBe(false);
    expect(p.draft).toBe(false);
    expect(p.comment).toBe(true);
    expect(p.encrypted).toBe(false);
  });

  it('⑩ 字符串四键默认：description "" / image "" / lang "" / passwordHint ""', () => {
    const p = parseRaw(minimal());
    expect(p.description).toBe('');
    expect(p.image).toBe('');
    expect(p.lang).toBe('');
    expect(p.passwordHint).toBe('');
  });

  it('⑪ tags 默认 []（新数组、可安全改写；显式值生效）', () => {
    expect(parseRaw(minimal()).tags).toEqual([]);
    expect(parseRaw({ ...minimal(), tags: ['a', 'b'] }).tags).toEqual(['a', 'b']);
  });

  it('⑫ hideHomeContent 默认 true（显式 false 也必须被尊重，默认不得吞掉显式值）', () => {
    expect(parseRaw(minimal()).hideHomeContent).toBe(true);
    expect(parseRaw({ ...minimal(), hideHomeContent: false }).hideHomeContent).toBe(false);
  });

  it('⑬ prevTitle / prevSlug / nextTitle / nextSlug 默认 ""（上游是 .default("") 而非 .optional()）', () => {
    const p = parseRaw(minimal());
    for (const key of ['prevTitle', 'prevSlug', 'nextTitle', 'nextSlug']) {
      expect(p[key]).toBe('');
      expect(p[key]).not.toBeUndefined();
    }
    expect(parseRaw({ ...minimal(), prevTitle: 'prev', nextSlug: 'n' }).prevTitle).toBe('prev');
    expect(parseRaw({ ...minimal(), prevTitle: 'prev', nextSlug: 'n' }).nextSlug).toBe('n');
  });
});

describe('[T4-2] 上游逐字形态 — series / category / license / password', () => {
  it('⑭ series 的 .transform(trim)：\'  foo  \' ⇒ \'foo\'；缺键 ⇒ \'\'', () => {
    expect(parseRaw({ ...minimal(), series: '  foo  ' }).series).toBe('foo');
    expect(parseRaw({ ...minimal(), series: '\t bar \n' }).series).toBe('bar');
    expect(parseRaw(minimal()).series).toBe('');
  });

  it('⑮ category 可为 null（上游原文 .nullable()，非本仓哨兵）；缺键 ⇒ ""', () => {
    expect(parseRaw({ ...minimal(), category: null }).category).toBeNull();
    expect(parseRaw(minimal()).category).toBe('');
    expect(parseRaw({ ...minimal(), category: 'tech' }).category).toBe('tech');
  });

  it('⑯ license 接受字符串简写', () => {
    expect(parseRaw({ ...minimal(), license: 'CC BY-NC-SA 4.0' }).license).toBe(
      'CC BY-NC-SA 4.0',
    );
    expect(parseRaw(minimal()).license).toBeUndefined();
  });

  it('⑰ license 接受对象：enable / name / url / author{name,url} / source 全通过', () => {
    const license = {
      enable: true,
      name: 'CC BY 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      author: { name: '张三', url: 'https://example.com/about' },
      source: 'https://example.com/origin',
    };
    expect(parseRaw({ ...minimal(), license }).license).toEqual(license);
  });

  it('⑱ license.author 接受纯字符串（string 或 {name,url} 二形态）', () => {
    expect(parseRaw({ ...minimal(), license: { author: '张三' } }).license).toEqual({
      author: '张三',
    });
  });

  it('⑲ password 接受数字：12345 ⇒ "12345"（字符串）', () => {
    const p = parseRaw({ ...minimal(), password: 12345 });
    expect(p.password).toBe('12345');
    expect(typeof p.password).toBe('string');
    expect(parseRaw({ ...minimal(), password: 'pw' }).password).toBe('pw');
  });

  it('⑳ password **无 default**：不传该键 ⇒ 结果里不含 password（对比 passwordHint ⇒ ""）', () => {
    const p = parseRaw(minimal());
    expect('password' in p).toBe(false);
    expect(p.password).toBeUndefined();
    expect('passwordHint' in p).toBe(true);
    expect(p.passwordHint).toBe('');
  });
});

describe('[T4-2] 两处有意偏离的回归钉', () => {
  it('㉑ .passthrough()：未知名 customKey 被原样保留（面板保存不销毁用户自定义键）', () => {
    const p = parseRaw({ ...minimal(), customKey: 'x', another: { nested: 1 } });
    expect(p.customKey).toBe('x');
    expect(p.another).toEqual({ nested: 1 });
  });

  it('㉒ **零 .nullable()**：password / title / tags 等传 null 一律失败（Mizuki 的删键哨兵机制不得被挪来）', () => {
    expect(
      ShironePostFrontmatterSchema.safeParse({ ...minimal(), password: null }).success,
    ).toBe(false);
    expect(ShironePostFrontmatterSchema.safeParse({ ...minimal(), title: null }).success).toBe(
      false,
    );
    expect(ShironePostFrontmatterSchema.safeParse({ ...minimal(), tags: null }).success).toBe(false);
    expect(
      ShironePostFrontmatterSchema.safeParse({ ...minimal(), hideHomeContent: null }).success,
    ).toBe(false);
    expect(
      ShironePostFrontmatterSchema.safeParse({ ...minimal(), prevTitle: null }).success,
    ).toBe(false);
    // 唯一例外是 category（上游原文自带 .nullable()，与哨兵无关）
    expect(ShironePostFrontmatterSchema.safeParse({ ...minimal(), category: null }).success).toBe(
      true,
    );
  });
});
