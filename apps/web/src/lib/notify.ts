/**
 * [重构/Wave-4] lib/notify — 统一的 API 错误提示
 * [职责] 把「ApiError 展示后端 message，其余展示调用方兜底文案」这一模式单源化
 *   （原 7 处逐字重复：AlbumDetailPage / CollectionListPage / AlbumsPage /
 *   ConsolePage / SiteConfigPage / BackupsPage / MediaLibraryPage 各自的
 *   handleError）。
 * [状态] ACTIVE
 *
 * 为什么单源：这是全站错误提示的**唯一出口**。7 份实现意味着「网络错误该说什么」
 * 「后端 message 是否展示」这类产品口径有 7 个可能漂移的点——新增页面时最容易被
 * 复制成第 8 种行为（静默吞错、或把内部错误原文暴露给用户）。
 */
import { ElMessage } from 'element-plus';
import { ApiError } from '../api/http';

/**
 * 提示一次 API 调用失败。
 * @param error 捕获到的异常
 * @param fallback 非 ApiError（网络异常、代码缺陷等）时展示的兜底文案
 */
export function notifyApiError(error: unknown, fallback: string): void {
  ElMessage.error(error instanceof ApiError ? error.message : fallback);
}
