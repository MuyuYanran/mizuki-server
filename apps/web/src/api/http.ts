/**
 * [P10a] 统一请求层（硬性规格 §3.5）
 * - 所有请求自动附 `Authorization: Bearer <accessToken>`；
 * - 401 → 自动 `POST /admin/auth/refresh` 换新 Token 对并**重放原请求一次**；
 * - 并发 401 只触发一次 refresh（进行中的刷新共享同一 Promise）；
 * - refresh 失败 → 清空本地 token → 触发会话失效回调（重定向 /login）；
 * - 响应适配后端统一异常格式 `{ code, message, detail }`，非 2xx 抛含
 *   message 的 ApiError。
 */
import { clearAuth, getAccessToken, getRefreshToken, setTokens } from '../stores/auth';

/** 统一 API 前缀（与后端全局前缀一致，MASTER-PLAN §1） */
export const API_PREFIX = '/api/v1';

/** 后端统一异常格式对应的错误类型 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;

  constructor(status: number, code: string, message: string, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** 会话失效回调（由 main.ts 注册 → 路由跳转 /login） */
let sessionExpiredHandler: (() => void) | null = null;

export function onSessionExpired(handler: () => void): void {
  sessionExpiredHandler = handler;
}

/** 不参与自动 refresh 的路径（登录/刷新端点自身，避免循环） */
const NO_REFRESH_PATHS = ['/admin/auth/login', '/admin/auth/refresh'];

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function parseJsonBody(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  if (text === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await parseJsonBody(res);
  const code = typeof body?.['code'] === 'string' ? body['code'] : `HTTP_${res.status}`;
  const message = typeof body?.['message'] === 'string' ? body['message'] : `请求失败（${res.status}）`;
  return new ApiError(res.status, code, message, body?.['detail'] ?? null);
}

async function performFetch(method: HttpMethod, path: string, body: unknown, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  const isFormData = body instanceof FormData;
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const bodyData = body === undefined ? undefined : isFormData ? body : JSON.stringify(body);
  return fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body: bodyData,
  });
}

/**
 * 并发去重的 refresh（§3.5 硬性）：首个 401 发起刷新，窗口期内的其他
 * 401 共享同一 Promise；无论成败随后清空引用。
 *
 * [Wave-4/F1] 返回值区分三态而非原布尔值：
 *   - 'ok'       刷新成功 → 重放原请求；
 *   - 'rejected' 服务端明确拒绝（无 refresh token / 非 2xx / 响应形状异常）
 *                → 凭据确实失效，清 token + 触发会话失效跳登录；
 *   - 'network'  请求本身抛错（断网、超时、后端重启瞬间）→ **不得清 token**
 *                ——原实现把任何异常都视为刷新失败并强制登出，弱网下会把
 *                已登录用户误踢回登录页。
 */
type RefreshOutcome = 'ok' | 'rejected' | 'network';

let refreshPromise: Promise<RefreshOutcome> | null = null;

function refreshTokensOnce(): Promise<RefreshOutcome> {
  if (refreshPromise === null) {
    refreshPromise = (async (): Promise<RefreshOutcome> => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        return 'rejected';
      }
      let res: Response;
      try {
        res = await fetch(`${API_PREFIX}/admin/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        return 'network'; // 网络层异常：凭据状态未知，保守按「稍后重试」处理
      }
      if (!res.ok) {
        return 'rejected';
      }
      const body = await parseJsonBody(res);
      const accessToken = body?.['accessToken'];
      const nextRefresh = body?.['refreshToken'];
      if (typeof accessToken !== 'string' || typeof nextRefresh !== 'string') {
        return 'rejected'; // 2xx 但形状异常：无法续期，按拒绝处理（服务端缺陷，日志在服务端）
      }
      setTokens(accessToken, nextRefresh);
      return 'ok';
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** 统一请求入口：业务代码只经此函数与 api 客户端访问后端 */
export async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  let res = await performFetch(method, path, body, getAccessToken());

  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path) && getRefreshToken()) {
    const outcome = await refreshTokensOnce();
    if (outcome === 'ok') {
      res = await performFetch(method, path, body, getAccessToken());
    } else if (outcome === 'rejected') {
      const error = await toApiError(res);
      clearAuth();
      sessionExpiredHandler?.();
      throw error;
    } else {
      // [Wave-4/F1] 网络异常：保留本地会话，提示可重试（status 0 = 未取得响应）
      throw new ApiError(0, 'NetworkError', '网络异常，无法刷新登录状态，请检查连接后重试', null);
    }
  }

  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (text === '') {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
