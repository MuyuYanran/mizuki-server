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
    /** 被置换原文本留档（键 = 受控定位符，值 = config.ts 原初始化器文本，用于还原） */
    originals: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type CommentConfigValue = z.infer<typeof CommentConfigSchema>;
export type ConfigOverrideFile = z.infer<typeof ConfigOverrideFileSchema>;
