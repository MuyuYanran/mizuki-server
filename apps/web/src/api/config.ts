/**
 * [Phase3-C7] 站点配置端点客户端（受控子集：siteConfig.lang + commentConfig，ADR-020）
 * [职责] GET /admin/config 整体读（override 优先 + 基线对照）；
 *   PUT /admin/config/lang、PUT /admin/config/comments 分立写；
 *   [U3-P1] PUT /admin/config/site-info、/profile、/announcement 三档（整档覆盖）；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [边界] 仅受控子集；其余 config.ts 字段不在管理面（.strict() 兜底禁蔓延）。
 *   三档均无逐键/清除端点（K1 裁剪）。
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
  /** [Phase4-D3] nav：override 存在 → override 值（空数组 = 清空导航合法态）；否则基线；均不可得 → null */
  nav: { links: unknown[] } | null;
  /** [Phase4-D3] 基线 nav 解析值（真实主题含 LinkPreset 标识符 → null，降级分支） */
  baselineNav: { links: unknown[] } | null;
  /** [U3-P2/K5] navBarConfig 初始化器原文（解析成败均给；声明缺失 → null） */
  baselineNavRaw: string | null;
  /** [U3-P1] 站点信息档：override 优先，逐键回落到基线；声明形态不符 → null */
  siteInfo: Record<string, unknown> | null;
  /** [U3-P1] 基线 siteInfo 逐键解析值（未支持字面量键省略）；不可得 → null */
  baselineSiteInfo: Record<string, unknown> | null;
  /** [U3-P1] 个人资料档：override 优先，否则基线；均不可得 → null */
  profile: Record<string, unknown> | null;
  /** [U3-P1] 基线个人资料档（整档求值） */
  baselineProfile: Record<string, unknown> | null;
  /** [U3-P1] 公告档：override 优先，否则基线；均不可得 → null */
  announcement: Record<string, unknown> | null;
  /** [U3-P1] 基线公告档（整档求值） */
  baselineAnnouncement: Record<string, unknown> | null;
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

  /** [Phase4-D3] links undefined = 清除还原主题默认；[] = 合法清空导航（破坏性语义） */
  putNav(links: unknown[] | undefined): Promise<SiteConfigView> {
    return request<SiteConfigView>(
      'PUT',
      '/admin/config/nav',
      links === undefined ? {} : { links },
    );
  },

  /** [U3-P1] 站点信息档整档覆盖（15 受管键；可选键缺省 = 服务端零触碰） */
  putSiteInfo(siteInfo: Record<string, unknown>): Promise<SiteConfigView> {
    return request<SiteConfigView>('PUT', '/admin/config/site-info', siteInfo);
  },

  /** [U3-P1] 个人资料档整档覆盖（links: [] = 合法清空） */
  putProfile(profile: Record<string, unknown>): Promise<SiteConfigView> {
    return request<SiteConfigView>('PUT', '/admin/config/profile', profile);
  },

  /** [U3-P1] 公告档整档覆盖（content 非空必填） */
  putAnnouncement(announcement: Record<string, unknown>): Promise<SiteConfigView> {
    return request<SiteConfigView>('PUT', '/admin/config/announcement', announcement);
  },
};
