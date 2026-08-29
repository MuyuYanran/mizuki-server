/**
 * [P10b] Collections 端点客户端（六类集合 CRUD）
 * [职责] 封装 /admin/collections/:type 的 GET/POST/PATCH/DELETE；
 *   路径常量集中，组件禁止裸写 URL；请求经 http 层（401 自动 refresh 生效）。
 * [状态] ACTIVE
 *
 * 后端契约（P4 collections.controller，只读引用）：
 * - array 形（diary/friends/projects/timeline/skills）：GET → Item[]；
 * - grouped 形（devices）：GET → { [group: string]: DeviceItem[] }；
 * - POST → 201 返回新建条目；grouped 时 body 须含 group 字段；
 * - PATCH /:id → 返回更新后条目；DELETE /:id → { deleted: true }。
 * - 错误格式 { code, message, detail }；zod 校验失败 detail.issues 为
 *   { path, message }[] → 前端按 path 映射到字段提示。
 */
import { request } from './http';

/** 六类集合类型字面量（与后端注册表逐字对齐，路由参数白名单） */
export type CollectionType =
  | 'diary'
  | 'friends'
  | 'projects'
  | 'timeline'
  | 'skills'
  | 'devices'
  | 'anime';

/** 后端校验失败时 detail.issues 的条目形状 */
export interface FieldIssue {
  /** 点分路径，如 "experience.years" 或顶层字段名 */
  path: string;
  message: string;
}

/** 任意集合条目（字段由 schema 驱动，此处只用宽松索引） */
export type CollectionItem = Record<string, unknown>;

/** grouped 形（devices）的列表响应 */
export type GroupedItems = Record<string, CollectionItem[]>;

/**
 * 判断列表响应是否为 grouped（devices）。后端按 shape 返回 array 或
 * record；此处按运行时形状区分，避免在前端硬编码 type→shape 映射。
 */
export function isGrouped(value: unknown): value is GroupedItems {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const values = Object.values(record);
  return values.every((v) => Array.isArray(v));
}

/** 将 ApiError.detail.issues 觕范化为 FieldIssue[]（非该形状时返回空） */
export function extractFieldIssues(detail: unknown): FieldIssue[] {
  if (typeof detail !== 'object' || detail === null) {
    return [];
  }
  const issues = (detail as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues
    .filter((issue): issue is Record<string, unknown> => typeof issue === 'object' && issue !== null)
    .map((issue) => ({
      path: typeof issue['path'] === 'string' ? issue['path'] : String(issue['path'] ?? ''),
      message: typeof issue['message'] === 'string' ? issue['message'] : '字段不合法',
    }));
}

/** 集合端点客户端（路径常量集中，方法与后端 controller 逐字对齐） */
export const collectionsApi = {
  /** GET /admin/collections/:type — array 返回 Item[]；grouped 返回 record */
  list<T = unknown>(type: CollectionType): Promise<T> {
    return request<T>('GET', `/admin/collections/${type}`);
  },

  /** POST /admin/collections/:type — 201 返回新建条目；grouped 时 body 须含 group */
  create<T = CollectionItem>(type: CollectionType, body: unknown): Promise<T> {
    return request<T>('POST', `/admin/collections/${type}`, body);
  },

  /** PATCH /admin/collections/:type/:id — 返回更新后条目 */
  update<T = CollectionItem>(type: CollectionType, id: string, body: unknown): Promise<T> {
    return request<T>('PATCH', `/admin/collections/${type}/${id}`, body);
  },

  /** DELETE /admin/collections/:type/:id — { deleted: true } */
  remove(type: CollectionType, id: string): Promise<{ deleted: true }> {
    return request<{ deleted: true }>('DELETE', `/admin/collections/${type}/${id}`);
  },
};
