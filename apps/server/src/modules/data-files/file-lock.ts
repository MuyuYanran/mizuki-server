/**
 * [阶段 P3] data-files/file-lock — 每文件异步互斥
 * [职责] 维护 Map<path, Promise> 链：同一文件的操作串行执行，
 *   不同文件互不阻塞（MASTER-PLAN §6.4「并发控制」）。
 * [状态] ACTIVE
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class FileLock {
  /** key → 队尾 promise（后到者链接在其后） */
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * 对同一 key 串行执行 fn：fn 等待前一个同 key 操作完成后才开始；
   * 前序操作的成败不影响后续（错误已被吞掉，链不断裂）。
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // 队尾登记：无论成败都完成，链不断裂
    const tail = run.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await run;
    } finally {
      void tail.then(() => {
        if (this.tails.get(key) === tail) {
          this.tails.delete(key);
        }
      });
    }
  }
}
