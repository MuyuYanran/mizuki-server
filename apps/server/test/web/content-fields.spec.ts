/**
 * [T6b] 前端字段表 ↔ 后端写入口面 schema **一致性**单测
 *
 * [为什么放在 server 测试套件里]
 *   一致性是**跨包**的（前端字段表 vs shared 的写入口面 schema）。
 *   而本仓的测试运行器只有服务端 vitest（`apps/server/vitest.config.ts` 的 include 是
 *   `test/**`），`apps/web` 没有测试运行器。故把这条跨包一致性测试放在这里 ——
 *   它能真的跑起来，而不是写一个永远不会被执行的 spec。
 *
 * [为什么必须有这一层]
 *   面板表单是**手写字段表**（为了中文标签、下拉、图片行编辑器这些通用生成器给不了的东西）。
 *   手写就有漂移风险：后端加了字段而面板没跟上 ⇒ 用户永远填不到；
 *   后端删了字段而面板还在提交 ⇒ 每次保存都被 `.loose()` 静默吞掉（用户以为存上了）。
 *   ⇒ 用单测把「字段名集合必须**恰好相等**」钉死，两个方向的漂移都会红。
 *
 * [为什么测的是**写入口面**而非构造面]
 *   构造面带 `.default()`；若面板照它建表单，用户没填的字段也会被提交，
 *   把默认值**物化进用户文件**（ADR-028 §21.2 那类污染）。故只认写入口面。
 */
import { describe, expect, it } from 'vitest';
import {
  MOMENTS_REQUIRED_KEYS,
  SERIES_REQUIRED_KEYS,
  ShironeMomentsWriteSchema,
  ShironeSeriesWriteSchema,
} from '@mizuki/shared';
import {
  COLLECTION_DESCRIPTIONS,
  COLLECTION_TITLES,
  MOMENTS_FIELDS,
  SERIES_FIELDS,
  fieldsOf,
} from '../../../web/src/lib/content-fields';

const writeKeys = (schema: { shape: Record<string, unknown> }): string[] =>
  Object.keys(schema.shape).sort();

describe('[T6b] 前端字段表 ↔ 后端写入口面 schema', () => {
  it('① series 字段名集合与写入口面**恰好相等**（两个方向的漂移都会红）', () => {
    const fieldKeys = SERIES_FIELDS.map((f) => f.key).sort();
    expect(fieldKeys).toEqual(writeKeys(ShironeSeriesWriteSchema));
  });

  it('① moments 字段名集合与写入口面**恰好相等**', () => {
    const fieldKeys = MOMENTS_FIELDS.map((f) => f.key).sort();
    expect(fieldKeys).toEqual(writeKeys(ShironeMomentsWriteSchema));
  });

  it('② 必填标记与后端必填键集一致（漏标必填 ⇒ 用户提交后才被拒）', () => {
    expect(SERIES_FIELDS.filter((f) => f.required).map((f) => f.key).sort()).toEqual(
      [...SERIES_REQUIRED_KEYS].sort(),
    );
    expect(MOMENTS_FIELDS.filter((f) => f.required).map((f) => f.key).sort()).toEqual(
      [...MOMENTS_REQUIRED_KEYS].sort(),
    );
  });

  it('③ 无重复字段（重复会让表单渲染两遍、提交时后者覆盖前者）', () => {
    for (const [label, fields] of [
      ['series', SERIES_FIELDS],
      ['moments', MOMENTS_FIELDS],
    ] as const) {
      const keys = fields.map((f) => f.key);
      expect(new Set(keys).size, label).toBe(keys.length);
    }
  });

  it('③ 每个字段都有非空中文标签，且不得与键名相同', () => {
    for (const field of [...SERIES_FIELDS, ...MOMENTS_FIELDS]) {
      expect(field.label.length, field.key).toBeGreaterThan(0);
      expect(field.label, field.key).not.toBe(field.key);
    }
  });

  it('③ select 字段必须给出候选项（否则渲染成空下拉，用户无从选择）', () => {
    for (const field of [...SERIES_FIELDS, ...MOMENTS_FIELDS]) {
      if (field.kind !== 'select') continue;
      expect(field.options, field.key).toBeDefined();
      expect((field.options ?? []).length, field.key).toBeGreaterThan(0);
    }
  });

  it('③ series.status 的候选项与后端 enum 逐字一致（ongoing / completed）', () => {
    const status = SERIES_FIELDS.find((f) => f.key === 'status');
    expect(status).toBeDefined();
    expect((status?.options ?? []).map((o) => o.value).sort()).toEqual(['completed', 'ongoing']);
  });

  it('④ fieldsOf 按集合正确分派，且集合名/说明齐备', () => {
    expect(fieldsOf('series')).toBe(SERIES_FIELDS);
    expect(fieldsOf('moments')).toBe(MOMENTS_FIELDS);
    expect(COLLECTION_TITLES.series).toBe('系列');
    expect(COLLECTION_TITLES.moments).toBe('动态');
    expect(COLLECTION_DESCRIPTIONS.series.length).toBeGreaterThan(0);
    expect(COLLECTION_DESCRIPTIONS.moments.length).toBeGreaterThan(0);
  });

  it('⑤ moments.images 用对象数组控件（后端要 {src, alt?} 结构，纯文本控件表达不了）', () => {
    expect(MOMENTS_FIELDS.find((f) => f.key === 'images')?.kind).toBe('images');
  });

  it('⑤ moments.published 用日期控件（写入口面收 string | Date）', () => {
    expect(MOMENTS_FIELDS.find((f) => f.key === 'published')?.kind).toBe('date');
  });
});
