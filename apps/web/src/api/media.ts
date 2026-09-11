/**
 * [P10d] media 端点客户端（媒体上传与索引）
 * [职责] 封装 GET/DELETE /admin/media、POST /admin/media（multipart）；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [状态] ACTIVE
 *
 * 后端契约（P7 media.controller，只读引用）：
 * - GET /admin/media → MediaInfo[]（新→旧）；
 * - POST /admin/media（multipart file）→ MediaInfo（魔数/大小/重编码校验）；
 * - DELETE /admin/media/:id → { deleted, path }；409 时 detail.references 含引用明细。
 */
import { request } from './http';

/** 媒体记录（与后端 MediaInfo 对齐） */
export interface MediaInfo {
  id: string;
  path: string;
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  createdAt: string;
}

/** 删除响应 */
export interface DeleteMediaResult {
  deleted: true;
  path: string;
}

/**
 * 媒体引用明细（409 时 detail.references 元素）。
 * ⚠️ 与 `@mizuki/shared` 的 `MediaReference`（注册表契约）**不是同一个类型**：
 *   注册表契约含 `mediaPath`（被引用的媒体相对路径，供删除检查比对），
 *   而 409 响应**有意不下发** mediaPath（删除请求方已知目标路径，无需回显，
 *   避免额外暴露站点目录结构）。故此处独立声明两字段摘要类型，
 *   不要合并到 shared——那会迫使服务端回显路径或前端伪造字段。
 */
export interface MediaReferenceSummary {
  refType: string;
  targetLabel: string;
}

/** @deprecated 旧名保留别名（语义同 MediaReferenceSummary） */
export type MediaReference = MediaReferenceSummary;

/** 从 ApiError.detail.references 提取引用明细（非该形状返回空） */
export function extractMediaReferences(detail: unknown): MediaReference[] {
  if (typeof detail !== 'object' || detail === null) {
    return [];
  }
  const refs = (detail as { references?: unknown }).references;
  if (!Array.isArray(refs)) {
    return [];
  }
  return refs
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      refType: typeof r['refType'] === 'string' ? r['refType'] : '',
      targetLabel: typeof r['targetLabel'] === 'string' ? r['targetLabel'] : '',
    }));
}

export const mediaApi = {
  list(): Promise<MediaInfo[]> {
    return request<MediaInfo[]>('GET', '/admin/media');
  },

  upload(file: File): Promise<MediaInfo> {
    const form = new FormData();
    form.append('file', file);
    return request<MediaInfo>('POST', '/admin/media', form);
  },

  remove(id: string): Promise<DeleteMediaResult> {
    return request<DeleteMediaResult>('DELETE', `/admin/media/${encodeURIComponent(id)}`);
  },
};
