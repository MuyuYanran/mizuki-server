/**
 * [重构/Wave-1] common/fs/atomic-write — 原子写单源实现
 * [职责] 「同目录临时文件 → rename 覆盖」的统一落地（原 9 处重复：data-files 写管线
 *   第 7 步、posts 统一写管线、media 上传落盘、albums info.json 与图片落盘、
 *   site-config 的 config.ts 与 override 侧车、app-config 的 config.json、
 *   theme 基线快照、backup 恢复回写）。
 * [状态] ACTIVE
 *
 * 为什么必须原子：rename 在同一文件系统内为原子操作，读者永远不会看到半写状态；
 * 崩溃只会留下临时文件（不影响目标文件完整性）。
 *
 * 统一收益（除消除重复外）：
 *   - 临时文件名方案单源（原为 nanoid(8) 与 Date.now()+Math.random() 两套并存）；
 *   - 写失败/rename 失败时自动清理临时文件（原实现会静默遗留 .tmp-* 残留）；
 *   - mkdir 语义由 ensureDir 显式声明，而非调用方各自记忆。
 *
 * 纪律：本模块只负责「写」的原子性，不负责备份——所有 Mizuki 目录写入仍须
 *   先经 BackupService.preWriteBackup（统一写管线组成部分）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

export interface AtomicWriteOptions {
  /** 目标父目录不存在时自动递归创建（默认 false，保持各调用点既有行为） */
  ensureDir?: boolean;
  /** 临时文件名前缀（默认 '.tmp-'；backup 恢复用 '.restore-'） */
  tmpPrefix?: string;
}

/** 同目录临时文件路径（调用方自持写入器时使用，如 sharp.toFile / fs.copyFileSync） */
export function tempPathFor(absPath: string, tmpPrefix = '.tmp-'): string {
  return path.join(path.dirname(absPath), `${tmpPrefix}${nanoid(8)}`);
}

/**
 * 原子替换：把已就位的临时文件 rename 到目标。
 * 临时文件恒与目标同目录（tempPathFor 保证），故不可能是跨设备 rename，
 * 失败即视为真实错误——清理临时文件后向上抛出。
 */
export function atomicReplace(tmpPath: string, absPath: string): void {
  try {
    fs.renameSync(tmpPath, absPath);
  } catch (error) {
    removeQuietly(tmpPath);
    throw error;
  }
}

/**
 * 原子写：同目录临时文件写入 → rename 覆盖目标。
 * @param absPath 目标绝对路径（须已由 safeJoin / safeRealJoin 校验）
 * @param data 文本（UTF-8）或二进制
 */
export function atomicWriteFile(
  absPath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  if (options.ensureDir === true) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
  }
  const tmp = tempPathFor(absPath, options.tmpPrefix);
  try {
    if (typeof data === 'string') {
      fs.writeFileSync(tmp, data, 'utf8');
    } else {
      fs.writeFileSync(tmp, data);
    }
  } catch (error) {
    removeQuietly(tmp); // 半写临时文件不得残留
    throw error;
  }
  atomicReplace(tmp, absPath);
}

/** 尽力删除（清理残留临时文件；失败不冒泡——清理属最佳努力语义） */
export function removeQuietly(target: string): void {
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target);
    }
  } catch {
    // 清理失败不影响主流程（临时文件带前缀，可被人工或后续扫描清理）
  }
}
