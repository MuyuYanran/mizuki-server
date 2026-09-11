/**
 * [Wave-2 补测] common/fs/atomic-write 单测
 * [覆盖] 原子写语义 + ensureDir + tmpPrefix + 失败清理 + 无残留
 * [背景] 本模块收口了原 9 处 temp+rename 实现；原实现失败时会遗留 .tmp-* 残留，
 *   新实现承诺清理——该承诺必须有测试锚，否则下次重构会静默丢失。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicReplace, atomicWriteFile, removeQuietly, tempPathFor } from '../../../src/common/fs/atomic-write';

describe('[Wave-2] common/fs/atomic-write 原子写单源', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 同目录下不得残留任何临时产物 */
  function expectNoTempResidue(targetDir: string): void {
    const residue = fs.readdirSync(targetDir).filter((name) => name.startsWith('.tmp-') || name.startsWith('.restore-'));
    expect(residue).toEqual([]);
  }

  it('写入新文件：内容正确且同目录无临时残留', () => {
    const target = path.join(dir, 'a.txt');
    atomicWriteFile(target, 'hello');
    expect(fs.readFileSync(target, 'utf8')).toBe('hello');
    expectNoTempResidue(dir);
  });

  it('覆盖既有文件：内容整体替换（非追加、非截断残留）', () => {
    const target = path.join(dir, 'b.txt');
    fs.writeFileSync(target, 'x'.repeat(100), 'utf8');
    atomicWriteFile(target, 'short');
    expect(fs.readFileSync(target, 'utf8')).toBe('short');
    expectNoTempResidue(dir);
  });

  it('Buffer 写入：按原始字节落盘（图片/二进制路径）', () => {
    const target = path.join(dir, 'c.bin');
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    atomicWriteFile(target, payload);
    expect(fs.readFileSync(target).equals(payload)).toBe(true);
    expectNoTempResidue(dir);
  });

  it('ensureDir:true → 目标父目录不存在时自动创建；缺省 false → 不创建（保持各调用点既有语义）', () => {
    const nested = path.join(dir, 'deep', 'nested', 'd.txt');
    expect(() => atomicWriteFile(nested, 'x')).toThrow();
    expect(fs.existsSync(path.dirname(nested))).toBe(false);

    atomicWriteFile(nested, 'x', { ensureDir: true });
    expect(fs.readFileSync(nested, 'utf8')).toBe('x');
    expectNoTempResidue(path.dirname(nested));
  });

  it('tmpPrefix 生效：backup 恢复路径用 .restore- 前缀，成功后同样无残留', () => {
    const target = path.join(dir, 'e.txt');
    const tmp = tempPathFor(target, '.restore-');
    expect(path.basename(tmp).startsWith('.restore-')).toBe(true);

    fs.writeFileSync(tmp, 'restored', 'utf8');
    atomicReplace(tmp, target);
    expect(fs.readFileSync(target, 'utf8')).toBe('restored');
    expectNoTempResidue(dir);
  });

  it('写入失败（父目录缺失）→ 不遗留临时文件（失败清理承诺）', () => {
    const target = path.join(dir, 'missing-dir', 'f.txt');
    expect(() => atomicWriteFile(target, 'x')).toThrow();
    // 目标父目录本身不存在 → 无残留可查；断言根目录未被污染
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('removeQuietly：存在则删、不存在或非法路径均不抛错（尽力而为语义）', () => {
    const file = path.join(dir, 'g.txt');
    fs.writeFileSync(file, 'x', 'utf8');
    expect(() => removeQuietly(file)).not.toThrow();
    expect(fs.existsSync(file)).toBe(false);
    expect(() => removeQuietly(file)).not.toThrow();
    expect(() => removeQuietly(path.join(dir, 'no-such', 'x'))).not.toThrow();
  });
});
