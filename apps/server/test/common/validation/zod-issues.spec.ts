/**
 * [Wave-2 补测] common/validation/zod-issues 单测
 * [覆盖] zod 失败 → 400 + detail.issues 的前端契约形状
 * [背景] 前端 SchemaForm / serverErrors 依赖 `detail.issues[].path`（点号拼接）与
 *   `.message` 两个键名。本模块收口了原 5 处实现——这些用例把该契约钉死，
 *   任一处改动导致形状漂移会立刻失败，而不是让前端提示静默失效。
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseOrBadRequest, safeParseIssues, zodFieldIssues } from '../../../src/common/validation/zod-issues';

describe('[Wave-2] common/validation/zod-issues', () => {
  const Schema = z.object({
    title: z.string().min(1, '标题必填'),
    nested: z.object({ years: z.number().int() }),
  });

  describe('parseOrBadRequest', () => {
    it('成功 → 返回解析值（含默认值填充）', () => {
      const withDefault = z.object({ a: z.string().default('x') });
      expect(parseOrBadRequest(withDefault, {}, '校验失败')).toEqual({ a: 'x' });
    });

    it('失败 → BadRequestException，detail.issues 为 {path,message}[] 且 path 点号拼接', () => {
      let caught: unknown;
      try {
        parseOrBadRequest(Schema, { title: '', nested: { years: 'x' } }, '请求体校验失败');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as {
        message: string;
        detail: { issues: { path: string; message: string }[] };
      };
      expect(response.message).toBe('请求体校验失败');
      expect(response.detail.issues).toEqual(
        expect.arrayContaining([
          { path: 'title', message: '标题必填' },
          { path: 'nested.years', message: expect.any(String) },
        ]),
      );
    });

    it('顶层 message 由调用方提供并逐字保留（各入口文案不同）', () => {
      try {
        parseOrBadRequest(z.string(), 1, '集合条目校验失败（diary）');
      } catch (error) {
        expect((error as BadRequestException).message).toBe('集合条目校验失败（diary）');
      }
    });
  });

  describe('safeParseIssues', () => {
    it('成功 → { ok: true, data }', () => {
      const result = safeParseIssues(Schema, { title: 't', nested: { years: 1 } });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ title: 't', nested: { years: 1 } });
      }
    });

    it('失败 → { ok: false, issues }（不抛错，供管线自行决定处置）', () => {
      const result = safeParseIssues(Schema, {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['title', 'nested']));
      }
    });
  });

  describe('zodFieldIssues', () => {
    it('数组元素索引进入 path（不可丢段）', () => {
      const parsed = z.array(z.string()).safeParse(['ok', 1]);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(zodFieldIssues(parsed.error)[0]?.path).toBe('1');
      }
    });

    it('根级失败 → path 为空串（前端按顶层错误处置）', () => {
      const parsed = z.string().safeParse(1);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(zodFieldIssues(parsed.error)[0]?.path).toBe('');
      }
    });
  });
});
