/**
 * [Wave-2 补测] common/fs/mizuki-root 单测
 * [覆盖] 「未配置 root → 明确报错」的四种既有口径 + 路径越界异常类型参数化
 * [背景] 本模块收口了原 8 处 root 解析。其中最危险的失败模式是「未配置时静默
 *   用空串 root」——那会让后续 safeJoin 以 process.cwd() 为基准。这些用例把
 *   「必须报错、且错误类型/文案与各模块既有口径一致」钉死。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  MIZUKI_ROOT_MISSING_MESSAGE,
  requireMizukiRoot,
  toMizukiAbs,
  tryToMizukiAbs,
} from '../../../src/common/fs/mizuki-root';

describe('[Wave-2] common/fs/mizuki-root root 解析单源', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-root-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('requireMizukiRoot', () => {
    it('未配置（空串）→ BadRequestException + 通用文案', () => {
      try {
        requireMizukiRoot('');
        throw new Error('应当抛错');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toBe(MIZUKI_ROOT_MISSING_MESSAGE);
      }
    });

    it("missing:'not-found' → NotFoundException（theme 模块既有口径）", () => {
      expect(() => requireMizukiRoot('', { missing: 'not-found' })).toThrow(NotFoundException);
    });

    it('missingMessage 逐字保留调用方文案（backup / theme / site-config 各不相同）', () => {
      const message = 'mizukiRoot 未配置（初始化向导完成后生效）';
      expect(() => requireMizukiRoot('', { missingMessage: message })).toThrow(message);
      expect(() => requireMizukiRoot('', { missing: 'not-found', missingMessage: message })).toThrow(message);
    });

    it('已配置 → 返回 resolve 后的绝对路径', () => {
      expect(requireMizukiRoot(root)).toBe(path.resolve(root));
    });
  });

  describe('toMizukiAbs', () => {
    it('root 内相对路径 → 绝对路径', () => {
      expect(toMizukiAbs(root, 'src/data/diary.ts')).toBe(path.join(root, 'src', 'data', 'diary.ts'));
    });

    it('越界（../）→ ForbiddenException（REST 层 403，六模块既有口径）', () => {
      expect(() => toMizukiAbs(root, '../outside.txt')).toThrow(ForbiddenException);
    });

    it("forbidden:'bad-request' → BadRequestException + 自定义文案（process 口径）", () => {
      try {
        toMizukiAbs(root, '../x', { forbidden: 'bad-request', forbiddenMessage: 'Mizuki 项目根目录非法' });
        throw new Error('应当抛错');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toBe('Mizuki 项目根目录非法');
      }
    });

    it('root 未配置优先于路径校验（先报未配置，不泄露路径判定结果）', () => {
      expect(() => toMizukiAbs('', '../x')).toThrow(BadRequestException);
      expect(() => toMizukiAbs('', '../x', { missing: 'not-found' })).toThrow(NotFoundException);
    });
  });

  describe('tryToMizukiAbs', () => {
    it('合法路径 → 绝对路径', () => {
      expect(tryToMizukiAbs(root, 'a.txt')).toBe(path.join(root, 'a.txt'));
    });

    it('越界 / root 未配置 → null（扫描场景跳过非法条目，不抛错）', () => {
      expect(tryToMizukiAbs(root, '../x')).toBeNull();
      expect(tryToMizukiAbs('', 'a.txt')).toBeNull();
    });
  });
});
