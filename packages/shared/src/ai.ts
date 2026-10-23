/**
 * [U4-AI1/K1] shared/ai — AI 接入契约单源（前后端唯一共享面）
 * [职责] 把「AI 服务档案 / 代理三态 / 聊天请求 / SSE 事件名 / 限额」的**形态与上限**
 *   放在 L0（packages/shared），使三处消费方共用同一份口径：
 *   ① apps/server/src/config/app-config.ts（AppConfigSchema 内嵌 ai 段，落盘校验）；
 *   ② apps/server/src/modules/ai（配置读写 / ping / 流式代理）；
 *   ③ U4-AI2 前端（设置页与全局右侧聊天栏）——**只消费**本文件的 schema 与常量。
 * [状态] ACTIVE
 *
 * 关键取舍（逐字见 U4-AI1 指令包 §3）：
 * - **baseUrl 不在本文件做 URL 安全校验**：唯一来源是 server 的
 *   `common/net/outbound.ts`（`assertSafeOutboundUrl`）。此处只兜长度与形态，
 *   避免「两处各写一套 SSRF 判定」的漂移（契约注释逐字要求）。
 * - `AiConfigViewSchema` 是**只读视图**，**永不含 key 明文**：只有 `maskedKey`。
 * - `keepApiKey` 与 process/taskEnv 的 `keep` 同语义：省略/true = 保留既有 key，
 *   false = 未带 apiKey 的档案清空 key（前端不必回传掩码串）。
 *
 * 纪律：本文件只放常量、schema 与纯函数（与 shared 其余文件同规），不引入任何 IO。
 */
import { z } from 'zod';

/** 代理三态：直连 / 系统环境变量代理 / 指定代理（PM 裁定，2026-10-22） */
export const AI_PROXY_MODES = ['none', 'system', 'custom'] as const;

/** 5 个写作动作（前端按钮语义；服务端本期不据此改 prompt，只透传给上层组装方） */
export const AI_ACTIONS = ['polish', 'continue', 'summarize', 'meta', 'translate'] as const;

/** 对话角色（OpenAI 兼容协议的三角色；不做 tool/function） */
export const AI_ROLES = ['system', 'user', 'assistant'] as const;

/**
 * 硬上限（单源）：
 * - `maxMessages` / `maxMessageChars` / `maxContextChars` 同时约束 zod schema 与
 *   controller 的入参管道（超限 400，K9）；
 * - `maxProfiles` 约束档案条数（config 落盘与 PUT 请求体共用）；
 * - `maxOutputTokensCap` 是 `max_tokens` 的绝对上限（防一次请求烧穿额度）。
 */
export const AI_LIMITS = {
  maxMessages: 20,
  maxMessageChars: 20_000,
  maxContextChars: 40_000,
  maxProfiles: 8,
  maxOutputTokensCap: 8192,
} as const;

/**
 * 服务档案（用户可自行填 url/key，PM 要求「用户自填」）。
 * `baseUrl` 只做长度校验；URL 安全判定在 server 的 `assertSafeOutboundUrl`（单一来源）。
 */
export const AiProfileSchema = z.strictObject({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(40),
  baseUrl: z.string().min(1).max(2048),
  model: z.string().min(1).max(80),
});

/** 代理配置：`mode='custom'` 时 `url` 必填（该联动由服务层校验，见 ai-config.service） */
export const AiProxySchema = z.strictObject({
  mode: z.enum(AI_PROXY_MODES),
  url: z.string().min(1).max(2048).optional(),
});

/**
 * 只读视图（GET /admin/ai/config 响应）：**永不含 key**。
 * `keySource` 判定顺序：`MIZUKI_AI_API_KEY` > `config.ai.profiles[].apiKey` > `none`；
 * `env` 时所有档案的 `maskedKey` 同值（都来自同一个环境变量）。
 */
export const AiConfigViewSchema = z.strictObject({
  enabled: z.boolean(),
  activeProfileId: z.string().nullable(),
  profiles: z.array(AiProfileSchema.extend({ maskedKey: z.string() })),
  proxy: AiProxySchema,
  allowPrivateNetwork: z.boolean(),
  maxOutputTokens: z.number().int(),
  temperature: z.number(),
  timeoutMs: z.number().int(),
  keySource: z.enum(['none', 'config', 'env']),
});

/**
 * PUT /admin/ai/config 请求体（全部可选 = 部分更新；服务层深合并后整段落盘）。
 * `keepApiKey` 语义见文件头；`apiKey` 省略或空串均视为「未提供」，按 keep 语义处理。
 */
export const AiPutConfigBodySchema = z.strictObject({
  enabled: z.boolean().optional(),
  activeProfileId: z.string().optional(),
  profiles: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(32),
        name: z.string().min(1).max(40),
        baseUrl: z.string().min(1).max(2048),
        model: z.string().min(1).max(80),
        apiKey: z.string().max(4096).optional(),
      }),
    )
    .max(AI_LIMITS.maxProfiles)
    .optional(),
  proxy: AiProxySchema.optional(),
  allowPrivateNetwork: z.boolean().optional(),
  maxOutputTokens: z.number().int().min(1).max(AI_LIMITS.maxOutputTokensCap).optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  /** 省略 = 全部保留既有 key（与 taskEnv.keep 同语义）；true 同义；false = 未带 apiKey 的档案清空 key */
  keepApiKey: z.boolean().optional(),
});

/**
 * POST /admin/ai/chat 请求体。
 * 上下文由**前端**组装（`context.text`），服务端本期零领域依赖、不擅自读文章。
 */
export const AiChatBodySchema = z.strictObject({
  action: z.enum(AI_ACTIONS).optional(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(AI_ROLES),
        content: z.string().min(1).max(AI_LIMITS.maxMessageChars),
      }),
    )
    .min(1)
    .max(AI_LIMITS.maxMessages),
  context: z
    .strictObject({
      kind: z.enum(['none', 'selection', 'article', 'markdown']),
      text: z.string().max(AI_LIMITS.maxContextChars),
    })
    .optional(),
});

/** SSE 事件名（禁字符串字面量；服务端发帧与前端解帧共用） */
export const AI_SSE = { delta: 'delta', usage: 'usage', done: 'done', error: 'error' } as const;

export type AiProxyMode = (typeof AI_PROXY_MODES)[number];
export type AiAction = (typeof AI_ACTIONS)[number];
export type AiRole = (typeof AI_ROLES)[number];
export type AiProfile = z.infer<typeof AiProfileSchema>;
export type AiProxy = z.infer<typeof AiProxySchema>;
export type AiConfigView = z.infer<typeof AiConfigViewSchema>;
export type AiPutConfigBody = z.infer<typeof AiPutConfigBodySchema>;
export type AiChatBody = z.infer<typeof AiChatBodySchema>;
export type AiSseEvent = (typeof AI_SSE)[keyof typeof AI_SSE];
