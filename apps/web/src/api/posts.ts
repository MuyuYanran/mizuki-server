/**
 * [P10c] posts 端点客户端（Markdown 文章 + about 页）
 * [职责] 封装 GET/POST/PATCH/DELETE /admin/posts、cover 上传、sync、about 读写；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [状态] ACTIVE
 */
import { request } from './http';
import { ApiError } from './http';

/** 文章视图（与后端 PostView 对齐） */
export interface PostView {
  slug: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

/** 列表项（listPosts 在 PostView 基础上加 status 派生） */
export interface PostListItem extends PostView {
  status: 'draft' | 'published';
}

/** 创建 body（与后端 CreatePostBodySchema 对齐） */
export interface CreatePostBody {
  slug: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

/** 更新 body（与后端 UpdatePostBodySchema 对齐：frontmatter 增量合并 + content 可选） */
export interface UpdatePostBody {
  frontmatter?: Record<string, unknown>;
  content?: string;
}

/** 删除响应（含 backupIds 供回收站恢复） */
export interface DeletePostResult {
  deleted: true;
  backupIds: string[];
}

/** sync 结果 */
export interface SyncResult {
  scanned: number;
  inserted: number;
  updated: number;
  softDeleted: number;
}

/** 回收站条目（前端 localStorage 跟踪，后端无 list deleted 端点） */
export interface RecycleEntry {
  slug: string;
  title: string;
  backupIds: string[];
  deletedAt: string;
}

export const postsApi = {
  list(): Promise<PostListItem[]> {
    return request<PostListItem[]>('GET', '/admin/posts');
  },

  read(slug: string): Promise<PostView> {
    return request<PostView>('GET', `/admin/posts/${encodeURIComponent(slug)}`);
  },

  create(body: CreatePostBody): Promise<PostView> {
    return request<PostView>('POST', '/admin/posts', body);
  },

  update(slug: string, body: UpdatePostBody): Promise<PostView> {
    return request<PostView>('PATCH', `/admin/posts/${encodeURIComponent(slug)}`, body);
  },

  remove(slug: string): Promise<DeletePostResult> {
    return request<DeletePostResult>('DELETE', `/admin/posts/${encodeURIComponent(slug)}`);
  },

  uploadCover(slug: string, file: File): Promise<PostView> {
    const form = new FormData();
    form.append('file', file);
    return request<PostView>('POST', `/admin/posts/${encodeURIComponent(slug)}/cover`, form);
  },

  sync(): Promise<SyncResult> {
    return request<SyncResult>('POST', '/admin/posts/sync');
  },

  readAbout(): Promise<{ content: string }> {
    return request<{ content: string }>('GET', '/admin/about');
  },

  writeAbout(content: string): Promise<{ content: string }> {
    return request<{ content: string }>('PUT', '/admin/about', { content });
  },
};

// ── 回收站（前端 localStorage 跟踪） ──

const RECYCLE_KEY = 'mizuki.recycle.posts';

function readRecycle(): RecycleEntry[] {
  try {
    const raw = localStorage.getItem(RECYCLE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as RecycleEntry[];
  } catch {
    return [];
  }
}

function writeRecycle(entries: RecycleEntry[]): void {
  localStorage.setItem(RECYCLE_KEY, JSON.stringify(entries));
}

export const recycleStore = {
  list(): RecycleEntry[] {
    return readRecycle();
  },

  add(entry: RecycleEntry): void {
    const entries = readRecycle().filter((e) => e.slug !== entry.slug);
    entries.unshift(entry);
    writeRecycle(entries);
  },

  remove(slug: string): void {
    writeRecycle(readRecycle().filter((e) => e.slug !== slug));
  },
};

/** 备份恢复（POST /admin/backups/:id/restore，需 confirm:true） */
export async function restoreBackup(backupId: string): Promise<{ id: string; restoredFiles: number; safetyBackupId?: string }> {
  return request<{ id: string; restoredFiles: number; safetyBackupId?: string }>(
    'POST',
    `/admin/backups/${encodeURIComponent(backupId)}/restore`,
    { confirm: true },
  );
}

/** 从回收站恢复文章：逐备份恢复 → sync 重建索引 → 清回收站条目 */
export async function restorePost(entry: RecycleEntry): Promise<void> {
  for (const id of entry.backupIds) {
    await restoreBackup(id);
  }
  await postsApi.sync();
  recycleStore.remove(entry.slug);
}

export { ApiError };
