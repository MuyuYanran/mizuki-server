/**
 * [Phase3-C7] 站点配置端点客户端（受控子集：siteConfig.lang + commentConfig，ADR-020）
 * [职责] GET /admin/config 整体读（override 优先 + 基线对照）；
 *   PUT /admin/config/lang、PUT /admin/config/comments 分立写；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [边界] 仅受控子集；其余 config.ts 字段不在管理面（.strict() 兜底禁蔓延）。
 */
import { request } from './http';

/** GET /admin/config 响应视图（与后端 AdminSiteConfigView 同形，只读引用） */
export interface SiteConfigView {
  siteConfig: {
    /** override 态；null = 未设置 override（站点基线生效） */
    lang: string | null;
    /** 基线解析值（标识符代入后；解析失败 → null） */
    baselineLang: string | null;
  };
  /** override 存在 → override 值；否则基线有效值；均不可得 → null */
  commentConfig: Record<string, unknown> | null;
}

export const configApi = {
  getConfig(): Promise<SiteConfigView> {
    return request<SiteConfigView>('GET', '/admin/config');
  },

  /** lang 空串 = 归一缺省（清除 override，不落键） */
  putLang(lang: string): Promise<SiteConfigView> {
    return request<SiteConfigView>('PUT', '/admin/config/lang', { lang });
  },

  putComments(comments: Record<string, unknown>): Promise<SiteConfigView> {
    return request<SiteConfigView>('PUT', '/admin/config/comments', comments);
  },
};
