import { reactive } from 'vue';

/**
 * [P10a] 认证状态存取（localStorage 持久化 + 响应式）
 * 纪律：refreshToken 只用于 /admin/auth/refresh 调用，绝不附加到普通请求头。
 */

const ACCESS_KEY = 'mizuki.accessToken';
const REFRESH_KEY = 'mizuki.refreshToken';

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
}
