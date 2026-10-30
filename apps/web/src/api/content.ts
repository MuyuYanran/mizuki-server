/**
 * [T6b] Shirone 内容集合（series / moments）端点客户端
 *
 * [职责] 封装 `/admin/content/:kind` 的五个端点；复用 src/api/http.ts 的 401 自动 refresh。
 *
 * [类型从 `@mizuki/shared` 取] 不做前端复制：`ShironeSeriesWriteSchema` /
 * `ShironeMomentsWriteSchema` 是前后端唯一共享面（写入口面 schema）。
 * 前端表单据此渲染字段，避免与后端校验面劈叉 —— 这正是 ADR-028 §21.2 那条
 * 「构造面 ≠ 写入口面」规律的延伸：**面板必须对着写入口面建表单**，
 * 否则会出现「面板能填、后端拒收」或「面板补了默认值、文件被污染」两个方向的错。
 *
 * [错误语义] 与后端两轴一致，前端**不重写判定**，只按状态码分流呈现：
 *   - 404 ⇒ 当前主题没有这个集合（该提示「换主题」，不是「改配置」）；
 *   - 403 ⇒ 内容源落点被拒（该提示「改 shirone.content.json」）；
 *   - 400 ⇒ 字段校验失败（表单逐项标红）。
 */
import type { ShironeCollectionSubdir } from '@mizuki/shared';
import { request } from './http';

/** 单个内容项（与后端 `ContentItemView` 同形） */
export interface ContentItem {
  slug: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

/** 写操作的附加元信息（面板据此提示「需要跑一次内容同步」） */
export interface ContentWriteMeta {
  /** 落点是否在内容仓（true ⇒ 必须跑一次内容同步才在主题里生效） */
  needsSync: boolean;
  /** 是否跳过了 pre_write 备份（双根化后恒 false；保留字段以兼容契约） */
  backupSkipped: boolean;
}

/** 列表响应（含落点元信息） */
export interface ContentListResult {
  items: ContentItem[];
  needsSync: boolean;
  inContentRepo: boolean;
  /** 读的是只读回退根（git 源的工作副本）⇒ 页面展示只读横幅 */
  readOnly: boolean;
}

export interface ContentListParams {
  kind: ShironeCollectionSubdir;
}

export interface ContentCreateBody {
  slug: string;
  frontmatter: Record<string, unknown>;
  content?: string;
}

export interface ContentUpdateBody {
  frontmatter?: Record<string, unknown>;
  content?: string;
}

export const contentApi = {
  /** 列表（扁平扫描；series 与 moments 共用同一实现，仅 kind 不同） */
  list({ kind }: ContentListParams): Promise<ContentListResult> {
    return request<ContentListResult>('GET', `/admin/content/${kind}`);
  },

  /** 读单个 */
  get(kind: ShironeCollectionSubdir, slug: string): Promise<ContentItem> {
    return request<ContentItem>('GET', `/admin/content/${kind}/${encodeURIComponent(slug)}`);
  },

  /** 创建 */
  create(
    kind: ShironeCollectionSubdir,
    body: ContentCreateBody,
  ): Promise<ContentItem & ContentWriteMeta> {
    return request<ContentItem & ContentWriteMeta>('POST', `/admin/content/${kind}`, body);
  },

  /** 修改（frontmatter 增量合并 / 正文） */
  update(
    kind: ShironeCollectionSubdir,
    slug: string,
    body: ContentUpdateBody,
  ): Promise<ContentItem & ContentWriteMeta> {
    return request<ContentItem & ContentWriteMeta>(
      'PATCH',
      `/admin/content/${kind}/${encodeURIComponent(slug)}`,
      body,
    );
  },

  /** 删除（先备份，可经备份恢复） */
  remove(
    kind: ShironeCollectionSubdir,
    slug: string,
  ): Promise<{ deleted: true; backupIds: string[]; needsSync: boolean; backupSkipped: boolean }> {
    return request('DELETE', `/admin/content/${kind}/${encodeURIComponent(slug)}`);
  },
};
