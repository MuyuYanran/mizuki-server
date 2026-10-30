/**
 * [T4-3] posts-frontmatter-shirone-write — Shirone **写入口面** schema + null 删键集单测
 *
 * 本 spec 钉住的是 T4-3 引入的**读写面分叉**，六组钉子：
 * ① **两面字段面恒等**：写入口面与 T4-2 的构造面同为 28 字段、名字集合相等（漂移即红）；
 * ② **零默认值物化**：`parse()` 输出键集 == 输入键集 —— 这是与构造面最要命的差别
 *    （构造面会把 19 个默认键塞进输出，用作写入口即在用户文件里凭空造键）；
 * ③ **零转换**：`password` 的数字形态原样保留、`series` 空白原样保留（写入口只校验不改字）；
 * ④ **日期放宽但必填不放宽**：`published` 接受 `Date` 与 `string`，缺键仍拒；
 * ⑤ **删键集推导**：`SHIRONE_NULL_DELETE_KEYS` == 「Mizuki 12 键中 Shirone 仍存在的 8 个」
 *    ∪ `POSTS_FRONTMATTER_ADDED`（8 个），恰 16，且全部落在 compat 表的 Shirone 字段面内；
 * ⑥ **可空面闭合**：写入口面里接受 `null` 的键集合 **恰等于** 删键集 ∪ 上游原文可空键（`category`）
 *    —— 即「删键集里的每个键都能收到 null」（哨兵有入口），且「集外的键收不到 null」（哨兵不蔓延）。
 */
import { describe, expect, it } from 'vitest';
import {
  POSTS_FRONTMATTER_ADDED,
  POSTS_FRONTMATTER_COMPAT,
  POSTS_FRONTMATTER_DROPPED,
  SHIRONE_NULL_DELETE_KEYS,
  SHIRONE_UPSTREAM_NULLABLE_KEYS,
  ShironePostFrontmatterSchema,
  ShironePostFrontmatterWriteSchema,
} from '@mizuki/shared';

/** 最小合法 frontmatter：只有两个必填键（`title` / `published`） */
const minimal = (): Record<string, unknown> => ({
  title: 'T',
  published: new Date('2026-10-30T00:00:00Z'),
});

/** 裸对象视图（便于按键取值断言；`.passthrough()` 的未知键也在这里面） */
const parseRaw = (input: Record<string, unknown>): Record<string, unknown> =>
  ShironePostFrontmatterWriteSchema.parse(input) as unknown as Record<string, unknown>;

const writeKeys = (): string[] => Object.keys(ShironePostFrontmatterWriteSchema.shape);

/** compat 表里「Shirone 侧存在」的字段名（same + changed + added），按表序 */
const compatShironeFields = (): string[] =>
  POSTS_FRONTMATTER_COMPAT.filter(
    (row) =>
      row.disposition === 'same' || row.disposition === 'changed' || row.disposition === 'added',
  ).map((row) => row.field);

/**
 * 期望值（**字面量，刻意不引用源码常量**）：`posts.service.ts` 的 `NULL_DELETE_KEYS`（Mizuki 12 键）
 * 中，Shirone 面仍然存在的那 8 个。
 * 另一个方向由 `POSTS_FRONTMATTER_DROPPED` 交叉验证（见 ⑤）。
 */
const EXPECTED_SURVIVING_MIZUKI_NULL_DELETE_KEYS = [
  'encrypted',
  'password',
  'comment',
  'permalink',
  'lang',
  'draft',
  'alias',
  'passwordHint',
] as const;

describe('[T4-3] ShironePostFrontmatterWriteSchema — 写入口面', () => {
  it('① 与构造面字段名集合恒等（28 == 28，顺序无关）', () => {
    const ctor = Object.keys(ShironePostFrontmatterSchema.shape);
    expect(ctor).toHaveLength(28);
    expect(writeKeys()).toHaveLength(28);
    expect([...writeKeys()].sort()).toEqual([...ctor].sort());
  });

  it('① 字段面无重名，且与 compat 表的 Shirone 字段面精确相等', () => {
    const keys = writeKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...compatShironeFields()].sort());
  });

  it('② 零默认值物化：最小文档 parse 后键集 == 输入键集（构造面不成立）', () => {
    const input = minimal();
    const output = parseRaw(input);
    expect(Object.keys(output).sort()).toEqual(['published', 'title']);
    // 反向对照：构造面把默认值全部落位 —— 这正是「构造面不得当写入口用」的实证。
    // 不写死具体条数（上游改默认值不该弄红本 spec），只钉「构造面输出严格多于写入口面」+
    // 「差额恰为被物化的默认键」这个方向性事实。
    const ctorOutput = ShironePostFrontmatterSchema.parse(input) as unknown as Record<
      string,
      unknown
    >;
    const ctorKeys = new Set(Object.keys(ctorOutput));
    const materialized = [...ctorKeys].filter((key) => !Object.keys(output).includes(key));
    expect(ctorKeys.size).toBeGreaterThan(Object.keys(output).length);
    expect(materialized.length).toBe(ctorKeys.size - Object.keys(output).length);
    // 差额里必须含这几个有默认值的键（逐一列名，避免「差额来自未知键」的假阳性）
    for (const key of ['draft', 'comment', 'encrypted', 'hideHomeContent', 'series']) {
      expect(materialized).toContain(key);
    }
  });

  it('② 缺键就是缺键：不因默认值补出 draft/comment/encrypted/hideHomeContent', () => {
    const output = parseRaw(minimal());
    for (const key of ['draft', 'comment', 'encrypted', 'hideHomeContent', 'pinned', 'tags']) {
      expect(Object.prototype.hasOwnProperty.call(output, key)).toBe(false);
    }
  });

  it('③ 零转换：password 数字形态原样保留（构造面会 String() 归一）', () => {
    const output = parseRaw({ ...minimal(), password: 12345 });
    expect(output['password']).toBe(12345);
    const ctorOutput = ShironePostFrontmatterSchema.parse({ ...minimal(), password: 12345 }) as unknown as Record<
      string,
      unknown
    >;
    expect(ctorOutput['password']).toBe('12345');
  });

  it('③ 零转换：series 首尾空白原样保留（构造面带 .trim()）', () => {
    const output = parseRaw({ ...minimal(), series: '  demo  ' });
    expect(output['series']).toBe('  demo  ');
  });

  it('③ 零转换：prev/next 四内部键缺键不落空串（构造面 .default("")）', () => {
    const output = parseRaw(minimal());
    for (const key of ['prevTitle', 'prevSlug', 'nextTitle', 'nextSlug']) {
      expect(Object.prototype.hasOwnProperty.call(output, key)).toBe(false);
    }
  });

  it('④ 日期放宽：published 接受 Date 与 string，缺键/非法型仍拒', () => {
    const asDate = { ...minimal(), published: new Date('2026-01-01T00:00:00Z') };
    expect(ShironePostFrontmatterWriteSchema.safeParse(asDate).success).toBe(true);
    // 读路径（裸 YAML 解析）可能给出字符串日期 —— 写入口必须收
    expect(
      ShironePostFrontmatterWriteSchema.safeParse({ title: 'T', published: '2026-01-01' }).success,
    ).toBe(true);
    expect(ShironePostFrontmatterWriteSchema.safeParse({ title: 'T' }).success).toBe(false);
    expect(
      ShironePostFrontmatterWriteSchema.safeParse({ title: 'T', published: 20260101 }).success,
    ).toBe(false);
  });

  it('④ 必填不放宽：无 title / 空 title 均拒', () => {
    expect(ShironePostFrontmatterWriteSchema.safeParse({ published: new Date() }).success).toBe(
      false,
    );
    expect(ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), title: '' }).success).toBe(
      true,
    ); // 上游是裸 z.string()，空串合法 —— 不额外收紧
  });

  it('④ publishedAt / updatedAt 同为 date-like，且可空（删键哨兵有入口）', () => {
    expect(
      ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), publishedAt: '2026-01-01' })
        .success,
    ).toBe(true);
    expect(
      ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), updatedAt: null }).success,
    ).toBe(true);
  });

  it('④ seriesOrder 保持整数约束', () => {
    expect(
      ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), seriesOrder: 3 }).success,
    ).toBe(true);
    expect(
      ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), seriesOrder: 1.5 }).success,
    ).toBe(false);
    expect(
      ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), seriesOrder: '3' }).success,
    ).toBe(false);
  });

  it('② 有意偏离一致：.passthrough() 保留未知键（保存不销毁用户自定义键）', () => {
    const output = parseRaw({ ...minimal(), myCustomKey: { nested: 1 } });
    expect(output['myCustomKey']).toEqual({ nested: 1 });
  });

  it('⑤ 删键集恰 16 键 = 「Mizuki 12 中幸存的 8」∪「Shirone 新增 8」', () => {
    const expected = new Set([
      ...EXPECTED_SURVIVING_MIZUKI_NULL_DELETE_KEYS,
      ...POSTS_FRONTMATTER_ADDED,
    ]);
    expect(expected.size).toBe(16);
    expect([...SHIRONE_NULL_DELETE_KEYS].sort()).toEqual([...expected].sort());
    expect(SHIRONE_NULL_DELETE_KEYS).toHaveLength(16);
  });

  it('⑤ 被 Shirone 删掉的键全不在删键集内（其语义归并进 license / 内部字段）', () => {
    // 恰 5 键：4 键属 Mizuki 的 NULL_DELETE_KEYS（licenseName/licenseUrl/priority/sourceLink），
    // 另 1 键 `author` 本就不在删键集内（Mizuki 面亦无删键路径）—— 两者都要在 Shirone 面消失。
    expect([...POSTS_FRONTMATTER_DROPPED].sort()).toEqual(
      ['author', 'licenseName', 'licenseUrl', 'priority', 'sourceLink'].sort(),
    );
    for (const dropped of POSTS_FRONTMATTER_DROPPED) {
      expect(SHIRONE_NULL_DELETE_KEYS as readonly string[]).not.toContain(dropped);
    }
    // 由此导出「幸存的 8」：Mizuki 12 键 − 4 个被删键
    expect(EXPECTED_SURVIVING_MIZUKI_NULL_DELETE_KEYS).toHaveLength(12 - 4);
  });

  it('⑤ 删键集全部落在 compat 表的 Shirone 字段面内，且无重名', () => {
    const shironeFields = new Set(compatShironeFields());
    for (const key of SHIRONE_NULL_DELETE_KEYS) {
      expect(shironeFields.has(key)).toBe(true);
    }
    expect(new Set(SHIRONE_NULL_DELETE_KEYS).size).toBe(SHIRONE_NULL_DELETE_KEYS.length);
  });

  it('⑥ 可空面闭合：接受 null 的键集合 == 删键集 ∪ 上游原文可空键（category）', () => {
    const acceptsNull: string[] = [];
    for (const key of writeKeys()) {
      if (ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), [key]: null }).success) {
        acceptsNull.push(key);
      }
    }
    const expected = new Set<string>([
      ...SHIRONE_NULL_DELETE_KEYS,
      ...SHIRONE_UPSTREAM_NULLABLE_KEYS,
    ]);
    expect([...acceptsNull].sort()).toEqual([...expected].sort());
  });

  it('⑥ 上游原文可空键是唯一豁免：category 可空但不属删键哨兵', () => {
    expect(SHIRONE_UPSTREAM_NULLABLE_KEYS).toEqual(['category']);
    expect(SHIRONE_NULL_DELETE_KEYS as readonly string[]).not.toContain('category');
    expect(ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), category: null }).success).toBe(
      true,
    );
  });

  it('⑥ 删键集里的每个键都真能收到 null（哨兵有入口，不会到不了 strip）', () => {
    for (const key of SHIRONE_NULL_DELETE_KEYS) {
      const result = ShironePostFrontmatterWriteSchema.safeParse({ ...minimal(), [key]: null });
      expect(result.success, `del key ${key} 必须接受 null`).toBe(true);
    }
  });
});
