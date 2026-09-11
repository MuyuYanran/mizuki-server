/**
 * [重构/Wave-1] common/fs/posix — 路径分隔符归一的「两种语义」
 * [职责] 把「文件系统派生路径」与「用户输入路径」的 POSIX 归一分派为两个
 *   具名函数，防止二者被误当作同一个工具互相替换。
 * [状态] ACTIVE
 *
 * 为什么必须分开（原 3 处实现混用，属真实风险）：
 *   - 文件系统派生路径（path.relative / path.join 产物）：只应转换**本平台**
 *     分隔符。在 POSIX 上，反斜杠是文件名的合法字符——若用「\\ → /」转换，
 *     会把一个名为 `a\b.md` 的真实文件路径改写成两级目录，静默指向错误位置；
 *   - 用户输入路径（frontmatter 的 image、面板回填值）：用户可能在任意平台
 *     书写，'\\' 与 '/' 都应视为分隔符，方能归一为 manifest / 事件里统一的
 *     POSIX 形态。
 * 两者语义不同，故不提供「一个通用 toPosix」。
 */
import path from 'node:path';

/** 文件系统派生路径 → POSIX（仅转换本平台分隔符；POSIX 上为恒等变换） */
export function toPosixPath(p: string): string {
  return path.sep === '/' ? p : p.split(path.sep).join('/');
}

/** 用户输入路径 → POSIX（'\\' 与 '/' 均视为分隔符） */
export function normalizeUserPath(p: string): string {
  return p.split('\\').join('/');
}
