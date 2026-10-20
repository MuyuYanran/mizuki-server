/**
 * [U3-P3/K3] process/log-truncate — 日志文本按 UTF-8 字节保尾截断
 * [职责] task_run.log_text 落盘前的体积闸门：尾部截断保留 ≤256KB。
 * [状态] ACTIVE
 *
 * 为什么按字节而非按字符：DB 存的是 UTF-8 文本，限额以字节计才不会因
 * 多字节字符（中文日志常见）超额写盘。
 *
 * 多字节截缘处理：按字节切可能把一个多字节字符劈成两半，Buffer 层面
 * 解码时该残字节会变成 U+FFFD（替换字符）——这是可接受的降级（不抛错、
 * 不丢整行），注释说明以免后来者误判为编码 bug。
 */

/** log_text 体积上限（256KB，R2-10 规格） */
export const LOG_TEXT_MAX_BYTES = 256 * 1024;

/**
 * 按 UTF-8 字节保尾截断。
 * @param text 原始文本
 * @param maxBytes 字节上限（默认 256KB）
 * @returns 截断后的文本（≤maxBytes 字节；多字节截缘可能含 U+FFFD）
 */
export function truncateLogText(text: string, maxBytes: number = LOG_TEXT_MAX_BYTES): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) {
    return text;
  }
  // 从尾部保留 maxBytes 字节：先切字节再解码
  const buffer = Buffer.from(text, 'utf8');
  const tail = buffer.subarray(buffer.length - maxBytes);
  return tail.toString('utf8');
}
