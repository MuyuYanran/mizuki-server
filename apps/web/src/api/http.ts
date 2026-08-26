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
 */
let refreshPromise: Promise<boolean> | null = null;

function refreshTokensOnce(): Promise<boolean> {
  if (refreshPromise === null) {
    refreshPromise = (async (): Promise<boolean> => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        return false;
      }
      try {
        const res = await fetch(`${API_PREFIX}/admin/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          return false;
        }
        const body = await parseJsonBody(res);
        const accessToken = body?.['accessToken'];
        const nextRefresh = body?.['refreshToken'];
        if (typeof accessToken !== 'string' || typeof nextRefresh !== 'string') {
          return false;
        }
        setTokens(accessToken, nextRefresh);
        return true;
      } catch {
        return false;
      }
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
    const refreshed = await refreshTokensOnce();
    if (refreshed) {
      res = await performFetch(method, path, body, getAccessToken());
    } else {
      const error = await toApiError(res);
      clearAuth();
      sessionExpiredHandler?.();
      throw error;
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
