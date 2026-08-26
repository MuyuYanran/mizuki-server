/**
 * [P10d] settings 端点客户端（运行态 key-value 设置）
 * [职责] 封装 GET /admin/settings、PUT /admin/settings/:key、DELETE /admin/settings/:key；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [状态] ACTIVE
 *
 * 后端契约（P8 settings.controller，只读引用）：
 * - GET /admin/settings → Record<string, unknown>（value 反序列化为 JSON 值）；
 * - PUT /admin/settings/:key（body { value }）→ { key, value };
 * - DELETE /admin/settings/:key → { deleted: true }。
 *
 * 边界（§3.6）：仅读写 site_setting（运行态配置）；
 * data/config.json（启动配置，如 mizukiRoot）不在此修改——初始化向导已覆盖。
 */
import { request } from './http';

export const settingsApi = {
  getAll(): Promise<Record<string, unknown>> {
    return request<Record<string, unknown>>('GET', '/admin/settings');
  },

  put(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    return request<{ key: string; value: unknown }>(
      'PUT',
      `/admin/settings/${encodeURIComponent(key)}`,
      { value },
    );
  },

  remove(key: string): Promise<{ deleted: true }> {
    return request<{ deleted: true }>('DELETE', `/admin/settings/${encodeURIComponent(key)}`);
  },
};
