/**
 * [Wave-2 补测] common/security/url-path 单测
 * [覆盖] 两种口径（reject / skip）、穿越与走私拒绝面、隐藏段开关
 * [背景] 本模块收口了 /site-assets 与 /preview **两处安全关键**的逐段解码。
 *   拒绝面必须逐条钉死：这些用例是「重复实现漂移」不再复发的护栏——
 *   今后任一侧想放宽，都必须先改这里并说明理由。
 */
import { decodePathSegments, isRejectedSegment } from '../../../src/common/security/url-path';

describe('[Wave-2] common/security/url-path 路径段解码', () => {
  describe('正常路径', () => {
    it('多段路径 → 逐段解码（不改变段数与顺序）', () => {
      expect(decodePathSegments('images/albums/a/b.jpg')).toEqual(['images', 'albums', 'a', 'b.jpg']);
    });

    it('百分号编码的合法字符被解码', () => {
      expect(decodePathSegments('a%20b/c.jpg')).toEqual(['a b', 'c.jpg']);
    });

    it('空串（无路径）在 reject 口径下 → null；在 skip 口径下 → 空数组', () => {
      expect(decodePathSegments('')).toBeNull();
      expect(decodePathSegments('', { empty: 'skip' })).toEqual([]);
    });
  });

  describe('空段口径差异（两条既有口径，不得统一）', () => {
    it('reject（/site-assets）：前导/尾随/重复斜杠一律拒绝', () => {
      expect(decodePathSegments('/a.jpg')).toBeNull();
      expect(decodePathSegments('a.jpg/')).toBeNull();
      expect(decodePathSegments('a//b.jpg')).toBeNull();
    });

    it('skip（/preview）：斜杠归一后正常解析', () => {
      expect(decodePathSegments('/a.jpg', { empty: 'skip' })).toEqual(['a.jpg']);
      expect(decodePathSegments('a.jpg/', { empty: 'skip' })).toEqual(['a.jpg']);
      expect(decodePathSegments('a//b.jpg', { empty: 'skip' })).toEqual(['a', 'b.jpg']);
    });
  });

  describe('穿越与走私拒绝面（安全硬约束）', () => {
    it('点段：\'.\' 与 \'..\' 拒绝', () => {
      expect(decodePathSegments('.')).toBeNull();
      expect(decodePathSegments('..')).toBeNull();
      expect(decodePathSegments('a/../b.jpg')).toBeNull();
    });

    it('编码走私：%2e%2e%2f 解码出含分隔符 → 拒绝', () => {
      expect(decodePathSegments('%2e%2e%2f')).toBeNull();
      expect(decodePathSegments('%2e%2e%5c')).toBeNull();
      expect(decodePathSegments('a%2fb.jpg')).toBeNull();
    });

    it('编码走私：%00 空字节 → 拒绝', () => {
      expect(decodePathSegments('a%00b.jpg')).toBeNull();
    });

    it('反斜杠原样出现 → 拒绝（Windows 风格分隔符）', () => {
      expect(decodePathSegments('a\\b.jpg')).toBeNull();
    });

    it('非法百分号序列（%zz）→ 拒绝，不抛错', () => {
      expect(() => decodePathSegments('%zz')).not.toThrow();
      expect(decodePathSegments('%zz')).toBeNull();
    });
  });

  describe('隐藏段开关（口径差异参数化）', () => {
    it('缺省不检查隐藏段（/site-assets 口径）', () => {
      expect(decodePathSegments('.hidden/a.jpg')).toEqual(['.hidden', 'a.jpg']);
    });

    it('rejectHidden:true → 点开头段拒绝（/preview 口径）', () => {
      expect(decodePathSegments('.hidden/a.jpg', { empty: 'skip', rejectHidden: true })).toBeNull();
      expect(decodePathSegments('a/.git/config', { empty: 'skip', rejectHidden: true })).toBeNull();
    });
  });

  describe('isRejectedSegment 谓词（拒绝面单点）', () => {
    it.each([['', true], ['.', true], ['..', true], ['a/b', true], ['a\\b', true], ['a\0b', true], ['ok.jpg', false]])(
      '%s → %s',
      (segment, expected) => {
        expect(isRejectedSegment(segment)).toBe(expected);
      },
    );
  });
});
