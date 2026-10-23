/**
 * [U4-AI1/K5] ai/provider/openai-compatible — 唯一出站适配器（OpenAI 兼容协议）
 * [职责] 把「解析后的目标 + 消息」变成一次 HTTP 请求，并只回**分类后的失败码**：
 *   - 端点拼装：`baseUrl` 去尾斜杠 + `/chat/completions`（已以该后缀结尾时原样用，
 *     避免用户把完整 endpoint 粘进 baseUrl 时出现双重后缀）；
 *   - 代理三态：`none` 直连 / `system` 用 `EnvHttpProxyAgent`（读 `HTTP_PROXY`、
 *     `HTTPS_PROXY`、`NO_PROXY`，大小写都读——Windows 常见大写）/ `custom` 用
 *     `ProxyAgent(url)`；每请求一建一销，避免连接池跨请求泄漏；
 *   - `redirect: 'error'`：**禁跟随跳转**（30x 可把已过闸的公网 URL 引向内网，
 *     禁跟随比逐个校验 Location 更可靠，与 common/net/outbound 的闸配套）；
 *   - 非 200 **不读 body**（可能含 key 片段/内部 URL），只按状态码分类。
 * [状态] ACTIVE
 *
 * 诚实边界：`viaProxy` 只表示「配置要求走代理」（mode !== 'none'）。
 * `system` 模式下 `NO_PROXY` 命中时 undici 会直连，服务端**无法**在不 hook
 * 连接层的情况下知道实际是否经代理——不谎报「已走代理」，只报配置意图。
 */
import type { AiProxy } from '@mizuki/shared';
import {
  EnvHttpProxyAgent,
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
  type Response as UndiciResponse,
} from 'undici';

/** 失败分类（对外只出这些值，绝不透传上游 body / URL） */
export type AiFailureCode =
  | 'upstream_timeout'
  | 'upstream_401'
  | 'upstream_4xx'
  | 'upstream_5xx'
  | 'network'
  | 'blocked_url'
  | 'no_profile';

/**
 * 分类 → 对外文案。注意：`upstream_4xx` 是对 U4-AI1 §4 列举集合的**补充**——
 * 上游 400/404/429 真实存在（例如模型名不存在必 400），把它们谎报成 5xx 会把
 * 排障方向指错；但同样只给分类，不回显上游原文。
 */
export const AI_FAILURE_MESSAGES: Record<AiFailureCode, string> = {
  upstream_timeout: '上游超时',
  upstream_401: '上游认证失败',
  upstream_4xx: '上游请求被拒绝',
  upstream_5xx: '上游服务异常',
  network: '上游连接中断',
  blocked_url: '出站地址被安全策略拒绝',
  no_profile: '未配置可用的 AI 服务档案',
};

/** 上游状态码 → 分类 */
export function classifyUpstreamStatus(status: number): AiFailureCode {
  if (status === 401 || status === 403) {
    return 'upstream_401';
  }
  if (status >= 500) {
    return 'upstream_5xx';
  }
  if (status >= 400) {
    return 'upstream_4xx';
  }
  // 3xx 已被 redirect:'error' 变成异常；2xx 之外的非 4xx/5xx 归到 4xx 语义
  return 'upstream_4xx';
}

/** fetch/读流异常 → 分类（超时 vs 其它网络错误） */
export function classifyFetchError(error: unknown): AiFailureCode {
  const name = error instanceof Error ? error.name : '';
  // AbortSignal.timeout() → TimeoutError；controller.abort() → AbortError。
  // 调用方在「自己超时」的场景传 timedOut=true 走 upstream_timeout（见 chat service）。
  if (name === 'TimeoutError' || name === 'AbortError') {
    return 'upstream_timeout';
  }
  return 'network';
}

/** 单次请求的目标（已由 AiConfigService 解析并过闸） */
export interface ChatTarget {
  baseUrl: string;
  model: string;
  apiKey?: string;
  proxy: AiProxy;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  target: ChatTarget;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature: number;
  stream: boolean;
  signal: AbortSignal;
}

/** 端点拼装（baseUrl 可带/不带版本前缀；已带完整路径时不重复拼） */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

/**
 * 按代理三态建 dispatcher。调用方负责在请求（含流式读完之后）销毁：
 * `await dispatcher?.destroy().catch(() => undefined)`。
 * - `none` → undefined（走 undici 默认全局 dispatcher，等价直连）；
 * - `system` → EnvHttpProxyAgent（每请求新建 = 环境变量活取）；
 * - `custom` → ProxyAgent(url)；url 缺失时由上层（config 校验）拦下，此处兜底直连。
 */
export function createProxyDispatcher(proxy: AiProxy): Dispatcher | undefined {
  if (proxy.mode === 'system') {
    return new EnvHttpProxyAgent();
  }
  if (proxy.mode === 'custom' && proxy.url) {
    return new ProxyAgent(proxy.url);
  }
  return undefined;
}

/**
 * 发一次 chat/completions。**不抛业务异常**：把 fetch 失败统一转成
 * `{ ok: false, code }`，让调用方决定「首字节前 → 异常路径 / 流中 → error 帧」。
 * 上游响应（含非 200）原样返回，但调用方**不得**把非 200 的 body 透传给客户端。
 */
export async function requestChatCompletion(
  options: ChatCompletionOptions,
  dispatcher: Dispatcher | undefined,
): Promise<{ ok: true; response: UndiciResponse } | { ok: false; code: AiFailureCode }> {
  const { target, messages, maxOutputTokens, temperature, stream, signal } = options;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: stream ? 'text/event-stream' : 'application/json',
  };
  if (target.apiKey !== undefined && target.apiKey !== '') {
    headers.authorization = `Bearer ${target.apiKey}`;
  }
  const body = JSON.stringify({
    model: target.model,
    messages,
    stream,
    max_tokens: maxOutputTokens,
    temperature,
    // 流式下请上游在末帧带 usage（支持该字段的 OpenAI 兼容实现会回；
    // 不支持的上游通常忽略未知字段，不影响主流程）
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  });

  try {
    const response = await undiciFetch(resolveChatCompletionsUrl(target.baseUrl), {
      method: 'POST',
      headers,
      body,
      signal,
      // 禁跳转：30x 可绕开 outbound 闸（已过闸的公网 URL → 内网 Location）
      redirect: 'error',
      ...(dispatcher ? { dispatcher } : {}),
    });
    return { ok: true, response };
  } catch (error) {
    return { ok: false, code: classifyFetchError(error) };
  }
}
