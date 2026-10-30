/**
 * [T5b-1] Shirone content collections（series / moments）—— 两面制单测
 *
 * 五组钉子：
 * ① **构造面与上游逐字一致**（字段数、默认值落位、`published: z.date()` 拒字符串）；
 * ② **零默认值物化**：写入口面 parse 输出键集 == 输入键集（与构造面最要命的差别）；
 * ③ **日期放宽但必填不放宽**（moments.published 收 string，缺键仍拒）；
 * ④ **删键集是推导式**：恒等于「字段面 − 必填键」，且每个键真能收到 null；
 * ⑤ **images 结构**按源码（`{src, alt?}` 对象数组），不是字符串数组 —— 旧记忆曾错。
 */
import { describe, expect, it } from 'vitest';
import {
  MOMENTS_NULL_DELETE_KEYS,
  MOMENTS_REQUIRED_KEYS,
  SERIES_NULL_DELETE_KEYS,
  SERIES_REQUIRED_KEYS,
  SHIRONE_COLLECTION_EXTENSIONS,
  SHIRONE_COLLECTION_SUBDIRS,
  ShironeMomentsConstructSchema,
  ShironeMomentsWriteSchema,
  ShironeSeriesConstructSchema,
  ShironeSeriesWriteSchema,
} from '@mizuki/shared';

const seriesKeys = (): string[] => Object.keys(ShironeSeriesWriteSchema.shape);
const momentsKeys = (): string[] => Object.keys(ShironeMomentsWriteSchema.shape);

const minimalMoment = (): Record<string, unknown> => ({
  published: new Date('2026-10-30T00:00:00Z'),
});

describe('[T5b-1] series — 构造面 vs 写入口面', () => {
  it('① 构造面 3 字段，默认值全部落位（status=ongoing / defaultCategory=""）', () => {
    const out = ShironeSeriesConstructSchema.parse({ title: 'S' }) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(ShironeSeriesConstructSchema.shape)).toHaveLength(3);
    expect(out['status']).toBe('ongoing');
    expect(out['defaultCategory']).toBe('');
  });

  it('② 写入口面 3 字段，且**零默认值物化**', () => {
    expect(seriesKeys()).toHaveLength(3);
    const out = ShironeSeriesWriteSchema.parse({ title: 'S' }) as unknown as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['title']);
    expect(Object.prototype.hasOwnProperty.call(out, 'status')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'defaultCategory')).toBe(false);
  });

  it('② 写入口面两面字段名恒等', () => {
    expect([...seriesKeys()].sort()).toEqual(
      [...Object.keys(ShironeSeriesConstructSchema.shape)].sort(),
    );
  });

  it('③ title 必填（上游裸 z.string()）', () => {
    expect(ShironeSeriesWriteSchema.safeParse({}).success).toBe(false);
    expect(ShironeSeriesWriteSchema.safeParse({ title: 'S' }).success).toBe(true);
  });

  it('③ status 仍受 enum 约束（不能写非法值）', () => {
    expect(ShironeSeriesWriteSchema.safeParse({ title: 'S', status: 'ongoing' }).success).toBe(true);
    expect(ShironeSeriesWriteSchema.safeParse({ title: 'S', status: 'completed' }).success).toBe(
      true,
    );
    expect(ShironeSeriesWriteSchema.safeParse({ title: 'S', status: 'archived' }).success).toBe(
      false,
    );
  });

  it('④ 删键集 == 字段面 − 必填键', () => {
    const expected = seriesKeys().filter(
      (k) => !(SERIES_REQUIRED_KEYS as readonly string[]).includes(k),
    );
    expect([...SERIES_NULL_DELETE_KEYS].sort()).toEqual(expected.sort());
    expect(SERIES_NULL_DELETE_KEYS).toHaveLength(2);
  });

  it('④ 删键集里每个键都真能收到 null', () => {
    for (const key of SERIES_NULL_DELETE_KEYS) {
      expect(
        ShironeSeriesWriteSchema.safeParse({ title: 'S', [key]: null }).success,
        `del key ${key}`,
      ).toBe(true);
    }
  });

  it('④ 必填键收不到 null（不给出「删掉必填键」的假入口）', () => {
    for (const key of SERIES_REQUIRED_KEYS) {
      expect(ShironeSeriesWriteSchema.safeParse({ [key]: null }).success).toBe(false);
    }
  });

  it('② .passthrough() 保留未知键', () => {
    const out = ShironeSeriesWriteSchema.parse({ title: 'S', extra: 1 }) as unknown as Record<
      string,
      unknown
    >;
    expect(out['extra']).toBe(1);
  });
});

describe('[T5b-1] moments — 构造面 vs 写入口面', () => {
  it('① 构造面 7 字段，默认值全部落位', () => {
    const out = ShironeMomentsConstructSchema.parse(minimalMoment()) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(ShironeMomentsConstructSchema.shape)).toHaveLength(7);
    expect(out['pinned']).toBe(false);
    expect(out['location']).toBe('');
    expect(out['mood']).toBe('');
    expect(out['tags']).toEqual([]);
    expect(out['images']).toEqual([]);
    expect(out['draft']).toBe(false);
  });

  it('① 构造面的 published 是 z.date() —— 字符串被拒（这正是不能当写入口的原因）', () => {
    expect(
      ShironeMomentsConstructSchema.safeParse({ published: '2026-10-30' }).success,
    ).toBe(false);
    expect(ShironeMomentsConstructSchema.safeParse(minimalMoment()).success).toBe(true);
  });

  it('② 写入口面 7 字段，且**零默认值物化**', () => {
    expect(momentsKeys()).toHaveLength(7);
    const out = ShironeMomentsWriteSchema.parse(minimalMoment()) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(out)).toEqual(['published']);
  });

  it('② 两面字段名恒等', () => {
    expect([...momentsKeys()].sort()).toEqual(
      [...Object.keys(ShironeMomentsConstructSchema.shape)].sort(),
    );
  });

  it('③ published 收 string 与 Date，缺键仍拒', () => {
    expect(ShironeMomentsWriteSchema.safeParse({ published: '2026-10-30' }).success).toBe(true);
    expect(ShironeMomentsWriteSchema.safeParse(minimalMoment()).success).toBe(true);
    expect(ShironeMomentsWriteSchema.safeParse({}).success).toBe(false);
    expect(ShironeMomentsWriteSchema.safeParse({ published: 20261030 }).success).toBe(false);
  });

  it('⑤ images 是 {src, alt?} **对象数组**（不是字符串数组）', () => {
    expect(
      ShironeMomentsWriteSchema.safeParse({
        ...minimalMoment(),
        images: [{ src: '/images/a.jpg' }],
      }).success,
    ).toBe(true);
    expect(
      ShironeMomentsWriteSchema.safeParse({
        ...minimalMoment(),
        images: [{ src: '/images/a.jpg', alt: '说明' }],
      }).success,
    ).toBe(true);
    // 字符串数组必须被拒 —— 旧记忆错成 image: string[]，若照记忆写就会放行这种坏数据
    expect(
      ShironeMomentsWriteSchema.safeParse({ ...minimalMoment(), images: ['/images/a.jpg'] }).success,
    ).toBe(false);
    // 元素缺 src 也要拒
    expect(
      ShironeMomentsWriteSchema.safeParse({ ...minimalMoment(), images: [{ alt: 'x' }] }).success,
    ).toBe(false);
  });

  it('⑤ 写入口面不把 alt 补成空串（构造面会）', () => {
    const write = ShironeMomentsWriteSchema.parse({
      ...minimalMoment(),
      images: [{ src: '/a.jpg' }],
    }) as unknown as { images: Array<Record<string, unknown>> };
    expect(Object.prototype.hasOwnProperty.call(write.images[0], 'alt')).toBe(false);
    const ctor = ShironeMomentsConstructSchema.parse({
      ...minimalMoment(),
      images: [{ src: '/a.jpg' }],
    }) as unknown as { images: Array<Record<string, unknown>> };
    expect(ctor.images[0]?.['alt']).toBe('');
  });

  it('④ 删键集 == 字段面 − 必填键（恰 6 个）', () => {
    const expected = momentsKeys().filter(
      (k) => !(MOMENTS_REQUIRED_KEYS as readonly string[]).includes(k),
    );
    expect([...MOMENTS_NULL_DELETE_KEYS].sort()).toEqual(expected.sort());
    expect(MOMENTS_NULL_DELETE_KEYS).toHaveLength(6);
  });

  it('④ 删键集每个键都能收到 null', () => {
    for (const key of MOMENTS_NULL_DELETE_KEYS) {
      expect(
        ShironeMomentsWriteSchema.safeParse({ ...minimalMoment(), [key]: null }).success,
        `del key ${key}`,
      ).toBe(true);
    }
  });

  it('④ published 不在删键集内，也收不到 null（必填键不可删）', () => {
    expect(MOMENTS_NULL_DELETE_KEYS as readonly string[]).not.toContain('published');
    expect(ShironeMomentsWriteSchema.safeParse({ published: null }).success).toBe(false);
  });
});

describe('[T5b-1] 集合元数据', () => {
  it('两个子目录名与内容寻址底座的 ContentSubdir 同名同域', () => {
    expect([...SHIRONE_COLLECTION_SUBDIRS]).toEqual(['series', 'moments']);
  });

  it('上游 glob 是 **/*.md ⇒ 仅 .md，无 .mdx（与 posts 不同）', () => {
    expect([...SHIRONE_COLLECTION_EXTENSIONS]).toEqual(['.md']);
  });
});
