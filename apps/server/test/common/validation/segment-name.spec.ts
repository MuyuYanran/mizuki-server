/**
 * [Wave-2 补测] common/validation/segment-name 单测
 * [覆盖] 单段名（slug / 相册名）的穿越最小拒绝面与文案逐字保留
 * [背景] 这是路径穿越的**第一层**纵深防御（其后仍有 safeJoin / safeRealJoin）。
 *   原 3 处同构实现在 post / articles / albums 各自演化；本模块合并后，
 *   拒绝面与「文案不随合并漂移」都需有锚。
 */
import { describe, expect, it } from 'vitest';
import { singleSegmentName } from '../../../src/common/validation/segment-name';

const Slug = singleSegmentName({
  max: 200,
  separatorMessage: 'slug 不得包含路径分隔符',
  invalidMessage: 'slug 非法',
});

describe('[Wave-2] common/validation/segment-name', () => {
  it('合法单段名通过（字母数字、连字符、中文、点号非首尾独立段）', () => {
    for (const value of ['hello-world', 'a1', '中文标题', 'v1.2.3', 'a b']) {
      expect(Slug.safeParse(value).success).toBe(true);
    }
  });

  it('路径分隔符拒绝，且文案为传入原文（逐字保留）', () => {
    for (const value of ['a/b', 'a\\b']) {
      const parsed = Slug.safeParse(value);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toBe('slug 不得包含路径分隔符');
      }
    }
  });

  it("点段拒绝（'.' / '..' / 含 '..' 的任意串），文案为传入原文", () => {
    for (const value of ['.', '..', 'a..b']) {
      const parsed = Slug.safeParse(value);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toBe('slug 非法');
      }
    }
  });

  it('长度边界：min(1) 拒绝空串、max 生效', () => {
    expect(Slug.safeParse('').success).toBe(false);
    expect(Slug.safeParse('a'.repeat(200)).success).toBe(true);
    expect(Slug.safeParse('a'.repeat(201)).success).toBe(false);
  });

  it('非字符串输入拒绝（不静默强转）', () => {
    expect(Slug.safeParse(123).success).toBe(false);
    expect(Slug.safeParse(null).success).toBe(false);
  });

  it('相册名口径：max 100 与独立文案互不影响（同工厂不同参数）', () => {
    const Album = singleSegmentName({
      max: 100,
      separatorMessage: '相册名不得包含路径分隔符',
      invalidMessage: '相册名非法',
    });
    expect(Album.safeParse('a'.repeat(100)).success).toBe(true);
    expect(Album.safeParse('a'.repeat(101)).success).toBe(false);
    const parsed = Album.safeParse('a/b');
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('相册名不得包含路径分隔符');
    }
  });
});
