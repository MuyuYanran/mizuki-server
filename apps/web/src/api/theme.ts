/**
 * [U3-P4b/K4] 主题档案端点客户端（theme 模块，ADR-024）
 * [职责] 封装 `GET /admin/theme/status`（只读）与 `POST /admin/theme/capture`
 *   （**唯一写操作**：仅写服务端漂移基线文件，不改主题源码）；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [边界] 后端本批零改动；本文件是 `/admin/theme/**` 的**唯一**请求路径，
 *   页面不得自行 fetch。capture 失败是 500 `InternalError`（写盘异常未捕获），
 *   调用方禁止把它当成功。
 *
 * 类型**从 `@mizuki/shared` 取**（`ThemeStatusViewSchema` 是前后端唯一共享面，
 * `.strict()`），不在前端复制字段面。
 */
import type { ThemeStatusView } from '@mizuki/shared';
import { request } from './http';

export const themeApi = {
  /** 只读快照：身份 / 指纹 / 基线四态 / 漂移三态 / 探针结果 */
  getStatus(): Promise<ThemeStatusView> {
    return request<ThemeStatusView>('GET', '/admin/theme/status');
  },

  /**
   * 捕获基线（重置漂移轴；探针轴正交、不受影响）。
   * 成功返回**最新** `ThemeStatusView`（服务端 `captureBaseline` 直接回 `getStatus()`），
   * 页面据此渲染而非再拼一次请求。
   */
  capture(): Promise<ThemeStatusView> {
    return request<ThemeStatusView>('POST', '/admin/theme/capture');
  },
};
