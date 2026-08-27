import { reactive } from 'vue';

/**
 * [P10a] 认证状态存取（localStorage 持久化 + 响应式）
 * 纪律：refreshToken 只用于 /admin/auth/refresh 调用，绝不附加到普通请求头。
 */

const ACCESS_KEY = 'mizuki.accessToken';
const REFRESH_KEY = 'mizuki.refreshToken';

// ── [ADR-012] /site-assets 通道 cookie 注入（token 送达裁决二选一：cookie） ──

/** 站点资产通道专用 cookie 名（与后端 main.ts SITE_ASSET_COOKIE 一致） */
const SITE_ASSET_COOKIE = 'mizuki_asset_token';

/**
 * 把 access token 同步进 Path=/site-assets 的非 HttpOnly cookie，
 * 使 <img> 标签（媒体库缩略图/相册网格/TipTap 文档内嵌图）无需 header
 * 即可通过通道认证。安全边界（记 ADR-012/报告）：
 *  - token 本已 JS 可达（localStorage），非 HttpOnly 无新增暴露面；
 *  - Path 收紧到 /site-assets，API 请求不携带该 cookie；
 *  - SameSite=Lax + GET 只读静态资产，CSRF 不适用。
 */
function syncAssetCookie(): void {
  const token = authState.accessToken;
  if (token) {
    document.cookie = `${SITE_ASSET_COOKIE}=${encodeURIComponent(token)}; Path=/site-assets; SameSite=Lax`;
  } else {
    document.cookie = `${SITE_ASSET_COOKIE}=; Path=/site-assets; SameSite=Lax; Max-Age=0`;
  }
}

/** 管理员信息（GET /admin/auth/me 响应） */
export interface AdminUser {
  id: string;
  username: string;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AdminUser | null;
}

export const authState = reactive<AuthState>({
  accessToken: localStorage.getItem(ACCESS_KEY),
  refreshToken: localStorage.getItem(REFRESH_KEY),
  user: null,
});

// 模块加载即同步一次（刷新页面后既有 token 直接恢复通道 cookie）
syncAssetCookie();

export function getAccessToken(): string | null {
  return authState.accessToken;
}

export function getRefreshToken(): string | null {
  return authState.refreshToken;
}

export function isLoggedIn(): boolean {
  return authState.accessToken !== null;
}

export function setTokens(accessToken: string, refreshToken: string): void {
  authState.accessToken = accessToken;
  authState.refreshToken = refreshToken;
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  syncAssetCookie();
}

export function setUser(user: AdminUser | null): void {
  authState.user = user;
}

export function clearAuth(): void {
  authState.accessToken = null;
  authState.refreshToken = null;
  authState.user = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  syncAssetCookie();
}
