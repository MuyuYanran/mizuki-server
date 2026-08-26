/**
 * [P10c] articles 端点客户端（富文本文章管理）
 * [职责] 封装 GET/POST/PATCH/DELETE /admin/articles；复用 http.ts 的 401 自动 refresh。
 * [状态] ACTIVE
 */
import { request, ApiError } from './http';

/** 富文本文章管理视图（与后端 ArticleAdminView 对齐，列表不含 docJson/htmlCache） */
export interface ArticleAdminView {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  cover: string | null;
  summary: string | null;
  categoryId: string | null;
  pinned: boolean;
  pubDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** 仅 read(:id) 返回 */
  docJson?: unknown;
  htmlCache?: string | null;
}

/** 创建 body（与后端 CreateArticleBodySchema 对齐） */
export interface CreateArticleBody {
  title: string;
  docJson: unknown;
  slug?: string;
  status?: 'draft' | 'published';
  cover?: string;
  summary?: string;
  pinned?: boolean;
  pubDate?: string;
  categoryId?: string;
}

/** 更新 body（partial of create） */
export type UpdateArticleBody = Partial<CreateArticleBody>;

export const articlesApi = {
  list(): Promise<ArticleAdminView[]> {
    return request<ArticleAdminView[]>('GET', '/admin/articles');
  },

  read(id: string): Promise<ArticleAdminView> {
    return request<ArticleAdminView>('GET', `/admin/articles/${encodeURIComponent(id)}`);
  },

  create(body: CreateArticleBody): Promise<ArticleAdminView> {
    return request<ArticleAdminView>('POST', '/admin/articles', body);
  },

  update(id: string, body: UpdateArticleBody): Promise<ArticleAdminView> {
    return request<ArticleAdminView>('PATCH', `/admin/articles/${encodeURIComponent(id)}`, body);
  },

  remove(id: string): Promise<{ deleted: true }> {
    return request<{ deleted: true }>('DELETE', `/admin/articles/${encodeURIComponent(id)}`);
  },
};

/** 从后端 detail.issues 提取字段错误（path→message） */
export function extractArticleIssues(detail: unknown): Record<string, string> {
  if (detail === null || typeof detail !== 'object') {
    return {};
  }
  const record = detail as Record<string, unknown>;
  const issues = record['issues'];
  if (!Array.isArray(issues)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) {
      continue;
    }
    const i = issue as Record<string, unknown>;
    const path = typeof i['path'] === 'string' ? i['path'] : '';
    const message = typeof i['message'] === 'string' ? i['message'] : '校验失败';
    if (path !== '') {
      result[path] = message;
    }
  }
  return result;
}

export { ApiError };
