/**
 * [Phase3-C7] 站点配置端点客户端（受控子集：siteConfig.lang + commentConfig，ADR-020）
 * [职责] GET /admin/config 整体读（override 优先 + 基线对照）；
 *   PUT /admin/config/lang、PUT /admin/config/comments 分立写；
 *   [U3-P1] PUT /admin/config/site-info、/profile、/announcement 三档（整档覆盖）；
 *   [U3-P4c/K14] PUT /admin/config/effects（特效三档：按域提交，域键缺省 = 还原该域主题默认）；
 *   复用 src/api/http.ts 的 401 自动 refresh。
 * [边界] 仅受控子集；其余 config.ts 字段不在管理面（.strict() 兜底禁蔓延）。
 *   三档均无逐键/清除端点（K1 裁剪）。
 */
import { request } from './http';

/**
 * [U3-P4c/K14] 特效三档视图（config.ts **顶层声明** musicPlayerConfig / sakuraConfig /
 * pioConfig）：域值为 `Record<string, unknown>`（域内每字段可选），`null` = 该域既无
 * override 也无基线（声明缺失/形态不符 → 面板只读、不提交该域）。
 * 手写类型双份口径照既有写法（与后端 `AdminSiteConfigView.effects` 同形，只读引用）。
 */
export interface SiteEffectsDomainMap {
  musicPlayer: Record<string, unknown> | null;
  sakura: Record<string, unknown> | null;
  pio: Record<string, unknown> | null;
}

/**
 * [U3-P4b/K1] 物化态逐域快照（`GET /admin/config` 的 additive 字段，与后端
 * `AdminSiteConfigView.overrides` 同形——手写类型双份口径照既有写法）。
 * 只报「有/无」与留档键名，**不回值、不回原文**。
 * 该字段在旧后端 / 缓存响应中**可能缺失** → 消费方必须 fail-open（不渲染任何结论）。
 */
export interface SiteConfigOverrides {
  lang: boolean;
  comments: boolean;
  nav: boolean;
  /** keys = 侧车内提交过的 siteInfo 键（字典序；active 为 true 且 keys 为空 = 空对象接管） */
  siteInfo: { active: boolean; keys: string[] };
  profile: boolean;
  announcement: boolean;
  /** 侧车 originals 的键名（如 siteConfig.lang / navBarConfig，字典序） */
  originalsKeys: string[];
}

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
  /**
   * [U3-P4a/K7] 番剧/B站配置档（siteConfig 的 anime / bangumi / bilibili 三键）。
   * `effective` = 逐域 override 优先、基线回落（域内不做键级 merge——物化是整对象替换，
   * 面板据此全字段回填后整表提交）；`override` = 侧车态（null = 三域均未被面板接管）。
   */
  anime: {
    effective: Record<string, Record<string, unknown>>;
    override: Record<string, Record<string, unknown>> | null;
  };
  /**
   * [U3-P4c/K14] 特效三档：`effects` = 逐域 override 优先、**逐键**回落基线
   * （域内键级 merge——物化是逐属性置换）；`baselineEffects` = 基线逐声明求值。
   * `meting_api` 永不出现（不在任何 schema 内）。
   */
  effects: SiteEffectsDomainMap;
  baselineEffects: SiteEffectsDomainMap;
  /**
   * [U3-P4b/K1] 物化态逐域快照（六域 + originalsKeys）。
   * **可选**：旧后端/缓存响应无此字段 → 页面 fail-open，不猜「已接管/未接管」。
   * 运行期仍需按不可信报文自校验（见 SiteConfigPage 的四格分类）。
   */
  overrides?: SiteConfigOverrides;
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

  /**
   * [U3-P4a/K7] 番剧/B站配置档：三域**按域整对象替换**（域内不做键级 merge）。
   * 缺省域 = 清除该域 override 并还原留档原文本；`{}` = 三域全部还原主题默认。
   */
  putSiteAnime(siteAnime: Record<string, unknown>): Promise<SiteConfigView> {
    return request<SiteConfigView>('PUT', '/admin/config/anime', siteAnime);
  },

  /**
   * [U3-P4c/K14] 特效三档：body = `SiteEffectsSchema`（三域可选、`.strict()`）。
   * - 域键缺省 = 该域清除 override 并还原主题默认（`{}` = 三域全还原）；
   * - 域内有值 = 该域按提交的键逐属性写回（嵌套值整值置换）；
   * - body 含 `meting_api` 一律 400（排除项的机械保证）。
   * 三域须**一起提交**：服务端整档重写 `siteEffects` override，只交一域会丢其它域的记录。
   */
  putEffects(effects: Record<string, Record<string, unknown>>): Promise<SiteConfigView> {
    return request<SiteConfigView>('PUT', '/admin/config/effects', effects);
  },
};
