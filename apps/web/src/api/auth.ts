/**
 * [P10a] Auth 端点客户端（路径常量集中管理，组件禁止裸写 URL）
 */
import { request } from './http';
import type { AdminUser } from '../stores/auth';

/** POST /admin/auth/login 响应 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const PATHS = {
  login: '/admin/auth/login',
  refresh: '/admin/auth/refresh',
  logout: '/admin/auth/logout',
  me: '/admin/auth/me',
} as const;

export const authApi = {
  login(username: string, password: string): Promise<TokenPair> {
    return request<TokenPair>('POST', PATHS.login, { username, password });
  },
  refresh(refreshToken: string): Promise<TokenPair> {
    return request<TokenPair>('POST', PATHS.refresh, { refreshToken });
  },
  logout(): Promise<{ loggedOut: boolean }> {
    return request<{ loggedOut: boolean }>('POST', PATHS.logout);
  },
  me(): Promise<AdminUser> {
    return request<AdminUser>('GET', PATHS.me);
  },
};
