import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ForbiddenPathError,
  safeJoin,
  safeRealJoin,
} from '../../src/common/security/safe-join';

/**
 * P1 §6.1 / §6.2 验收依据：
 * - 攻击用例 ≥8（../、绝对路径、..\、URL 编码、空字节、symlink 逃逸等）全部抛 ForbiddenPathError；
 * - 正常用例 ≥3 全部返回正确绝对路径；
 * - realpath 防护：root 内指向外部的 symlink 穿越被拒，无 symlink 的合法路径放行。
 * 所有用例均在临时目录（os.tmpdir）中操作，不触碰任何真实 Mizuki 目录。
 */
describe('P1 safe-join 路径监狱', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-safejoin-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-outside-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  describe('攻击用例（全部抛 ForbiddenPathError）', () => {
    it('../ 穿越：../outside.txt', () => {
      expect(() => safeJoin(root, '../outside.txt')).toThrow(ForbiddenPathError);
    });

    it('绝对路径注入：root 之外的绝对路径', () => {
      expect(() => safeJoin(root, path.join(outside, 'secret.txt'))).toThrow(ForbiddenPathError);
    });

    it('多层穿越：a/b/../../../../evil', () => {
      expect(() => safeJoin(root, 'a/b/../../../../evil')).toThrow(ForbiddenPathError);
    });

    it('反斜杠逃逸：..\\..\\evil.txt（Windows 风格分隔符）', () => {
      expect(() => safeJoin(root, '..\\..\\evil.txt')).toThrow(ForbiddenPathError);
    });

    it('URL 编码穿越：%2e%2e%2f%2e%2e%2fevil.txt', () => {
      expect(() => safeJoin(root, '%2e%2e%2f%2e%2e%2fevil.txt')).toThrow(ForbiddenPathError);
    });

    it('URL 编码反斜杠：..%5C..%5Cevil.txt', () => {
      expect(() => safeJoin(root, '..%5C..%5Cevil.txt')).toThrow(ForbiddenPathError);
    });

    it('混合穿越：safe/../%2e%2e/evil', () => {
      expect(() => safeJoin(root, 'safe/../%2e%2e/evil')).toThrow(ForbiddenPathError);
    });

    it('空字节注入：a\\0/../../../evil（入口直接拒绝）', () => {
      expect(() => safeJoin(root, 'a\0/../../../evil')).toThrow(ForbiddenPathError);
    });

    it('空字节注入：合法形态文件名中的空字节同样拒绝', () => {
      expect(() => safeJoin(root, 'ok.txt\0')).toThrow(ForbiddenPathError);
    });
  });

  describe('正常用例', () => {
    it('合法相对路径返回正确绝对路径', () => {
      expect(safeJoin(root, 'src/data/diary.ts')).toBe(path.resolve(root, 'src/data/diary.ts'));
    });

    it('root 自身允许（p === root）', () => {
      expect(safeJoin(root, '.')).toBe(path.resolve(root));
    });

    it('嵌套合法子路径（含 ./ 与 .. 抵消）', () => {
      expect(safeJoin(root, 'a/./b/../c')).toBe(path.resolve(root, 'a/c'));
    });

    it('多层合法子路径', () => {
      expect(safeJoin(root, path.join('public', 'images', 'diary'))).toBe(
        path.resolve(root, 'public', 'images', 'diary'),
      );
    });
  });

  describe('safeRealJoin realpath 防护（§6.2）', () => {
    /** Windows 目录链接用 junction（无需管理员/开发者模式），POSIX 用 dir symlink */
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';

    it('symlink 逃逸：root/link → 外部目录，link/x 被拒绝', () => {
      fs.symlinkSync(outside, path.join(root, 'link'), linkType);
      expect(() => safeRealJoin(root, 'link/escape.txt')).toThrow(ForbiddenPathError);
    });

    it('symlink 逃逸（目标已存在）：root/link/escape.txt 已存在仍被拒绝', () => {
      fs.symlinkSync(outside, path.join(root, 'link'), linkType);
      fs.writeFileSync(path.join(outside, 'escape.txt'), 'outside');
      expect(() => safeRealJoin(root, 'link/escape.txt')).toThrow(ForbiddenPathError);
    });

    it('root 内部互指的 symlink 放行', () => {
      const real = path.join(root, 'realdir');
      fs.mkdirSync(real);
      fs.symlinkSync(real, path.join(root, 'alias'), linkType);
      expect(safeRealJoin(root, 'alias/file.txt')).toBe(path.join(root, 'alias', 'file.txt'));
    });

    it('无 symlink 的合法路径放行（存在文件 + 不存在后代）', () => {
      fs.mkdirSync(path.join(root, 'realdir'));
      fs.writeFileSync(path.join(root, 'realdir', 'a.txt'), 'x');
      expect(safeRealJoin(root, 'realdir/a.txt')).toBe(path.join(root, 'realdir', 'a.txt'));
      expect(safeRealJoin(root, 'realdir/new.txt')).toBe(path.join(root, 'realdir', 'new.txt'));
    });

    it('root 自身放行', () => {
      expect(safeRealJoin(root, '.')).toBe(path.resolve(root));
    });

    it('root 内普通目录中不存在多级后代：放行且返回正确绝对路径', () => {
      fs.mkdirSync(path.join(root, 'a'));
      expect(safeRealJoin(root, 'a/b/c.txt')).toBe(path.join(root, 'a', 'b', 'c.txt'));
    });
  });
});
