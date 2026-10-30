/**
 * [U4-AI2] AI 请求层：配置读写 / 连通性测试 / 流式对话
 *
 * 三件事：
 * ① `getConfig` / `putConfig` / `ping` 走 `http.ts` 的统一请求层（自动带 Bearer、
 *    401 自动 refresh 并重放一次、错误统一成 `ApiError`）；
 * ② `streamChat` **不走** http.ts：流式语义不同（401 无法"重放一次"——响应体已经
 *    开始写了），所以照 `api/process.ts` 的既有先例用 `fetch` + `getReader` 手工解帧
 *    （EventSource 带不了 Authorization，P9 已踩过）；
 * ③ 帧解析用 shared 的 `parseSseChunk`（纯函数、已单测），本文件不负责任何字符串切分。
 *
 * 纪律：本文件**不拼** baseUrl、不碰 key、不做 provider 协议适配（那是服务端的事）。
 */
import { AI_SSE, parseSseChunk, type AiChatBody, type AiConfigView, type AiPutConfigBody, type AiUsageView } from '@mizuki/shared';
import { API_PREFIX, ApiError, request } from './http';
import { getAccessToken } from '../stores/auth';

/** 连通性测试结果（成功/失败两态，与 server 的 AiPingResult 同形） */
export type AiPingResult =
  | { ok: true; latencyMs: number; viaProxy: boolean; model: string }
  | { ok: false; code: string; latencyMs: number };

/**
 * 失败分类 → 人话（**不得**出现上游 URL 或响应体：服务端已不透传，前端别再自行拼）。
 * 含 `upstream_4xx`：AI1 落地时对指令包列举集合的补充（400/404/429，如模型名不存在）。
 */
export const AI_FAILURE_TEXT: Record<string, string> = {
  upstream_timeout: '上游超时：模型服务在限定时间内没有响应。',
  upstream_401: '上游认证失败：API Key 无效或已过期。',
  upstream_4xx: '上游拒绝了请求：常见原因是模型名不存在，或该模型无权限。',
  upstream_5xx: '上游服务异常：模型服务端错误，稍后重试。',
  network: '连接中断：网络不可达，或代理配置有误。',
  blocked_url: '地址被安全策略拒绝：目标指向内网/回环地址，需显式开启「允许私有网络」。',
  no_profile: '没有可用的服务档案：请先在设置页添加并选用一条。',
  ai_disabled: 'AI 功能未启用：请在设置页打开总开关。',
};

/** 分类码 → 展示文案（未知码原样回显，便于排障） */
export function aiFailureText(code: string): string {
  return AI_FAILURE_TEXT[code] ?? `未知错误（${code}）`;
}

export interface AiStreamCallbacks {
  onDelta: (text: string) => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
  onDone: () => void;
  /** `aborted=true` 表示用户主动中止（不是错误，UI 不该弹红条） */
  onError: (error: Error, aborted: boolean) => void;
}

export const aiApi = {
  getConfig(): Promise<AiConfigView> {
    return request<AiConfigView>('GET', '/admin/ai/config');
  },

  /**
   * [U4-AI3/A] 用量台账（窗口内 totals + 按动作聚合 + 最近明细）。
   *
   * `aborted`（用户主动停止 / 断连）**不计入 `successRate` 的分母** ——
   * 该口径由服务端与 `@mizuki/shared` 单点定义，前端不重算。
   */
  getUsage(days?: number): Promise<AiUsageView> {
    const query = days === undefined ? '' : `?days=${String(days)}`;
    return request<AiUsageView>('GET', `/admin/ai/usage${query}`);
  },

  putConfig(body: AiPutConfigBody): Promise<AiConfigView> {
    return request<AiConfigView>('PUT', '/admin/ai/config', body);
  },

  ping(): Promise<AiPingResult> {
    return request<AiPingResult>('POST', '/admin/ai/ping');
  },

  /**
   * 流式对话。返回退订函数（组件卸载/切换页面时调用）。
   *
   * 关键行为：
   * - 首帧前失败（服务端首字节前错误）→ 服务端回 JSON 错误体，这里转成 `ApiError` 后
   *   交给 `onError`；
   * - 首字节后失败 → 服务端发 `event: error` 帧，这里解析出 code 并给 `onError`；
   * - 用户 `abort()` → `onError(err, true)`，**不再**向上抛（与 process.ts 的既有做法一致）。
   */
  streamChat(body: AiChatBody, callbacks: AiStreamCallbacks): () => void {
    const controller = new AbortController();
    const token = getAccessToken();
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    };
    if (token !== null && token !== '') {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let finished = false;
    const finish = (): boolean => {
      if (finished) return false;
      finished = true;
      return true;
    };

    fetch(`${API_PREFIX}/admin/ai/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then(async (res) => {
        // 首字节前失败：服务端走的是全局异常过滤器 → JSON 错误体（不是 SSE）
        if (!res.ok) {
          let code = `HTTP_${res.status}`;
          let message = `请求失败（${res.status}）`;
          let detail: unknown = null;
          try {
            const parsed: unknown = await res.json();
            if (typeof parsed === 'object' && parsed !== null) {
              const obj = parsed as Record<string, unknown>;
              if (typeof obj['code'] === 'string') code = obj['code'];
              if (typeof obj['message'] === 'string') message = obj['message'];
              detail = obj['detail'] ?? null;
            }
          } catch {
            // 非 JSON 错误体：保留默认文案
          }
          // detail.code 更精确（例如 upstream_401 在 detail 里）
          const detailCode =
            typeof detail === 'object' && detail !== null && typeof (detail as Record<string, unknown>)['code'] === 'string'
              ? ((detail as Record<string, unknown>)['code'] as string)
              : '';
          const err = new ApiError(res.status, detailCode !== '' ? detailCode : code, message, detail);
          if (finish()) callbacks.onError(err, false);
          return;
        }
        if (res.body === null) {
          if (finish()) callbacks.onError(new Error('响应体为空'), false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let sawDone = false;

        // 串行 pump：保证帧顺序（并发 read 会乱序）
        const pump = async (): Promise<void> => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value !== undefined) {
              buffer += decoder.decode(value, { stream: true });
            }
            const parsed = parseSseChunk(buffer);
            buffer = parsed.rest;
            for (const frame of parsed.frames) {
              if (frame.event === AI_SSE.delta) {
                const text = readTextField(frame.data);
                if (text !== '') callbacks.onDelta(text);
              } else if (frame.event === AI_SSE.usage) {
                const usage = readUsageField(frame.data);
                if (usage !== null) callbacks.onUsage?.(usage);
              } else if (frame.event === AI_SSE.done) {
                sawDone = true;
                if (finish()) callbacks.onDone();
                await reader.cancel().catch(() => undefined);
                return;
              } else if (frame.event === AI_SSE.error) {
                const code = readCodeField(frame.data);
                if (finish()) callbacks.onError(new Error(aiFailureText(code)), false);
                await reader.cancel().catch(() => undefined);
                return;
              }
              // 未知事件名：忽略（向前兼容服务端加帧）
            }
          }
          // 上游 EOF 没发 done：按"未正常结束"处理，不谎报成功
          if (!sawDone && finish()) {
            callbacks.onError(new Error('连接提前结束（未收到 done 帧）'), false);
          }
        };

        await pump();
      })
      .catch((error: unknown) => {
        const aborted = controller.signal.aborted;
        if (finish()) {
          callbacks.onError(error instanceof Error ? error : new Error(String(error)), aborted);
        }
      });

    return () => controller.abort();
  },
};

/** 从 delta 帧的 data 取 `text`（解析失败或缺失 → 空串，忽略该帧） */
function readTextField(data: string): string {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null) {
      const text = (parsed as Record<string, unknown>)['text'];
      if (typeof text === 'string') return text;
    }
  } catch {
    // 非 JSON：忽略
  }
  return '';
}

/** 从 usage 帧取 token 计数 */
function readUsageField(data: string): { promptTokens: number; completionTokens: number } | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const prompt = obj['promptTokens'];
      const completion = obj['completionTokens'];
      return {
        promptTokens: typeof prompt === 'number' ? prompt : 0,
        completionTokens: typeof completion === 'number' ? completion : 0,
      };
    }
  } catch {
    // 非 JSON：忽略
  }
  return null;
}

/** 从 error 帧取分类码（缺失 → `unknown`） */
function readCodeField(data: string): string {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null) {
      const code = (parsed as Record<string, unknown>)['code'];
      if (typeof code === 'string' && code !== '') return code;
    }
  } catch {
    // 非 JSON：忽略
  }
  return 'unknown';
}
