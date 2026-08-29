/**
 * [Phase3-C4] preview 端点客户端（站点预览票据）
 * [职责] POST /admin/preview-ticket → Set-Cookie(mizuki_preview_jwt) + {port}；
 *   端口一律取票据响应下发值（禁前端硬编码），hostname 由调用方从
 *   window.location.hostname 派生（禁硬编码 127.0.0.1——cookie host 匹配的根修，
 *   面板经 localhost 或 127.0.0.1 访问均成立）。
 * [状态] ACTIVE
 *
 * 后端契约（Phase3-C4 preview.controller，只读引用）：
 * - POST /admin/preview-ticket（管理端认证）→ { port }（201/200 + Set-Cookie）
 */
import { request } from './http';

/** 预览票据响应（端口为 preview 通道实际监听端口，端口 0 注入时为临时端口） */
export interface PreviewTicket {
  port: number;
}

export const previewApi = {
  issueTicket(): Promise<PreviewTicket> {
    // 同源 fetch：响应 Set-Cookie 由浏览器自动落库（host-wide，跨端口共享）
    return request<PreviewTicket>('POST', '/admin/preview-ticket');
  },
};
