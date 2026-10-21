/**
 * [U3-P4c/K-keep] process/task-env-keep — taskEnv「保留既有键」语义（PM 裁定方案 B）
 * [职责] `PUT /admin/process/task-env` body `{ entries: Record<string,string>, keep?: string[] }`
 *   的**合成**（形态校验在 shared 的 `PutTaskEnvBodySchema`，本文件只管语义）：
 *   - `keep` = 要在**不重输值**的前提下保留的既有键；合成 = 先取现有 `config.taskEnv`
 *     中属于 `keep` 的键（值原样保留），再叠加 `entries`（entries 优先）；
 *   - 同键同时出现在 `keep` 与 `entries` → 400（detail.code = 'keep-conflict'）；
 *   - `keep` 含**当前不存在**的键 → 400（detail.code = 'keep-unknown-key'）；
 *   - 合成结果仍过既有三条约束（前缀白名单 / 禁 PATH·HOME·APPDATA·CI / 条数与长度上限）
 *     → 越界 400，零写盘；
 *   - `entries` 与 `keep` 均空/缺省 → 等价清空（既有语义，逐字不变）。
 * [状态] ACTIVE
 *
 * 为什么合成在 server 而不在 shared：shared 只放「纯 schema/纯函数」口径，且 `keep`
 *   的合法性依赖**运行期**的既有表（只有 server 拿得到 `getAppConfig().taskEnv`）。
 *   三条约束仍走 shared 的 `TaskEnvRecordSchema` 单源（零口径复制）。
 *
 * 纪律（继承 K4/I5）：值按 secret 处理——错误 detail 只含**键名**，本文件不记日志、
 *   不把任何值拼进异常文案。
 */
import { BadRequestException } from '@nestjs/common';
import { TaskEnvRecordSchema } from '@mizuki/shared';
import { zodFieldIssues } from '../../common/validation/zod-issues';

/** [K-keep] 语义错误的 detail.code（对外可见、可断言；值/明文一概不进 detail） */
export type TaskEnvKeepErrorCode = 'keep-unknown-key' | 'keep-conflict';

/** 400 + `detail.code`：语义类拒绝（区别于 zod 管道层的 `detail.issues`） */
function keepError(
  code: TaskEnvKeepErrorCode,
  message: string,
  keys: string[],
): BadRequestException {
  return new BadRequestException({ message, detail: { code, keys } });
}

export interface ComposeTaskEnvInput {
  /** 现有 `config.taskEnv`（活取值；只读） */
  existing: Record<string, string>;
  /** 本次显式提交的值（entries 优先） */
  entries: Record<string, string>;
  /** 本次要不重输值保留的既有键 */
  keep?: string[] | undefined;
}

/**
 * [K-keep] 合成最终要落盘的 taskEnv 表（纯函数；失败抛 400 且调用方零写盘）。
 *
 * 校验次序（确定性，先到先拒——两条都命中也只报前一条，避免文案互相稀释）：
 *   ① `keep` 含当前不存在的键 → `keep-unknown-key`；
 *   ② 同键同时出现在 `keep` 与 `entries` → `keep-conflict`；
 *   ③ 合成结果过 `TaskEnvRecordSchema`（三条约束）→ 越界 400（detail.issues 同管道层形态）。
 *
 * `keep` 内重复键按 **Set 去重**（同一键「保留」两次无意义，不视为错误）。
 * 用 `Object.hasOwn` 判定存在性：`'toString' in existing` 会命中原型链，
 * 不能用 `in`（那会让一个不存在的键被当成「可保留」并写入 `undefined`）。
 */
export function composeTaskEnv(input: ComposeTaskEnvInput): Record<string, string> {
  const { existing, entries } = input;
  const keepKeys = [...new Set(input.keep ?? [])];

  const unknown = keepKeys.filter((key) => !Object.hasOwn(existing, key));
  if (unknown.length > 0) {
    throw keepError(
      'keep-unknown-key',
      `keep 含当前不存在的变量名：${unknown.join('、')}（不能保留一个尚未配置的键）`,
      unknown,
    );
  }

  const conflicts = keepKeys.filter((key) => Object.hasOwn(entries, key));
  if (conflicts.length > 0) {
    throw keepError(
      'keep-conflict',
      `keep 与 entries 同时出现同一变量名：${conflicts.join('、')}（保留旧值与重输新值只能选一个）`,
      conflicts,
    );
  }

  const merged: Record<string, string> = {};
  for (const key of keepKeys) {
    const value = existing[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  Object.assign(merged, entries);

  const checked = TaskEnvRecordSchema.safeParse(merged);
  if (!checked.success) {
    throw new BadRequestException({
      message: '任务环境变量校验未通过（保留项与本次提交合成后越界）',
      detail: { issues: zodFieldIssues(checked.error) },
    });
  }
  return checked.data;
}
