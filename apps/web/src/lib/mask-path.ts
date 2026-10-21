/**
 * [U3-P4b/K7] 内部磁盘路径遮蔽（展示层投影，**不改后端**）
 * [职责] 把诊断文本里的磁盘绝对路径片段投影成 `…/<最后一段>`：
 *   - `<盘符>:\…`（含 `D:/…` 正斜杠形态）→ `…/<最后一段>`；
 *   - POSIX 绝对路径 `<seg>/<seg>/…/<file>.<ext>` → `…/<最后一段>`。
 * [单源] 全站只此一处实现（页面/组件一律 import 本函数，禁各自复制正则）。
 * [边界] 只做展示投影，不改变后端返回；后端 `theme-registry.service.ts` 与
 *   `site-config.service.ts` 仍在 detail 里拼绝对路径（§1.4-D5 既有偏差，本批不修）。
 *
 * 为什么 POSIX 分支要求「末段含扩展名」：`/api/v1/admin/theme/capture` 这类
 * **接口路径**不是磁盘路径，遮蔽它只会把诊断文字改得不可读（K7 的靶子是
 * `<…>/baseline.json` 形态的数据文件路径）。
 */

/** Windows 盘符绝对路径（`D:\…` / `D:/…`；以空白、引号与常见中英文标点为边界） */
const WINDOWS_ABS_PATH = /[A-Za-z]:[\\/][^\s"'`，。；：、（）()\[\]<>]*/g;

/** POSIX 绝对路径片段：至少两段且**末段含扩展名**（`/…/baseline.json`） */
const POSIX_FILE_PATH =
  /(?<![\w:])\/(?:[^\s"'`，。；：、（）()\[\]<>/]+\/)+[^\s"'`，。；：、（）()\[\]<>/]*\.[A-Za-z0-9]+/g;

/** 取片段最后一段，拼成 `…/<最后一段>`（纯分隔符片段 → `…`） */
function tailOf(fragment: string): string {
  const last = fragment
    .split(/[\\/]+/)
    .filter((segment) => segment !== '')
    .pop();
  return last === undefined ? '…' : `…/${last}`;
}

/**
 * 遮蔽文本中的磁盘绝对路径；其余诊断文字原样保留。
 * `null` / `undefined` / 空串 → 空串（调用方可直接渲染）。
 */
export function maskInternalPaths(text: string | null | undefined): string {
  if (typeof text !== 'string' || text === '') {
    return '';
  }
  return text.replace(WINDOWS_ABS_PATH, tailOf).replace(POSIX_FILE_PATH, tailOf);
}
