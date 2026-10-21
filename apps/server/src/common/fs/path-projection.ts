/**
 * [U3-P4b/DEF-06] common/fs/path-projection — 内部路径的对外投影（单源）
 * [职责] 把服务端内部绝对路径投影为「可放进对外文案」的形态，三条规则按序命中：
 *   ① 位于 `<apps/server>` 根内 → 相对该根的 POSIX 形（如 `data/theme-baseline/baseline.json`、
 *      `data/config-override.json`）；
 *   ② 越出该根、但路径含 `data` 段（自托管把运行时数据目录指到服务根之外）→ **`data/` + 该段之后的结构**
 *      （如 `data/theme-baseline/baseline.json`）——`data` 之后是应用自有的数据布局，对诊断有意义；
 *   ③ 其余越界路径（临时域、挂载点、任意目录）→ `<data>/<basename>` 兜底（无文件名可用时退回 `<data>`）。
 *   **永不**回退到绝对路径：盘符、UNC 前缀、主机目录层级一律不出现在投影里。
 * [为什么必须单源] AGENTS §4-6 是对外文案红线，而同一形态在 theme 基线（loadBaseline
 *   的两处 detail）与 site-config 侧车（readOverride 的两处 Error）各自复制一次就会出现
 *   「一处改了另一处漏」的经典漂移；本文件是唯一实现，调用方只做插值。
 * [纪律] 投影值**只用于文案**；日志（pino）仍记绝对路径（诊断需要），二者不得互换：
 *   把投影值当路径用会指向错误位置，把绝对路径放进 detail 则违反 §4-6。
 * [状态] ACTIVE
 *
 * ②③ 的取舍：`data` 之前的目录层级（用户名、临时目录名、盘符）一律丢弃；保留 `data`
 * 之后的结构是因为「哪一份数据文件坏了」是诊断必需信息，而该结构属于应用自身而非主机。
 */
import path from 'node:path';
import { toPosixPath } from './posix';

/** 服务根（= `<apps/server>`）：本文件在 `<apps/server>/{src,dist}/common/fs`，上溯三级 */
export const SERVER_ROOT = path.resolve(__dirname, '../../..');

/** 无 `data` 段可锚时使用的占位符（形状对齐 `<mizukiRoot>` / `<repo-root>` 的项目惯例） */
const DATA_PLACEHOLDER = '<data>';

/** 运行时数据目录名（`apps/server/data` 约定；越界路径以此段为投影锚） */
const DATA_DIR_NAME = 'data';

/** 纯盘符段（`C:`）：不是可展示的文件名，兜底时丢弃 */
const DRIVE_ONLY = /^[A-Za-z]:$/;

/**
 * 绝对路径 → 对外投影形态（见文件头「三条规则」）。
 * 入参可为相对路径（按 `process.cwd()` 解析后处理），但调用方只应传内部绝对路径。
 */
export function projectInternalPath(absPath: string): string {
  const resolved = path.resolve(absPath);
  const relative = path.relative(SERVER_ROOT, resolved);
  // ① 根内：相对形态（`relative` 已在本平台分隔符下，转 POSIX 供文案使用）
  if (relative === '') {
    return '.';
  }
  const outsideRoot =
    path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`);
  if (!outsideRoot) {
    return toPosixPath(relative);
  }

  const segments = resolved.split(/[\\/]+/).filter((segment) => segment !== '');
  // ② 越界但带 `data` 段：归一到 `data/` 前缀（与根内形态同构，主机层级不外泄）
  const dataIndex = segments.lastIndexOf(DATA_DIR_NAME);
  if (dataIndex >= 0 && dataIndex < segments.length - 1) {
    return [DATA_DIR_NAME, ...segments.slice(dataIndex + 1)].join('/');
  }
  // ③ 其余越界：只留末段文件名（盘符/根路径 → 仅占位符）
  const lastSegment = segments[segments.length - 1];
  return lastSegment === undefined || DRIVE_ONLY.test(lastSegment)
    ? DATA_PLACEHOLDER
    : `${DATA_PLACEHOLDER}/${lastSegment}`;
}
