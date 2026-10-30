/**
 * [U4-AI3/A] shared/ai-usage — AI 用量台账契约单源
 *
 * [职责] 定义「一次 AI 调用的用量记录」与「用量统计视图」的形态，供三处共用：
 *   ① 服务端写入（`modules/ai/ai-usage.service.ts`）；
 *   ② 服务端查询/聚合端点（`GET /admin/ai/usage`）；
 *   ③ 前端用量面板（**只消费**本文件的 schema 与常量）。
 *
 * [为什么放 L0 而不是服务端私有]
 *   与 `shared/ai.ts` 同一理由：前后端要渲染同一份统计，字段名与口径必须只有一处。
 *   前端不该自己定义「什么算失败」——那是业务判定，不是展示细节。
 *
 * [三条口径决定，逐条都有理由]
 *
 * ① **`aborted` 与 `error` 分开，不算失败**：
 *    用户主动点停止、或客户端断连（换页/关标签），都不是服务故障。
 *    若把它们计入错误率，统计会随用户操作习惯失真（活跃用户看起来「错误率更高」）。
 *    故 `ok` / `error` / `aborted` 三态，且 `successRate` 的分母只含 `ok + error`。
 *
 * ② **token 可空，null ≠ 0**：
 *    上游不保证每个响应都给 usage（尤其流式被中断时）。拿不到时写 `null`（未知），
 *    **不写 0** —— 0 表示「确实零消耗」，两者对求平均、算费用的意义完全不同。
 *    聚合时也会把「有 token 的调用数」单独暴露，让调用方知道样本量。
 *
 * ③ **错误只存结构化码，不存上游原文**：
 *    上游错误体可能含内部 URL、key 片段（`ai-chat.service.ts` 的 ping 特意不读错误 body
 *    就是同一考虑）。故 `errorCode` 是枚举化短码。
 *
 * 纪律：本文件只放常量、schema 与纯函数，不引入任何 IO。
 */
import { z } from 'zod';
import { AI_ACTIONS } from './ai';

/** 调用场景（`chat` = 流式聊天；`ping` = 连通性测试） */
export const AI_USAGE_SCENES = ['chat', 'ping'] as const;
export type AiUsageScene = (typeof AI_USAGE_SCENES)[number];

/**
 * 调用结果三态。
 * ⚠ `aborted` **不是**失败（用户主动停止 / 客户端断连），见文件头 ①。
 */
export const AI_USAGE_STATUSES = ['ok', 'error', 'aborted'] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

/** 台账保留上限（行数）。超出后按时间清理最旧行，见 `ai-usage.service.ts` */
export const AI_USAGE_KEEP = 5000;

/** 查询窗口的默认与上限（天）—— 防止一次查询扫全表 */
export const AI_USAGE_WINDOW_DEFAULT_DAYS = 7;
export const AI_USAGE_WINDOW_MAX_DAYS = 365;

/** 单次查询返回的最大明细行数（列表分页上限） */
export const AI_USAGE_PAGE_MAX = 200;

/** 写入载荷（服务端内部构造，不经 HTTP；此处定义用于类型与单测） */
export const AiUsageRecordSchema = z.strictObject({
  scene: z.enum(AI_USAGE_SCENES),
  action: z.enum(AI_ACTIONS).nullable(),
  profileId: z.string().nullable(),
  model: z.string().nullable(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(AI_USAGE_STATUSES),
  errorCode: z.string().nullable(),
});
export type AiUsageRecord = z.infer<typeof AiUsageRecordSchema>;

/** 对外明细行（含 id 与时间；时间用 ISO 字符串，前端无需处理时间戳） */
export const AiUsageRowSchema = AiUsageRecordSchema.extend({
  id: z.string(),
  createdAt: z.string(),
});
export type AiUsageRow = z.infer<typeof AiUsageRowSchema>;

/** 按动作分组的聚合行 */
export const AiUsageByActionSchema = z.strictObject({
  /** 动作名；自由聊天/ping 归入 `null` */
  action: z.enum(AI_ACTIONS).nullable(),
  /** 该动作的调用次数（含失败与中止） */
  calls: z.number().int().nonnegative(),
  okCalls: z.number().int().nonnegative(),
  errorCalls: z.number().int().nonnegative(),
  abortedCalls: z.number().int().nonnegative(),
  /** 有 token 记录的调用数（样本量；见文件头 ②） */
  tokenSamples: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  /** 平均耗时（毫秒，全部调用） */
  avgDurationMs: z.number().int().nonnegative(),
});
export type AiUsageByAction = z.infer<typeof AiUsageByActionSchema>;

/** 总计行 */
export const AiUsageTotalsSchema = z.strictObject({
  calls: z.number().int().nonnegative(),
  okCalls: z.number().int().nonnegative(),
  errorCalls: z.number().int().nonnegative(),
  abortedCalls: z.number().int().nonnegative(),
  tokenSamples: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  avgDurationMs: z.number().int().nonnegative(),
  /**
   * 成功率（%）。**分母只含 `ok + error`**（排除 aborted，见文件头 ①）；
   * 分母为 0（窗口内只有 aborted 或无调用）时为 null，而不是 0 或 100
   * ——「没有样本」与「成功率为零」是两件事。
   */
  successRate: z.number().nullable(),
});
export type AiUsageTotals = z.infer<typeof AiUsageTotalsSchema>;

/** 查询响应 */
export const AiUsageViewSchema = z.strictObject({
  /** 窗口天数（回显实际生效值） */
  windowDays: z.number().int().positive(),
  totals: AiUsageTotalsSchema,
  byAction: z.array(AiUsageByActionSchema),
  /** 明细（按时间倒序，最多 AI_USAGE_PAGE_MAX 行） */
  recent: z.array(AiUsageRowSchema),
  /** 台账总行数（用于提示「已达保留上限，更早记录已滚动清理」） */
  retainedRows: z.number().int().nonnegative(),
  /** 保留上限（前端据此判断是否触发过滚动清理） */
  keepLimit: z.number().int().positive(),
});
export type AiUsageView = z.infer<typeof AiUsageViewSchema>;

/** 查询参数（GET query；天数与非负整数） */
export const AiUsageQuerySchema = z.strictObject({
  days: z.coerce
    .number()
    .int()
    .positive()
    .max(AI_USAGE_WINDOW_MAX_DAYS)
    .optional(),
});
export type AiUsageQuery = z.infer<typeof AiUsageQuerySchema>;

/**
 * 计算成功率（%）。纯函数，两端共用同一口径。
 *
 * @returns 分母为 0 时 null（无样本 ≠ 成功率 0）
 */
export function computeSuccessRate(
  okCalls: number,
  errorCalls: number,
): number | null {
  const denominator = okCalls + errorCalls;
  if (denominator === 0) return null;
  // 保留一位小数，避免浮点长尾影响展示
  return Math.round((okCalls / denominator) * 1000) / 10;
}
