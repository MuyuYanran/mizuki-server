/**
 * [P10d] albums 端点客户端（相册 CRUD 与图片管理）
 * [职责] 封装 /admin/albums 的 GET/POST/PATCH/DELETE 与图片上传/删除；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [状态] ACTIVE
 *
 * 后端契约（P7 albums.controller，只读引用）：
 * - GET /admin/albums → AlbumView[]（name/info/images）；
 * - POST /admin/albums（body { name, info }）→ 201 AlbumView；
 * - PATCH /admin/albums/:id（info 增量）→ AlbumView；
 * - DELETE /admin/albums/:id → { deleted };
 * - POST /admin/albums/:id/images（multipart file）→ 201 { name, path }（非 JPG 自动转 JPG）；
 * - DELETE /admin/albums/:id/images/:name → { deleted }。
 *
 * 引用明细格式与 media 相同（detail.references），复用 media.ts 的提取函数。
 */
import { request } from './http';
import { extractMediaReferences, type MediaReference } from './media';

/** info.json 字段（REQUIREMENTS §6.9 逐字） */
export interface AlbumInfo {
  title: string;
  description?: string;
  date?: string;
  location?: string;
  tags?: string[];
  layout?: string;
  columns?: number;
}

/** 相册视图（与后端 AlbumView 对齐） */
export interface AlbumView {
  name: string;
  info: AlbumInfo;
  images: string[];
}

/** 创建 body */
export interface CreateAlbumBody {
  name: string;
  info: AlbumInfo;
}

/** 图片上传响应 */
export interface UploadAlbumImageResult {
  name: string;
  path: string;
}

export const albumsApi = {
  list(): Promise<AlbumView[]> {
    return request<AlbumView[]>('GET', '/admin/albums');
  },

  create(body: CreateAlbumBody): Promise<AlbumView> {
    return request<AlbumView>('POST', '/admin/albums', body);
  },

  update(name: string, patch: Partial<AlbumInfo>): Promise<AlbumView> {
    return request<AlbumView>('PATCH', `/admin/albums/${encodeURIComponent(name)}`, patch);
  },

  remove(name: string): Promise<{ deleted: true }> {
    return request<{ deleted: true }>('DELETE', `/admin/albums/${encodeURIComponent(name)}`);
  },

  uploadImage(name: string, file: File): Promise<UploadAlbumImageResult> {
    const form = new FormData();
    form.append('file', file);
    return request<UploadAlbumImageResult>(
      'POST',
      `/admin/albums/${encodeURIComponent(name)}/images`,
      form,
    );
  },

  deleteImage(name: string, imageName: string): Promise<{ deleted: true }> {
    return request<{ deleted: true }>(
      'DELETE',
      `/admin/albums/${encodeURIComponent(name)}/images/${encodeURIComponent(imageName)}`,
    );
  },
};

export { extractMediaReferences, type MediaReference };
