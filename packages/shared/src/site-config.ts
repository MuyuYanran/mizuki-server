/**
 * [Phase3-C7] 站点配置受控子集 schema（override 批，ADR-020）
 * [受控子集] siteConfig.lang（语言，siteLangSchema 口径——F 拆分后 config 域 [-_]
 *   双兼容，C7 疑问① 收官落地）+ commentConfig（评论配置，决议 1），
 *   其余 config.ts 字段零纳入（禁蔓延）。commentConfig 字段面以主题类型定义
 *   （Mizuki src/types/config.ts 的 CommentConfig/TwikooConfig/GiscusConfig，
 *   对齐基线源）为准：零删减零改名；全部 .strict()——越界键显式 400，禁静默剥除。
 * [敏感键] commentConfig 无真 secret 性质键（值烘进公开 dist：giscus repo/repoId
 *   等系公开性质，twikoo envId 为公开服务地址；Twikoo 管理凭据存其自建数据库
 *   而非 config.ts）——脱敏义务不触发（T1.1 盘点结论，ADR-020）。
 * [注记] commentConfig 的 twikoo.lang/giscus.lang 为普通字符串（主题自身约定
 *   取 SITE_LANG 形如 'zh_CN' 下划线形），不套用语言代码口径（posts 连字符 /
 *   config 双兼容两域拆分见 lang-code.ts）——该口径仅适用于 siteConfig.lang。
 * [状态] ACTIVE
 */
import { z } from 'zod';
// [Phase3-F] lang 校验口径切换 siteLangSchema（config 域 [-_] 双兼容，C7 疑问① 收官落地）；
// 载体形态 / 合并 / 持久化机制冻结，仅口径切换。
import { siteLangSchema } from './lang-code';
// [Phase4-D3] nav 受控子集（#8，对象数组域扩展，ADR-020 追加节）
import { NavConfigSchema } from './nav-config';

/** Twikoo 子配置（主题类型：envId 必填，region/lang 可选） */
export const TwikooConfigSchema = z
  .object({
    /** 自部署 Twikoo 服务地址（公开性质；官方演示地址禁生产用为文档级约定） */
    envId: z.string(),
    region: z.string().optional(),
    lang: z.string().optional(),
  })
  .strict();

/** Giscus 子配置（12 个字符串字段全部必填，giscus.app 配置页自动生成） */
export const GiscusConfigSchema = z
  .object({
    repo: z.string(),
    repoId: z.string(),
    category: z.string(),
    categoryId: z.string(),
    mapping: z.string(),
    strict: z.string(),
    reactionsEnabled: z.string(),
    emitMetadata: z.string(),
    inputPosition: z.string(),
    theme: z.string(),
    lang: z.string(),
    loading: z.string(),
  })
  .strict();

/** 评论配置（CommentConfig 字段面对齐：enable 必填，system/twikoo/giscus 可选） */
export const CommentConfigSchema = z
  .object({
    enable: z.boolean(),
    system: z.enum(['twikoo', 'giscus']).optional(),
    twikoo: TwikooConfigSchema.optional(),
    giscus: GiscusConfigSchema.optional(),
  })
  .strict();

// ── [U3-P1] 配置域一期：站点信息档（siteConfig 15 非-lang 键） / 个人资料 / 公告 ──
// 字段面与可选性逐字对齐主题类型源（Mizuki src/types/config.ts 的 SiteConfig /
// ProfileConfig / AnnouncementConfig）：零删减、零改名、零自创键；只加值域约束
// （URL 尾斜杠、日期形、枚举、整数区间）。全部 .strict()——越界键显式 400。
// 明确不受管（schema 与 splice 一概不碰）：siteConfig 的 lang（既有端点独占）与
// keywords/bangumi/bilibili/anime/showCoverInContent/generateOgImages/favicon/
// showLastModified/pageProgressBar/thirdPartyAnalytics（A-GAP-11，后批）。

/** themeColor：色相 + 固定色（K7 全必填） */
export const SiteThemeColorSchema = z
  .object({
    hue: z.number().int().min(0).max(360),
    fixed: z.boolean(),
  })
  .strict();

/** featurePages：8 个功能页开关全必填（类型源逐键对齐） */
export const SiteFeaturePagesSchema = z
  .object({
    anime: z.boolean(),
    diary: z.boolean(),
    friends: z.boolean(),
    projects: z.boolean(),
    skills: z.boolean(),
    timeline: z.boolean(),
    albums: z.boolean(),
    devices: z.boolean(),
  })
  .strict();

/** navbarTitle：文字/图标或 logo 两种形态（mode 与 icon/logo 均可选） */
export const SiteNavbarTitleSchema = z
  .object({
    mode: z.enum(['text-icon', 'logo']).optional(),
    text: z.string(),
    icon: z.string().optional(),
    logo: z.string().optional(),
  })
  .strict();

/** pageScaling：整体缩放（enable 必填） */
export const SitePageScalingSchema = z
  .object({
    enable: z.boolean(),
    targetWidth: z.number().optional(),
  })
  .strict();

/** postListLayout：默认布局 + 切换开关 + 分类栏（categoryBar 一层嵌套） */
export const SitePostListLayoutSchema = z
  .object({
    defaultMode: z.enum(['list', 'grid']),
    allowSwitch: z.boolean(),
    categoryBar: z
      .object({
        enable: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** tagStyle：新标签样式开关（唯一键可选） */
export const SiteTagStyleSchema = z
  .object({
    useNewStyle: z.boolean().optional(),
  })
  .strict();

/** wallpaperMode：壁纸形态 + 移动端模式切换器可见域 */
export const SiteWallpaperModeSchema = z
  .object({
    defaultMode: z.enum(['banner', 'fullscreen', 'none']),
    showModeSwitchOnMobile: z.enum(['off', 'mobile', 'desktop', 'both']).optional(),
  })
  .strict();

/** banner.src 三形态：单串 / 串数组 / 桌面-移动分档对象（K7 逐字） */
export const SiteBannerSrcSchema = z.union([
  z.string(),
  z.array(z.string()),
  z
    .object({
      desktop: z.union([z.string(), z.array(z.string())]).optional(),
      mobile: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .strict(),
]);

/** banner：轮播图配置（credit 必填，其余子键可选；对齐类型源 L141-182） */
export const SiteBannerSchema = z
  .object({
    src: SiteBannerSrcSchema,
    position: z.enum(['top', 'center', 'bottom']).optional(),
    carousel: z
      .object({
        enable: z.boolean(),
        interval: z.number(),
      })
      .strict()
      .optional(),
    waves: z
      .object({
        enable: z.boolean(),
        performanceMode: z.boolean().optional(),
        mobileDisable: z.boolean().optional(),
      })
      .strict()
      .optional(),
    imageApi: z
      .object({
        enable: z.boolean(),
        url: z.string(),
      })
      .strict()
      .optional(),
    homeText: z
      .object({
        enable: z.boolean(),
        title: z.string().optional(),
        subtitle: z.union([z.string(), z.array(z.string())]).optional(),
        typewriter: z
          .object({
            enable: z.boolean(),
            speed: z.number(),
            deleteSpeed: z.number(),
            pauseTime: z.number(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    credit: z
      .object({
        enable: z.boolean(),
        text: z.string(),
        url: z.string().optional(),
      })
      .strict(),
    navbar: z
      .object({
        transparentMode: z.enum(['semi', 'full', 'semifull']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** 字体档（asciiFont / cjkFont 同构） */
export const SiteFontFamilySchema = z
  .object({
    fontFamily: z.string(),
    fontWeight: z.union([z.string(), z.number()]),
    localFonts: z.array(z.string()),
    enableCompress: z.boolean(),
  })
  .strict();

/** font：ASCII 与 CJK 两档字体 */
export const SiteFontSchema = z
  .object({
    asciiFont: SiteFontFamilySchema,
    cjkFont: SiteFontFamilySchema,
  })
  .strict();

/** toc：目录开关组（depth 值域 1~3；以 number+int+min/max 落地，见报告偏差节） */
export const SiteTocSchema = z
  .object({
    enable: z.boolean(),
    mobileTop: z.boolean(),
    desktopSidebar: z.boolean(),
    floating: z.boolean(),
    depth: z.number().int().min(1).max(3),
    useJapaneseBadge: z.boolean().optional(),
  })
  .strict();

/**
 * 站点信息档：siteConfig 的 15 个受管键（lang 归既有端独占，不在此档）。
 * 可选性逐字对齐主题类型：siteStartDate / navbarTitle / pageScaling / tagStyle /
 * wallpaperMode 为可选（主题缺该键时面板可整键不送 → 物化器不新增），其余 10 键必填。
 */
export const SiteInfoSchema = z
  .object({
    title: z.string().min(1),
    subtitle: z.string(),
    siteURL: z.string().regex(/^https?:\/\/.+\/$/),
    siteStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    timeZone: z.number().int().min(-12).max(12),
    themeColor: SiteThemeColorSchema,
    featurePages: SiteFeaturePagesSchema,
    navbarTitle: SiteNavbarTitleSchema.optional(),
    postListLayout: SitePostListLayoutSchema,
    tagStyle: SiteTagStyleSchema.optional(),
    wallpaperMode: SiteWallpaperModeSchema.optional(),
    banner: SiteBannerSchema,
    pageScaling: SitePageScalingSchema.optional(),
    font: SiteFontSchema,
    toc: SiteTocSchema,
  })
  .strict();

/**
 * 站点信息档键序（K2 物化逐属性置换顺序 + 面板/探针单源）。
 * 数组序 = schema 定义序（zod shape 保 insertion order），禁手工重排。
 */
export const SITE_INFO_KEYS = Object.keys(SiteInfoSchema.shape) as (keyof SiteInfoValues)[];

/**
 * 探针视图（ADR-024 门禁用，**禁用于写路径**）：15 键全可选 + 宽松键面
 * （默认 strip 模式，非 strict）——真实 siteConfig 声明含 20+ 非受管键，
 * 整体值过 SiteInfoSchema（.strict() 15 键子集）恒失败，故探针单独取一个
 * 同字段面、全可选、允许额外键的视图。
 */
const SITE_INFO_PROBE_SHAPE: Record<string, z.ZodType> = {};
for (const [key, type] of Object.entries(SiteInfoSchema.shape)) {
  SITE_INFO_PROBE_SHAPE[key] = type.optional();
}
export const SiteInfoProbeSchema = z.object(SITE_INFO_PROBE_SHAPE);

/** 个人资料档（ProfileConfig 逐字对齐：name 必填，links 必填数组，[] 合法清空） */
export const ProfileConfigSchema = z
  .object({
    avatar: z.string().optional(),
    name: z.string(),
    bio: z.string().optional(),
    links: z.array(
      z
        .object({
          name: z.string(),
          url: z.string(),
          icon: z.string(),
        })
        .strict(),
    ),
    typewriter: z
      .object({
        enable: z.boolean(),
        speed: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** 公告档（AnnouncementConfig 逐字对齐：content 必填非空，link 一层嵌套） */
export const AnnouncementConfigSchema = z
  .object({
    title: z.string().optional(),
    content: z.string().min(1),
    icon: z.string().optional(),
    type: z.enum(['info', 'warning', 'success', 'error']).optional(),
    closable: z.boolean().optional(),
    link: z
      .object({
        enable: z.boolean(),
        text: z.string(),
        url: z.string(),
        external: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * PUT /admin/config/lang 请求体。
 * 四格语义：键缺失 / 空串 → 归一缺省（清除 override，不落键）；
 * 非法（内嵌空白/超长/越界键）→ 400；合法（'en' / 'zh_CN' / 'zh-Hans'，F 起
 * 下划线形双兼容）→ 物化进 config.ts + 侧车。
 */
export const PutLangBodySchema = z.object({ lang: siteLangSchema() }).strict();

/** override 侧车文件 schema（持久化载体，Server 自管读写） */
export const ConfigOverrideFileSchema = z
  .object({
    version: z.literal(1),
    /** siteConfig 受控键 override 态（缺键 = 未设置 = 基线生效；lang 口径同 PUT，F 起 [-_] 双兼容） */
    siteConfig: z
      .object({
        lang: siteLangSchema(),
      })
      .strict()
      .optional(),
    commentConfig: CommentConfigSchema.optional(),
    /** nav 受控键 override 态（Phase4-D3；缺键 = 未设置 = 基线生效；空数组 = 合法清空导航） */
    nav: NavConfigSchema.optional(),
    /** [U3-P1] 站点信息档 override 态（缺键 = 未设置 = 基线生效；无整档清除端点，见 ADR-020 追加节） */
    siteInfo: SiteInfoSchema.partial().optional(),
    /** [U3-P1] 个人资料档 override 态（缺键 = 未设置 = 基线生效） */
    profile: ProfileConfigSchema.optional(),
    /** [U3-P1] 公告档 override 态（缺键 = 未设置 = 基线生效） */
    announcement: AnnouncementConfigSchema.optional(),
    /** 被置换原文本留档（键 = 受控定位符，值 = config.ts 原初始化器文本，用于还原） */
    originals: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type CommentConfigValue = z.infer<typeof CommentConfigSchema>;
export type ConfigOverrideFile = z.infer<typeof ConfigOverrideFileSchema>;
/** [U3-P1] 站点信息档值（15 键） */
export type SiteInfoValues = z.infer<typeof SiteInfoSchema>;
/** [U3-P1] 个人资料档值 */
export type ProfileConfigValue = z.infer<typeof ProfileConfigSchema>;
/** [U3-P1] 公告档值 */
export type AnnouncementConfigValue = z.infer<typeof AnnouncementConfigSchema>;
