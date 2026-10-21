/**
 * [Phase3-C7] site-config/site-config.service — 主题 config.ts 受控子集管理（ADR-020）
 * [职责] 受控子集 = siteConfig.lang + commentConfig（决议 1，其余 config 字段零纳入）：
 *   - GET：override 态（侧车）优先，无 override 时回基线有效值（ts-morph 简单常量
 *     代入求值——基线 `lang: SITE_LANG` 类标识符引用代入 `const NAME = 字面量`）；
 *     commentConfig 无真 secret 性质键 → 无脱敏语义（T1.1 盘点结论）；
 *   - PUT：zod 校验（shared 受控子集 schema 全 .strict()，越界键显式 400）→
 *     ts-morph 声明级定点置换 <mizukiRoot>/src/config.ts 受控声明的初始化器
 *     （其余声明零触碰——非受控字段值不变语义由构造保证）→ pre_write 备份 +
 *     原子写 → 侧车持久化（override 态 + 被置换原文本留档用于还原）；
 *   - 生效链：保存 → console build 任务（process 模块白名单，仅调用）→ dist 更新。
 * [载体] 侧车 JSON：MIZUKI_CONFIG_OVERRIDE_PATH ?? apps/server/data/config-override.json
 *   （跟踪树外，gitignored；备份迁移归部署 checklist 条目）。保存即物化，服务启动
 *   不读侧车（活取值纪律，P11 坑 5 同型）。
 * [状态] ACTIVE
 *
 * 已知限制（ADR-020）：config.ts 被手改后侧车 override 与文件实际内容可能漂移，
 * 面板重新保存即再物化；主题 config.ts 缺 siteConfig/commentConfig 声明或受控键
 * 形态不符 → 404 显式报错（对齐基线源被破坏）；基线含未支持字面量节点（模板插值、
 * 函数调用等）→ 基线视为不可得，GET 相应键返回 null，面板按空表单起步；commentConfig
 * override 无显式清除路径（覆盖写入即管理权转移）；变更不发射 content.changed
 * （scope 枚举为内容同步契约，站点生效经 build 任务通道表达）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type AnnouncementConfigValue,
  type CommentConfigValue,
  type ConfigOverrideFile,
  ConfigOverrideFileSchema,
  type NavConfigValue,
  SITE_ANIME_KEYS,
  SITE_INFO_KEYS,
  SITE_MUSIC_PLAYER_KEYS,
  SITE_PIO_KEYS,
  SITE_SAKURA_KEYS,
  SiteMusicPlayerSchema,
  SitePioSchema,
  SiteSakuraSchema,
  type SiteAnimeValues,
  type SiteEffectsValues,
  type SiteInfoValues,
  type SiteMusicPlayerValues,
  type SitePioValues,
  type SiteSakuraValues,
  type ProfileConfigValue,
} from '@mizuki/shared';
import { z } from 'zod';
import { IndentationText, Node, type ObjectLiteralExpression, type SourceFile } from 'ts-morph';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { requireMizukiRoot } from '../../common/fs/mizuki-root';
import { projectInternalPath } from '../../common/fs/path-projection';

/** 配置源在对外错误信息中的投影（相对形态，不泄露磁盘绝对路径——E1 纪律） */
const CONFIG_TS_DISPLAY = '<mizukiRoot>/src/config.ts';

/**
 * [U3-P4c/K14] 单域 effective 计算：override 逐键覆盖基线（浅合并 = 顶层键级）。
 * 嵌套值（sakura.size/opacity/speed、pio.dialog）按**整值**取自 override——与物化的
 * 「嵌套不下钻」语义严格一致，避免出现「父对象一半新一半旧」的怪态。
 */
function mergeEffectsDomain<T extends object>(
  baseline: Partial<T> | null | undefined,
  override: Partial<T> | null | undefined,
): Partial<T> | null {
  if (override === undefined || override === null) {
    return baseline ?? null;
  }
  if (baseline === undefined || baseline === null) {
    return override;
  }
  return { ...baseline, ...override };
}
import { logger } from '../../common/logger';
import { getAppConfig } from '../../config/app-config';
import { BackupService } from '../../infra/backup/backup.service';
import {
  UnsupportedLiteralError,
  astToValueWithConsts,
  extractSimpleConsts,
  getVariableDeclarationOrThrow,
  loadSourceFile,
  unwrapExpression,
} from '../data-files/evaluator';
import { valueToTsLiteral } from '../data-files/serializer';
import { ThemeRegistryService } from '../theme/theme-registry.service';

/** GET /admin/config 响应视图（override 态优先，基线作对照展示） */
export interface AdminSiteConfigView {
  siteConfig: {
    /** override 态；null = 未设置 override（站点基线生效） */
    lang: string | null;
    /** 基线解析值（标识符代入后；解析失败/形态不符 → null） */
    baselineLang: string | null;
  };
  /** override 存在 → override 值；否则基线有效值；均不可得 → null */
  commentConfig: CommentConfigValue | null;
  /** [Phase4-D3] nav：override 存在 → override 值（空数组 = 清空导航合法态）；否则基线；均不可得 → null */
  nav: NavConfigValue | null;
  /** [Phase4-D3] 基线 nav 解析值（真实主题含 LinkPreset 标识符 → 不可得 null，降级分支） */
  baselineNav: NavConfigValue | null;
  /**
   * [U3-P2/K5] navBarConfig 声明的初始化器**原文**（未求值）：解析成功与否均照给；
   * 声明缺失 → null。用处是降级分支（基线上含 LinkPreset 标识符 → baselineNav null）
   * 下面板仍能把「主题默认导航长什么样」展示给用户——否则接管保存等于蒙眼覆盖。
   */
  baselineNavRaw: string | null;
  /**
   * [U3-P1] 站点信息档：override 态优先（整档写入 = 管理权转移），无 override 时取
   * 基线逐键解析值；基线可缺键（可选键未写 / 未支持字面量键省略）→ 面板对应字段空档起步。
   */
  siteInfo: Partial<SiteInfoValues> | null;
  /** [U3-P1] 基线 siteInfo 逐键解析值（15 键中可求值者；声明缺失/形态不符 → null） */
  baselineSiteInfo: Partial<SiteInfoValues> | null;
  /** [U3-P1] 个人资料档：override ?? 基线整体求值（commentConfig 同构） */
  profile: ProfileConfigValue | null;
  /** [U3-P1] 基线个人资料档解析值 */
  baselineProfile: ProfileConfigValue | null;
  /** [U3-P1] 公告档：override ?? 基线整体求值 */
  announcement: AnnouncementConfigValue | null;
  /** [U3-P1] 基线公告档解析值 */
  baselineAnnouncement: AnnouncementConfigValue | null;
  /**
   * [U3-P4a/K7] 番剧/B站配置档（siteConfig 三键，按域整对象语义）：
   * - `effective`：逐域 override 优先、基线回落（域内**不**做键级 merge——物化是
   *   整对象替换，键级 merge 会与落盘结果不一致，面板据此全字段回填后提交）；
   * - `override`：侧车 override 态（null = 三域均未被面板接管）。
   */
  anime: {
    effective: Partial<SiteAnimeValues>;
    override: Partial<SiteAnimeValues> | null;
  };
  /**
   * [U3-P4c/K14] 特效三档（config.ts **顶层声明** musicPlayerConfig / sakuraConfig /
   * pioConfig，按域逐属性覆盖）：
   * - `effects`：逐域 override 优先、**逐键**回落基线（域内键级 merge——物化是逐属性
   *   置换，故「缺省键继续生效基线值」与落盘结果一致；嵌套值整值取自 override）；
   * - `baselineEffects`：基线逐声明求值（仅受管键投影；`meting_api` 永不出现，
   *   未支持字面量 → 该域 null）；
   * - `null` = 该域既无 override 也无基线（声明缺失/形态不符）。
   */
  effects: SiteEffectsResolution;
  baselineEffects: SiteEffectsResolution;
  /**
   * [U3-P4b/K1] 物化态逐域快照（additive 字段，形状冻结）——只报「有/无」与留档**键名**，
   * **绝不回值、不回原文**（`originals` 的值是 config.ts 片段，含用户域名/评论配置，
   * 体积也不可控）。判定源全部是本次请求已读到的 `carrier`（侧车），**不新增文件读**。
   * 语义逐条：
   * - `lang` = `carrier.siteConfig.lang !== undefined`（侧车子域是 `siteConfig`，非顶层 `lang`）；
   *   `PUT lang ''` 会移除该键 ⇒ 回 false（归一缺省 = 未接管）；
   * - `comments` / `nav` / `profile` / `announcement` = 对应侧车键存在性。**空值也算接管**：
   *   `nav = { links: [] }`（清空导航）与 `siteInfo = {}` 都是合法已接管态，故判定用
   *   `!== undefined` 而非真值判断——否则「已接管但值为空」会被误报为未接管；
   * - `siteInfo.active` 同上；`siteInfo.keys` = 侧车内提交过的键（字典序）；
   * - `originalsKeys` = `Object.keys(carrier.originals ?? {}).sort()`：留档**键名**清单
   *   （如 `siteConfig.lang` / `navBarConfig` / `siteConfig.title`）。清除 override 不会删留档，
   *   故该集合可独立于六域布尔长期存在（「曾接管过、原文本仍可还原」的事实来源）。
   * 前端据此渲染只读警示条；字段缺失时前端 fail-open（不渲警示条），故本字段**必须恒在**
   * （六域全 false + 两空数组 = 「无物化」，不是缺字段）。
   */
  overrides: {
    lang: boolean;
    comments: boolean;
    nav: boolean;
    /** `keys` = 侧车 siteInfo 内提交过的键名，字典序 */
    siteInfo: { active: boolean; keys: string[] };
    profile: boolean;
    announcement: boolean;
    /** = `Object.keys(carrier.originals ?? {}).sort()`（留档键名，字典序） */
    originalsKeys: string[];
  };
}

/** [U3-P4c/K14] 特效三档的对外投影（null = 该域不可得） */
export interface SiteEffectsResolution {
  musicPlayer: Partial<SiteMusicPlayerValues> | null;
  sakura: Partial<SiteSakuraValues> | null;
  pio: Partial<SitePioValues> | null;
}

/** override 侧车位置（[Phase4-D4/C3] 三级优先，事故根因加固 2026-09-07/08）：
 * ① 显式 MIZUKI_CONFIG_OVERRIDE_PATH（最优先，测试注入钩子）；
 * ② MIZUKI_CONFIG_PATH 注入（非缺省）→ 侧车随其所在目录派生（config-override.json
 *    同目录落位）——隔离实例/自托管把 config.json 指到自定义目录时，侧车必须跟着走，
 *    否则将误写**真实 data 目录**的侧车（2026-09-07 走查侧车事故根因，见 SESSIONS）；
 * ③ 缺省 → apps/server/data/config-override.json（原行为不变）。
 * ②③ 自洽性：env 显式设为缺省同值时 dirname 与 ③ 相同，零行为分歧。 */
export function defaultOverridePath(): string {
  if (process.env['MIZUKI_CONFIG_OVERRIDE_PATH']) {
    return process.env['MIZUKI_CONFIG_OVERRIDE_PATH'];
  }
  if (process.env['MIZUKI_CONFIG_PATH']) {
    return path.join(path.dirname(process.env['MIZUKI_CONFIG_PATH']), 'config-override.json');
  }
  return path.resolve(__dirname, '../../../data/config-override.json');
}

/** 主题 config.ts 绝对路径（mizukiRoot 活取值，init 后免重启生效；
 * 未配置 400——文案与异常类型逐字保留，root 判定单源见 common/fs/mizuki-root） */
function configTsPath(): string {
  const root = requireMizukiRoot(getAppConfig().mizukiRoot, {
    missingMessage: 'mizukiRoot 未配置（初始化向导完成后生效）',
  });
  return path.join(root, 'src', 'config.ts');
}

@Injectable()
export class SiteConfigService {
  constructor(
    private readonly backup: BackupService,
    private readonly themeRegistry: ThemeRegistryService,
  ) {}

  // ── 读 ──

  /** GET /admin/config：override 优先，基线对照（活读 config.ts，无缓存） */
  getConfig(): AdminSiteConfigView {
    const carrier = this.readOverride();
    const baseline = this.readBaseline(carrier.originals);
    // [U3-P4a/K7] 番剧/B站档：逐域 override 优先、基线回落（域内不键级 merge）
    const animeOverride = carrier.siteAnime ?? null;
    const animeBaseline = baseline.siteAnime ?? null;
    const animeEffective: Partial<SiteAnimeValues> = {};
    const effectiveAnimeDomain = animeOverride?.anime ?? animeBaseline?.anime;
    if (effectiveAnimeDomain !== undefined) {
      animeEffective.anime = effectiveAnimeDomain;
    }
    const effectiveBangumiDomain = animeOverride?.bangumi ?? animeBaseline?.bangumi;
    if (effectiveBangumiDomain !== undefined) {
      animeEffective.bangumi = effectiveBangumiDomain;
    }
    const effectiveBilibiliDomain = animeOverride?.bilibili ?? animeBaseline?.bilibili;
    if (effectiveBilibiliDomain !== undefined) {
      animeEffective.bilibili = effectiveBilibiliDomain;
    }
    return {
      siteConfig: {
        lang: carrier.siteConfig?.lang ?? null,
        baselineLang: baseline.siteLang,
      },
      commentConfig: carrier.commentConfig ?? baseline.commentConfig,
      nav: carrier.nav ?? baseline.nav,
      baselineNav: baseline.nav,
      baselineNavRaw: baseline.navRaw,
      // [U3-P1] 四新字段（K4）：siteInfo 支持「基线可缺键 → 面板空字段起步」
      siteInfo: carrier.siteInfo ?? baseline.siteInfo,
      baselineSiteInfo: baseline.siteInfo,
      profile: carrier.profile ?? baseline.profile,
      baselineProfile: baseline.profile,
      announcement: carrier.announcement ?? baseline.announcement,
      baselineAnnouncement: baseline.announcement,
      // [U3-P4a/K7] 番剧/B站档（effective = 逐域 override ?? 基线；override = 侧车态）
      anime: { effective: animeEffective, override: animeOverride },
      // [U3-P4c/K14] 特效三档：effects = 逐域 override 逐键回落基线；baselineEffects = 基线
      effects: {
        musicPlayer: mergeEffectsDomain(
          baseline.effects.musicPlayer,
          carrier.siteEffects?.musicPlayer,
        ),
        sakura: mergeEffectsDomain(baseline.effects.sakura, carrier.siteEffects?.sakura),
        pio: mergeEffectsDomain(baseline.effects.pio, carrier.siteEffects?.pio),
      },
      baselineEffects: baseline.effects,
      // [U3-P4b/K1] 物化态逐域快照：全部来自上面已读到的 carrier（零新增文件读、零新端点）
      overrides: {
        lang: carrier.siteConfig?.lang !== undefined,
        comments: carrier.commentConfig !== undefined,
        nav: carrier.nav !== undefined,
        siteInfo: {
          active: carrier.siteInfo !== undefined,
          keys: Object.keys(carrier.siteInfo ?? {}).sort(),
        },
        profile: carrier.profile !== undefined,
        announcement: carrier.announcement !== undefined,
        originalsKeys: Object.keys(carrier.originals ?? {}).sort(),
      },
    };
  }

  // ── 写（PUT lang / PUT comments） ──

  /**
   * PUT /admin/config/lang：undefined/空串 → 归一缺省（清除 override：config.ts
   * 还原留档原文本 + 侧车移除键）；合法值 → 物化进 config.ts + 侧车。
   * 校验已在管道层完成（PutLangBodySchema，C5 口径共享终行）。
   */
  async putLang(lang: string | undefined): Promise<AdminSiteConfigView> {
    // [Phase4-E3a] 物化前置探针门禁（T4，ADR-024）：探针失败 → 409 零物化
    await this.themeRegistry.assertProbesPass(['siteConfig', 'siteConfig.lang']);
    const configPath = configTsPath();
    const carrier = this.readOverride();
    if (lang === undefined || lang === '') {
      await this.spliceSiteConfigLang(configPath, carrier, undefined);
      if (carrier.siteConfig !== undefined) {
        delete carrier.siteConfig.lang;
        if (Object.keys(carrier.siteConfig).length === 0) {
          delete carrier.siteConfig;
        }
      }
      logger.info({ configPath }, 'siteConfig.lang override 已清除（归一缺省）');
    } else {
      await this.spliceSiteConfigLang(configPath, carrier, lang);
      carrier.siteConfig = { lang };
      logger.info({ configPath, lang }, 'siteConfig.lang override 已物化');
    }
    this.writeOverride(carrier);
    return this.getConfig();
  }

  /** PUT /admin/config/comments：全量覆盖写入（无敏感键 → 无脱敏/占位符语义） */
  async putComments(comments: CommentConfigValue): Promise<AdminSiteConfigView> {
    // [Phase4-E3a] 物化前置探针门禁（T4，ADR-024）：探针失败 → 409 零物化
    await this.themeRegistry.assertProbesPass(['commentConfig']);
    const configPath = configTsPath();
    const text = this.readConfigTs(configPath);
    const next = this.spliceCommentConfig(configPath, text, comments);
    await this.backup.preWriteBackup(configPath, 'site-config override: commentConfig');
    this.atomicWrite(configPath, next);
    const carrier = this.readOverride();
    carrier.commentConfig = comments;
    this.writeOverride(carrier);
    logger.info({ configPath }, 'commentConfig override 已物化');
    return this.getConfig();
  }

  /**
   * PUT /admin/config/nav（Phase4-D3，#8）：
   * - links undefined → 归一缺省（清除 override：config.ts 还原留档原文本 + 侧车移除
   *   nav 键，lang 清除路径同构）；
   * - links 数组（含 [] = 合法清空导航，破坏性语义面板层二次确认）→ 声明级全量
   *   置换物化（valueToTsLiteral 序列化，转义由 JSON.stringify 保证）+ 侧车记录；
   *   首次覆盖前将 navBarConfig 原初始化器文本留档 originals（仅首次，清除还原依赖）。
   * 基线不可得（LinkPreset 标识符等未支持节点）不影响物化/留档——留档为原文本，
   * 与求值无关；首次物化直接落盘（baselineNav null + 空表单起步，ADR-020 追加节）。
   */
  async putNav(links: NavConfigValue['links'] | undefined): Promise<AdminSiteConfigView> {
    // [Phase4-E3a] 物化前置探针门禁（T4，ADR-024）：探针失败 → 409 零物化
    await this.themeRegistry.assertProbesPass(['navBarConfig', 'navBarConfig.links']);
    const configPath = configTsPath();
    const carrier = this.readOverride();
    await this.spliceNavBarConfig(configPath, carrier, links);
    if (links === undefined) {
      delete carrier.nav;
      logger.info({ configPath }, 'nav override 已清除（归一缺省）');
    } else {
      carrier.nav = { links };
      logger.info({ configPath, count: links.length }, 'nav override 已物化');
    }
    this.writeOverride(carrier);
    return this.getConfig();
  }

  // ── 写（[U3-P1] PUT site-info / profile / announcement） ──

  /**
   * PUT /admin/config/site-info（U3-P1，K1/K2）：15 键整档全量覆盖写入。
   * - 物化 = siteConfig 对象内**逐属性置换**（lang 先例）：受管 15 键各自
   *   setInitializer，其余声明/属性零触碰；基线缺可选属性而 body 含该键 →
   *   追加属性到对象字面量末尾（缺失插入）；
   * - 可选键在 body 中缺省（undefined）→ 该键零触碰（不新增、不改写）——
   *   避免把面板空档写成语义不同的默认值；
   * - originals 留档：键名 `siteConfig.<key>`，仅首次（原属性文本；原本缺失的属性
   *   无原文本可留档 → 不写条目，还原语义 = 删除属性，留待后续批次）；
   * - 校验已在管道层完成（SiteInfoSchema，越界键 400 零物化）。
   */
  async putSiteInfo(siteInfo: Partial<SiteInfoValues>): Promise<AdminSiteConfigView> {
    // [Phase4-E3a] 物化前置探针门禁（T4，ADR-024）：探针失败 → 409 零物化
    await this.themeRegistry.assertProbesPass([
      'siteConfig',
      'siteConfig.siteInfo',
      ...SITE_INFO_KEYS.map((key) => `siteConfig.${key}`),
    ]);
    const configPath = configTsPath();
    const carrier = this.readOverride();
    await this.spliceSiteInfo(configPath, carrier, siteInfo);
    // 侧车合并（整档覆盖语义：本次提交的键集即 override 态；未提交键不落侧车）
    carrier.siteInfo = { ...siteInfo };
    this.writeOverride(carrier);
    logger.info({ configPath, keys: Object.keys(siteInfo).length }, 'siteInfo override 已物化');
    return this.getConfig();
  }

  /**
   * PUT /admin/config/anime（U3-P4a/K7）：番剧/B站配置档，**按域整对象替换**。
   * - 域键有值 → 该域整档物化（首次覆盖前留档 originals['siteConfig.<域>']）；
   * - 域键缺省 → 该域清除 override 并**还原留档原文本**（无留档 = 零触碰），
   *   故 `PUT {}` = 三域全部还原主题默认；
   * - 侧车只写「本次提交的域」（缺省域不落键 = 基线生效），与 siteInfo 的整档语义同构；
   * - 校验已在管道层完成（PutSiteAnimeBodySchema = SiteAnimeSchema.partial() + .strict()，
   *   越界键 400 零物化）。
   * 不变量（K7）：PUT /site-info 的 15 键契约、SITE_INFO_KEYS、既有 originals 键形零变化。
   */
  async putSiteAnime(values: Partial<SiteAnimeValues>): Promise<AdminSiteConfigView> {
    // [Phase4-E3a] 物化前置探针门禁（T4，ADR-024）：探针失败 → 409 零物化
    await this.themeRegistry.assertProbesPass(['siteConfig']);
    const configPath = configTsPath();
    const carrier = this.readOverride();
    await this.spliceSiteAnime(configPath, carrier, values);
    const nextOverride: Partial<SiteAnimeValues> = {
      ...(values.anime !== undefined ? { anime: values.anime } : {}),
      ...(values.bangumi !== undefined ? { bangumi: values.bangumi } : {}),
      ...(values.bilibili !== undefined ? { bilibili: values.bilibili } : {}),
    };
    if (Object.keys(nextOverride).length === 0) {
      delete carrier.siteAnime;
    } else {
      carrier.siteAnime = nextOverride;
    }
    this.writeOverride(carrier);
    logger.info(
      { configPath, domains: Object.keys(nextOverride).length },
      'siteAnime override 已物化',
    );
    return this.getConfig();
  }

  /**
   * PUT /admin/config/effects（U3-P4c/K14）：特效三档，**逐属性置换**（K11）+ 域清除语义。
   * - 域键有值 → 该声明的受管键逐个 setInitializer（属性缺失且 body 含该键 → 追加），
   *   首次覆盖前按 `originals['<declName>.<key>']` 留档原初始化器文本；
   * - 域键缺省 → 该域清除 override 并**还原留档原文本**（无留档 = 零触碰），
   *   故 `PUT {}` = 三域全部还原主题默认；
   * - 侧车只写「本次提交的域」（缺省域不落键 = 基线生效）；
   * - 三声明在同一读-改-写事务内完成：任一域 404（声明缺失/形态不符）则整体零物化。
   * 不变量：`siteConfig` 15 键契约、`SITE_INFO_KEYS`、siteInfo / anime 两域与既有
   * `originals` 键形零变化；`widgetConfigs` 成员零触碰（再裁 C）。
   */
  async putEffects(values: SiteEffectsValues): Promise<AdminSiteConfigView> {
    // [K16] 探针轴不扩：effects 三档未注册 declarationProbes，显式传空 targets
    // （传未注册 target 是假门禁——assertProbesPass 对未注册 target 恒放行）。
    // 替代门禁 = spliceObjectProps 内的「声明存在 + 对象字面量形态」检查（K11 ①②）。
    await this.themeRegistry.assertProbesPass([]);
    const configPath = configTsPath();
    const carrier = this.readOverride();
    await this.spliceSiteEffects(configPath, carrier, values);
    const nextOverride: SiteEffectsValues = {
      ...(values.musicPlayer !== undefined ? { musicPlayer: values.musicPlayer } : {}),
      ...(values.sakura !== undefined ? { sakura: values.sakura } : {}),
      ...(values.pio !== undefined ? { pio: values.pio } : {}),
    };
    if (Object.keys(nextOverride).length === 0) {
      delete carrier.siteEffects;
    } else {
      carrier.siteEffects = nextOverride;
    }
    this.writeOverride(carrier);
    logger.info(
      { configPath, domains: Object.keys(nextOverride).length },
      'siteEffects override 已物化',
    );
    return this.getConfig();
  }

  /**
   * PUT /admin/config/profile（U3-P1，K1/K3）：声明级整档覆盖写入
   * （commentConfig / navBarConfig 先例），originals['profileConfig'] 首次留档。
   * 无整档清除端点（覆盖写入即管理权转移；留档供未来批次还原）。
   */
  async putProfile(profile: ProfileConfigValue): Promise<AdminSiteConfigView> {
    await this.themeRegistry.assertProbesPass(['profileConfig']);
    const configPath = configTsPath();
    const carrier = this.readOverride();
    await this.spliceProfileConfig(configPath, carrier, profile);
    carrier.profile = profile;
    this.writeOverride(carrier);
    logger.info({ configPath, links: profile.links.length }, 'profileConfig override 已物化');
    return this.getConfig();
  }

  /**
   * PUT /admin/config/announcement（U3-P1，K1/K3）：声明级整档覆盖写入
   * （profileConfig 同构），originals['announcementConfig'] 首次留档。
   */
  async putAnnouncement(announcement: AnnouncementConfigValue): Promise<AdminSiteConfigView> {
    await this.themeRegistry.assertProbesPass(['announcementConfig']);
    const configPath = configTsPath();
    const carrier = this.readOverride();
    await this.spliceAnnouncementConfig(configPath, carrier, announcement);
    carrier.announcement = announcement;
    this.writeOverride(carrier);
    logger.info({ configPath }, 'announcementConfig override 已物化');
    return this.getConfig();
  }

  // ── 内部：侧车 ──

  private readOverride(): ConfigOverrideFile {
    const overridePath = defaultOverridePath();
    if (!fs.existsSync(overridePath)) {
      return ConfigOverrideFileSchema.parse({ version: 1 });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    } catch (error) {
      // [U3-P4b/DEF-06] 对外文案只带投影形态；绝对路径进 pino（AGENTS §4-6）
      logger.error({ overridePath, err: error }, 'config-override.json 解析失败');
      throw new Error(
        `config-override.json 解析失败（${projectInternalPath(overridePath)}）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = ConfigOverrideFileSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      logger.error({ overridePath, issues: detail }, 'config-override.json 校验失败');
      throw new Error(
        `config-override.json 校验失败（${projectInternalPath(overridePath)}）: ${detail}`,
      );
    }
    return parsed.data;
  }

  private writeOverride(carrier: ConfigOverrideFile): void {
    // 原子写单源（common/fs/atomic-write）
    atomicWriteFile(defaultOverridePath(), JSON.stringify(carrier, null, 2), { ensureDir: true });
  }

  // ── 内部：config.ts 读取与定点置换 ──

  /**
   * 原文本片段求值（探针）：留档原文本（如 `SITE_LANG`）包成临时声明后走常量
   * 代入求值——override 物化态下还原「主题默认」真值。不支持节点 → null。
   */
  private resolveLiteralText(
    configPath: string,
    consts: Map<string, string | number>,
    text: string,
  ): string | null {
    try {
      const probe = loadSourceFile(
        path.join(path.dirname(configPath), '__mizuki_probe__.ts'),
        `const __mizukiProbe = ${text};\n`,
      );
      const init = probe.getVariableDeclaration('__mizukiProbe')?.getInitializer();
      if (init === undefined) {
        return null;
      }
      const value = astToValueWithConsts(init, configPath, consts);
      return typeof value === 'string' ? value : null;
    } catch (error) {
      if (error instanceof UnsupportedLiteralError) {
        return null;
      }
      throw error;
    }
  }

  private readConfigTs(configPath: string): string {
    if (!fs.existsSync(configPath)) {
      throw new NotFoundException(`主题 config.ts 不存在（${CONFIG_TS_DISPLAY}）`);
    }
    return fs.readFileSync(configPath, 'utf8');
  }

  /**
   * 基线有效值：siteConfig.lang（字符串化）+ commentConfig（常量代入求值）。
   * siteConfig.lang 在 override 物化态下已从 config.ts 消失——真基线优先从留档
   * 原文本（originals['siteConfig.lang']，如 `SITE_LANG`）探针求值还原。
   */
  private readBaseline(originals: Record<string, string> | undefined): {
    siteLang: string | null;
    commentConfig: CommentConfigValue | null;
    nav: NavConfigValue | null;
    navRaw: string | null;
    siteInfo: Partial<SiteInfoValues> | null;
    siteAnime: Partial<SiteAnimeValues> | null;
    /** [U3-P4c/K14] 特效三档：逐声明求值，仅投影受管键（`meting_api` 恒不出现） */
    effects: SiteEffectsResolution;
    profile: ProfileConfigValue | null;
    announcement: AnnouncementConfigValue | null;
  } {
    const configPath = configTsPath();
    if (!fs.existsSync(configPath)) {
      throw new NotFoundException(`主题 config.ts 不存在（${CONFIG_TS_DISPLAY}）`);
    }
    const sf = loadSourceFile(configPath);
    const consts = extractSimpleConsts(sf);
    let siteLang: string | null = null;
    const siteDecl = sf.getVariableDeclaration('siteConfig');
    const siteInit = siteDecl?.getInitializer();
    if (siteInit !== undefined) {
      try {
        const value = astToValueWithConsts(siteInit, configPath, consts);
        if (
          typeof value === 'object' &&
          value !== null &&
          typeof (value as Record<string, unknown>)['lang'] === 'string'
        ) {
          siteLang = (value as Record<string, unknown>)['lang'] as string;
        }
      } catch (error) {
        if (error instanceof UnsupportedLiteralError) {
          logger.warn({ configPath, line: error.line }, 'siteConfig 基线含未支持节点，基线 lang 视为不可得');
        } else {
          throw error;
        }
      }
    }
    const originalLang = originals?.['siteConfig.lang'];
    if (originalLang !== undefined) {
      siteLang = this.resolveLiteralText(configPath, consts, originalLang) ?? siteLang;
    }
    let commentConfig: CommentConfigValue | null = null;
    const commentDecl = sf.getVariableDeclaration('commentConfig');
    const commentInit = commentDecl?.getInitializer();
    if (commentInit !== undefined) {
      try {
        const value = astToValueWithConsts(commentInit, configPath, consts);
        commentConfig = (value ?? null) as CommentConfigValue | null;
      } catch (error) {
        if (error instanceof UnsupportedLiteralError) {
          logger.warn({ configPath, line: error.line }, 'commentConfig 基线含未支持节点，基线视为不可得');
        } else {
          throw error;
        }
      }
    }
    let nav: NavConfigValue | null = null;
    const navDecl = sf.getVariableDeclaration('navBarConfig');
    const navInit = navDecl?.getInitializer();
    // [U3-P2/K5] 初始化器原文：解析成败均照给（面板降级分支的「原文对照」来源）
    const navRaw = navInit !== undefined ? navInit.getText() : null;
    if (navInit !== undefined) {
      try {
        // T1.1 实测：真实主题 links 含 LinkPreset.Home/Archive 标识符（PropertyAccess
        // 节点）且 astToValueWithConsts 无数组字面量分支 → 恒抛 UnsupportedLiteralError
        // → 降级分支（baselineNav null + 面板空表单起步），ADR-020 追加节已知限制。
        const value = astToValueWithConsts(navInit, configPath, consts);
        nav = (value ?? null) as NavConfigValue | null;
      } catch (error) {
        if (error instanceof UnsupportedLiteralError) {
          logger.warn(
            { configPath, line: error.line },
            'navBarConfig 基线含未支持节点（LinkPreset 标识符等），基线视为不可得',
          );
        } else {
          throw error;
        }
      }
    }
    // [U3-P1] siteInfo 基线：初始化器为对象字面量才逐键解析（形态不符 → null）
    const siteUnwrapped = siteInit !== undefined ? unwrapExpression(siteInit) : undefined;
    const siteInfo =
      siteUnwrapped !== undefined && Node.isObjectLiteralExpression(siteUnwrapped)
        ? this.readSiteInfoBaseline(siteUnwrapped, configPath, consts)
        : null;
    // [U3-P4a/K7] 番剧/B站基线：同上逐属性求值（三域互不牵连）
    const siteAnime =
      siteUnwrapped !== undefined && Node.isObjectLiteralExpression(siteUnwrapped)
        ? this.readSiteAnimeBaseline(siteUnwrapped, configPath, consts)
        : null;
    const profile = this.evalDeclarationValue<ProfileConfigValue>(
      'profileConfig',
      sf,
      configPath,
      consts,
    );
    const announcement = this.evalDeclarationValue<AnnouncementConfigValue>(
      'announcementConfig',
      sf,
      configPath,
      consts,
    );
    // [U3-P4c/K14] 特效三档：逐声明、逐受管键求值（`meting_api` 不在键表内 → 从不读取）
    const effects: SiteEffectsResolution = {
      musicPlayer: this.readEffectsBaseline(
        'musicPlayerConfig',
        SiteMusicPlayerSchema,
        SITE_MUSIC_PLAYER_KEYS,
        sf,
        configPath,
        consts,
      ),
      sakura: this.readEffectsBaseline(
        'sakuraConfig',
        SiteSakuraSchema,
        SITE_SAKURA_KEYS,
        sf,
        configPath,
        consts,
      ),
      pio: this.readEffectsBaseline('pioConfig', SitePioSchema, SITE_PIO_KEYS, sf, configPath, consts),
    };
    return {
      siteLang,
      commentConfig,
      nav,
      navRaw,
      siteInfo,
      siteAnime,
      effects,
      profile,
      announcement,
    };
  }

  /**
   * [U3-P4c/K14] 特效单声明基线：初始化器为对象字面量才逐受管键求值。
   * - 必须逐属性求值：整体求值会因 `meting_api` 等未管键的写法牵连整档不可得；
   * - **只投影受管键**（K12 排除项 I5）：`meting_api` 既不在键表内，也就永不进响应；
   * - 单键 UnsupportedLiteralError → 跳过该键 + warn；全部不可得 → null（面板空档起步）；
   * - 值域以本域 schema 收窄（返回类型由 `z.ZodType<T>` 推出，**不做 `as` 强转**）：
   *   越界键按 zod issue 的 `path[0]` 逐个丢弃后复验，避免一个脏键毁掉整域基线展示。
   */
  private readEffectsBaseline<T extends object>(
    declName: string,
    schema: z.ZodType<T>,
    keys: readonly (keyof T & string)[],
    sf: SourceFile,
    configPath: string,
    consts: Map<string, string | number>,
  ): Partial<T> | null {
    const decl = sf.getVariableDeclaration(declName);
    const init = decl?.getInitializer();
    const unwrapped = init !== undefined ? unwrapExpression(init) : undefined;
    if (unwrapped === undefined || !Node.isObjectLiteralExpression(unwrapped)) {
      return null;
    }
    const raw: Record<string, unknown> = {};
    for (const key of keys) {
      const prop = unwrapped.getProperty(key);
      if (prop === undefined || !Node.isPropertyAssignment(prop)) {
        continue;
      }
      try {
        const value = astToValueWithConsts(prop.getInitializerOrThrow(), configPath, consts);
        if (value !== undefined) {
          raw[key] = value;
        }
      } catch (error) {
        if (error instanceof UnsupportedLiteralError) {
          logger.warn(
            { configPath, declName, key, line: error.line },
            '特效档基线键含未支持节点，该键基线视为不可得',
          );
          continue;
        }
        throw error;
      }
    }
    if (Object.keys(raw).length === 0) {
      return null;
    }
    let checked = schema.safeParse(raw);
    if (!checked.success) {
      // 值域不符的键逐个剔除后复验（基线脏键不应连坐同域其它键）
      const badKeys = new Set(checked.error.issues.map((issue) => String(issue.path[0] ?? '')));
      for (const key of badKeys) {
        delete raw[key];
        logger.warn({ configPath, declName, key }, '特效档基线键值域不符，该键基线视为不可得');
      }
      checked = schema.safeParse(raw);
    }
    return checked.success ? checked.data : null;
  }

  /**
   * [U3-P1] 基线 siteInfo 逐键解析（K2/T2.1）：仅取受管 15 键，逐键常量代入求值；
   * 未支持字面量键 → 省略 + warn（面板该字段空档起步）。求值须逐属性进行——
   * 真实 siteConfig 声明含 keywords/anime/bangumi 等大量非受管键，整体求值会被
   * 任一处未支持节点牵连为「整档不可得」。
   */
  private readSiteInfoBaseline(
    siteObj: ObjectLiteralExpression,
    configPath: string,
    consts: Map<string, string | number>,
  ): Partial<SiteInfoValues> {
    const out: Record<string, unknown> = {};
    for (const key of SITE_INFO_KEYS) {
      const prop = siteObj.getProperty(key);
      if (prop === undefined || !Node.isPropertyAssignment(prop)) {
        continue;
      }
      try {
        const value = astToValueWithConsts(prop.getInitializerOrThrow(), configPath, consts);
        if (value !== undefined) {
          out[key] = value;
        }
      } catch (error) {
        if (error instanceof UnsupportedLiteralError) {
          logger.warn(
            { configPath, key, line: error.line },
            'siteInfo 基线键含未支持节点，该键基线视为不可得',
          );
          continue;
        }
        throw error;
      }
    }
    return out as Partial<SiteInfoValues>;
  }

  /**
   * [U3-P4a/K7] 基线番剧/B站档逐域解析：仅取 SITE_ANIME_KEYS 三键，逐属性常量代入求值。
   * 必须逐属性求值——三域互不牵连（某域含未支持节点时，其余域仍可编辑）；
   * 未支持字面量/非属性赋值 → 该域省略 + warn（面板该域空档起步）；
   * 三域全不可得 → null（与 siteInfo 的「声明形态不符 → null」同语义）。
   */
  private readSiteAnimeBaseline(
    siteObj: ObjectLiteralExpression,
    configPath: string,
    consts: Map<string, string | number>,
  ): Partial<SiteAnimeValues> | null {
    const out: Record<string, unknown> = {};
    for (const key of SITE_ANIME_KEYS) {
      const prop = siteObj.getProperty(key);
      if (prop === undefined || !Node.isPropertyAssignment(prop)) {
        continue;
      }
      try {
        const value = astToValueWithConsts(prop.getInitializerOrThrow(), configPath, consts);
        if (value !== undefined) {
          out[key] = value;
        }
      } catch (error) {
        if (error instanceof UnsupportedLiteralError) {
          logger.warn(
            { configPath, key, line: error.line },
            'siteAnime 基线域含未支持节点，该域基线视为不可得',
          );
          continue;
        }
        throw error;
      }
    }
    return Object.keys(out).length > 0 ? (out as Partial<SiteAnimeValues>) : null;
  }

  /** [U3-P1] 声明级整档基线求值（profileConfig / announcementConfig 与 commentConfig 同构） */
  private evalDeclarationValue<T>(
    declName: string,
    sf: SourceFile,
    configPath: string,
    consts: Map<string, string | number>,
  ): T | null {
    const decl = sf.getVariableDeclaration(declName);
    const init = decl?.getInitializer();
    if (init === undefined) {
      return null;
    }
    try {
      const value = astToValueWithConsts(init, configPath, consts);
      return (value ?? null) as T | null;
    } catch (error) {
      if (error instanceof UnsupportedLiteralError) {
        logger.warn({ configPath, line: error.line }, `${declName} 基线含未支持节点，基线视为不可得`);
        return null;
      }
      throw error;
    }
  }

  /**
   * 定点置换 siteConfig.lang 初始化器（读取 + AST 置换 + 备份 + 原子写一体内联）：
   * - value 有：首次覆盖前将原初始化器文本留档 originals['siteConfig.lang']
   *   （仅首次，避免 override 文本污染原文本），属性置换为 `"value"`；
   * - value 无（清除）：留档存在 → 还原原文本（= 站点基线语义）；不存在 → 不动作。
   */
  private async spliceSiteConfigLang(
    configPath: string,
    carrier: ConfigOverrideFile,
    value: string | undefined,
  ): Promise<void> {
    const text = this.readConfigTs(configPath);
    const sf = loadSourceFile(configPath, text);
    const decl = getVariableDeclarationOrThrow(sf, 'siteConfig', CONFIG_TS_DISPLAY);
    const init = decl.getInitializer();
    if (init === undefined || !Node.isObjectLiteralExpression(init)) {
      throw new NotFoundException(`siteConfig 初始化器形态不符（${CONFIG_TS_DISPLAY}）`);
    }
    const prop = init.getProperty('lang');
    if (prop === undefined || !Node.isPropertyAssignment(prop)) {
      throw new NotFoundException(`siteConfig 缺 lang 属性（${CONFIG_TS_DISPLAY}）`);
    }
    if (value === undefined) {
      const original = carrier.originals?.['siteConfig.lang'];
      if (original === undefined) {
        return; // 无留档 = 基线态，无需还原
      }
      prop.setInitializer(original);
    } else {
      const originals = { ...(carrier.originals ?? {}) };
      if (originals['siteConfig.lang'] === undefined) {
        originals['siteConfig.lang'] = prop.getInitializerOrThrow().getText();
      }
      carrier.originals = originals;
      prop.setInitializer(JSON.stringify(value));
    }
    await this.persistConfigTs(configPath, text, sf.getFullText(), 'siteConfig.lang');
  }

  /** 定点置换 commentConfig 声明初始化器（valueToTsLiteral 序列化，其余声明零触碰） */
  private spliceCommentConfig(configPath: string, text: string, value: CommentConfigValue): string {
    const sf = loadSourceFile(configPath, text);
    const decl = getVariableDeclarationOrThrow(sf, 'commentConfig', CONFIG_TS_DISPLAY);
    decl.setInitializer(valueToTsLiteral(value));
    return sf.getFullText();
  }

  /**
   * 定点置换 navBarConfig 声明初始化器（Phase4-D3，声明级全量置换 commentConfig 同构
   * + 清除还原 lang 同构）：
   * - value 有（含 []）：首次覆盖前将原初始化器文本留档 originals['navBarConfig']
   *   （仅首次，避免 override 文本污染原文本），声明初始化器置换为 valueToTsLiteral
   *   序列化文本（字符串值经 JSON.stringify 转义——引号/反斜杠/换行保证语法有效）；
   * - value 无（清除）：留档存在 → 还原原文本；不存在 → 不动作（等价 no-op）。
   * 声明缺失/初始化器形态不符 → 404（C7 对齐基线源被破坏语义）。
   */
  private async spliceNavBarConfig(
    configPath: string,
    carrier: ConfigOverrideFile,
    value: NavConfigValue['links'] | undefined,
  ): Promise<void> {
    const text = this.readConfigTs(configPath);
    const sf = loadSourceFile(configPath, text);
    const decl = getVariableDeclarationOrThrow(sf, 'navBarConfig', CONFIG_TS_DISPLAY);
    const init = decl.getInitializer();
    if (init === undefined) {
      throw new NotFoundException(`navBarConfig 初始化器形态不符（${CONFIG_TS_DISPLAY}）`);
    }
    if (value === undefined) {
      const original = carrier.originals?.['navBarConfig'];
      if (original === undefined) {
        return; // 无留档 = 基线态，无需还原
      }
      decl.setInitializer(original);
    } else {
      const originals = { ...(carrier.originals ?? {}) };
      if (originals['navBarConfig'] === undefined) {
        originals['navBarConfig'] = init.getText();
      }
      carrier.originals = originals;
      decl.setInitializer(valueToTsLiteral({ links: value }));
    }
    await this.persistConfigTs(configPath, text, sf.getFullText(), 'navBarConfig');
  }

  // ── [U3-P1] 内部：siteInfo / profile / announcement 定点置换 ──

  /**
   * 物化 siteInfo（K2）：siteConfig 对象内 15 受管键**逐属性置换**（lang 先例），
   * 非受管键与其余声明零触碰。
   * - 属性存在 → setInitializer（首次覆盖前留档原文本 originals['siteConfig.<key>']）；
   * - 属性缺失且 body 含该键 → addPropertyAssignment 追加（对象字面量末尾）；
   * - body 未含该键（可选键）→ 零触碰（不新增、不改写，保留站点原语义）。
   * [U3-P4a/K7] 循环体已抽为 spliceSiteKeys（行为逐字等价）；本方法保持一行委托，
   * 语义与抽前一致（回归由既有 p7i/p7f 全量保证）。
   */
  private async spliceSiteInfo(
    configPath: string,
    carrier: ConfigOverrideFile,
    values: Partial<SiteInfoValues>,
  ): Promise<void> {
    await this.spliceSiteKeys(configPath, carrier, values, SITE_INFO_KEYS, 'siteInfo');
  }

  /**
   * [U3-P4a/K7] 物化番剧/B站档（siteConfig 的 animation 三键）：按域**整对象替换**——
   * 每个域键的初始化器整体换成 `valueToTsLiteral(域对象)`，服务端不做键级 merge
   * （基线含标识符时求值不可靠，隐式 merge 会造出半静默行为；面板负责全字段回填）。
   * - 域键在 body 中有值 → 置换（首次覆盖前留档 originals['siteConfig.<域>']）；
   * - 域键缺省（未提交）→ **还原留档原文本**（= 清除该域 override；无留档则零触碰），
   *   对齐 lang / nav 的清除语义，使 `PUT {}` 成为「全部还原」。
   */
  private async spliceSiteAnime(
    configPath: string,
    carrier: ConfigOverrideFile,
    values: Partial<SiteAnimeValues>,
  ): Promise<void> {
    await this.spliceSiteKeys(configPath, carrier, values, SITE_ANIME_KEYS, 'siteAnime', true);
  }

  /**
   * [U3-P4a/K7] siteConfig 对象内若干受管键的**逐属性置换**（原 spliceSiteInfo 循环体，
   * 行为逐字等价；siteInfo 与 siteAnime 共用）。
   * @param keys 置换顺序（数组序 = schema 定义序，禁手工重排）
   * @param kind 落盘/日志标签（'siteInfo' / 'siteAnime'，只影响 persistConfigTs 的标记载荷）
   * @param restoreMissing true = 未提交的键**还原留档原文本**（清除语义）；
   *   false = 零触碰（siteInfo 的「可选键缺省即不写」既有语义，不可变）
   */
  private async spliceSiteKeys<K extends string>(
    configPath: string,
    carrier: ConfigOverrideFile,
    values: Partial<Record<K, unknown>>,
    keys: readonly K[],
    kind: string,
    restoreMissing = false,
  ): Promise<void> {
    const text = this.readConfigTs(configPath);
    const sf = loadSourceFile(configPath, text);
    const decl = getVariableDeclarationOrThrow(sf, 'siteConfig', CONFIG_TS_DISPLAY);
    const init = decl.getInitializer();
    const unwrapped = init !== undefined ? unwrapExpression(init) : undefined;
    if (unwrapped === undefined || !Node.isObjectLiteralExpression(unwrapped)) {
      throw new NotFoundException(`siteConfig 初始化器形态不符（${CONFIG_TS_DISPLAY}）`);
    }
    const originals = { ...(carrier.originals ?? {}) };
    this.prepareIndentation(sf, text, unwrapped);
    this.spliceObjectProps(unwrapped, values, keys, 'siteConfig', originals, restoreMissing);
    carrier.originals = originals;
    await this.persistConfigTs(configPath, text, sf.getFullText(), kind);
  }

  /**
   * [U3-P4c/K11] 物化特效三档（A-GAP-04）：`config.ts` 三个**顶层声明**
   * `musicPlayerConfig` / `sakuraConfig` / `pioConfig` 各自对象字面量的**逐属性置换**。
   * - 再裁 C：`widgetConfigs` 里的 `music/sakura/pio` 成员是标识符引用，**零触碰**——
   *   替换成员会把顶层声明变成死代码，`originals` 还原语义也随之错位；
   * - 嵌套值（`sakura.size/opacity/speed`、`pio.dialog`）视为**一个值**整体置换，不递归：
   *   递归会让 `originals` 的还原粒度与「用户提交的整体形状」脱节（K11）；
   * - 域键缺省 = 该域受管键**还原留档原文**（清除 override，`PUT {}` = 三域全还原）；
   *   域键存在 = 仅置换本次提交的键，其余键零触碰（面板可只提交要改的键）；
   * - 三声明在**同一读-改-写事务**内完成：任一域 404（声明缺失/形态不符）时尚未
   *   `persistConfigTs`，故整批零物化（异常抛出即退出，不落盘也不改侧车）。
   */
  private async spliceSiteEffects(
    configPath: string,
    carrier: ConfigOverrideFile,
    values: SiteEffectsValues,
  ): Promise<void> {
    const text = this.readConfigTs(configPath);
    const sf = loadSourceFile(configPath, text);
    const originals = { ...(carrier.originals ?? {}) };
    this.spliceEffectsDeclaration(
      sf,
      text,
      'musicPlayerConfig',
      SITE_MUSIC_PLAYER_KEYS,
      values.musicPlayer ?? {},
      originals,
    );
    this.spliceEffectsDeclaration(
      sf,
      text,
      'sakuraConfig',
      SITE_SAKURA_KEYS,
      values.sakura ?? {},
      originals,
    );
    this.spliceEffectsDeclaration(sf, text, 'pioConfig', SITE_PIO_KEYS, values.pio ?? {}, originals);
    carrier.originals = originals;
    await this.persistConfigTs(configPath, text, sf.getFullText(), 'siteEffects');
  }

  /**
   * [U3-P4c/K11] 单声明落点解析 + 逐属性置换（K11 ①②：声明存在 + 对象字面量形态）。
   * 不留档 `originals[declName]`（整档）——本域还原粒度是 `<declName>.<key>`。
   */
  private spliceEffectsDeclaration<K extends string>(
    sf: SourceFile,
    text: string,
    declName: string,
    keys: readonly K[],
    values: Partial<Record<K, unknown>>,
    originals: Record<string, string>,
  ): void {
    const decl = getVariableDeclarationOrThrow(sf, declName, CONFIG_TS_DISPLAY);
    const init = decl.getInitializer();
    const unwrapped = init !== undefined ? unwrapExpression(init) : undefined;
    if (unwrapped === undefined || !Node.isObjectLiteralExpression(unwrapped)) {
      throw new NotFoundException(`${declName} 初始化器形态不符（${CONFIG_TS_DISPLAY}）`);
    }
    this.prepareIndentation(sf, text, unwrapped);
    this.spliceObjectProps(unwrapped, values, keys, declName, originals, true);
  }

  /** 新属性缩进单位 = 对象字面量同层既有属性缩进（无既有属性时按文件首个缩进推断） */
  private prepareIndentation(sf: SourceFile, text: string, obj: ObjectLiteralExpression): void {
    const firstProp = obj.getProperties()[0];
    const indentUnit =
      firstProp !== undefined
        ? this.indentationOf(text, firstProp)
        : /^[ \t]/m.test(text)
          ? (/^[ \t]+/m.exec(text)?.[0] ?? '  ')
          : '  ';
    sf.getProject().manipulationSettings.set({ indentationText: this.toIndentationText(indentUnit) });
  }

  /**
   * [U3-P4a/K7 → U3-P4c/K11] 对象字面量**逐属性置换**（原 spliceSiteKeys 循环体，
   * 行为逐字等价；siteInfo / siteAnime / effects 三档共用）：
   * - 属性存在 → `setInitializer` + 首次 `originals['<prefix>.<key>']` 留档原文本；
   * - 属性缺失且 body 含该键 → `addPropertyAssignment` 追加（原文本不存在 → 不留档）；
   * - 键缺省 + `restoreMissing` → 还原留档原文本（无留档则零触碰），留档本身保留；
   * - 键缺省 + `!restoreMissing` → 零触碰（siteInfo 可选键既有语义，不可变）。
   */
  private spliceObjectProps<K extends string>(
    obj: ObjectLiteralExpression,
    values: Partial<Record<K, unknown>>,
    keys: readonly K[],
    originalPrefix: string,
    originals: Record<string, string>,
    restoreMissing: boolean,
  ): void {
    for (const key of keys) {
      const value = values[key];
      if (value === undefined) {
        if (restoreMissing) {
          const original = originals[`${originalPrefix}.${key}`];
          const prop = obj.getProperty(key);
          if (original !== undefined && prop !== undefined && Node.isPropertyAssignment(prop)) {
            prop.setInitializer(original);
          }
        }
        continue; // 默认语义：未提交 → 零触碰
      }
      const literal = valueToTsLiteral(value);
      const prop = obj.getProperty(key);
      if (prop === undefined) {
        obj.addPropertyAssignment({ name: key, initializer: literal });
        continue; // 原本无属性 → 无原文本可留档（还原语义 = 删除属性，后批处理）
      }
      if (!Node.isPropertyAssignment(prop)) {
        throw new NotFoundException(`${originalPrefix}.${key} 非属性赋值（${CONFIG_TS_DISPLAY}）`);
      }
      const originalKey = `${originalPrefix}.${key}`;
      if (originals[originalKey] === undefined) {
        originals[originalKey] = prop.getInitializerOrThrow().getText();
      }
      prop.setInitializer(literal);
    }
  }

  /**
   * 物化 profileConfig（K3）：声明级整档置换（commentConfig 同构）。
   * 声明缺失/无初始化器 → 404（基线源被破坏语义，不新建声明）。
   */
  private async spliceProfileConfig(
    configPath: string,
    carrier: ConfigOverrideFile,
    value: ProfileConfigValue,
  ): Promise<void> {
    await this.spliceWholeDeclaration(
      configPath,
      carrier,
      'profileConfig',
      valueToTsLiteral(value),
    );
  }

  /** 物化 announcementConfig（K3）：声明级整档置换（profileConfig 同构） */
  private async spliceAnnouncementConfig(
    configPath: string,
    carrier: ConfigOverrideFile,
    value: AnnouncementConfigValue,
  ): Promise<void> {
    await this.spliceWholeDeclaration(
      configPath,
      carrier,
      'announcementConfig',
      valueToTsLiteral(value),
    );
  }

  /** 声明级整档置换（读取 + 留档 + 置换 + 备份 + 原子写；原文本留档键 = 声明名） */
  private async spliceWholeDeclaration(
    configPath: string,
    carrier: ConfigOverrideFile,
    declName: string,
    literal: string,
  ): Promise<void> {
    const text = this.readConfigTs(configPath);
    const sf = loadSourceFile(configPath, text);
    const decl = getVariableDeclarationOrThrow(sf, declName, CONFIG_TS_DISPLAY);
    const init = decl.getInitializer();
    if (init === undefined) {
      throw new NotFoundException(`${declName} 初始化器形态不符（${CONFIG_TS_DISPLAY}）`);
    }
    const originals = { ...(carrier.originals ?? {}) };
    if (originals[declName] === undefined) {
      originals[declName] = init.getText();
    }
    carrier.originals = originals;
    decl.setInitializer(literal);
    await this.persistConfigTs(configPath, text, sf.getFullText(), declName);
  }

  /** 节点所在行行首缩进（非空白前缀 → 兜底 2 空格） */
  private indentationOf(text: string, node: Node): string {
    const start = node.getStart();
    const prefix = text.slice(text.lastIndexOf('\n', Math.max(0, start - 1)) + 1, start);
    return /^[ \t]*$/.test(prefix) ? prefix : '  ';
  }

  /** 缩进串 → ts-morph 缩进枚举（Tab / 8 / 4 / 2 空格四档） */
  private toIndentationText(unit: string): IndentationText {
    if (unit.includes('\t')) {
      return IndentationText.Tab;
    }
    if (unit.length >= 8) {
      return IndentationText.EightSpaces;
    }
    return unit.length >= 4 ? IndentationText.FourSpaces : IndentationText.TwoSpaces;
  }

  /** 备份 + 原子写（文本与现读一致时跳过写入——清除还原至原文即等价 no-op） */
  private async persistConfigTs(
    configPath: string,
    before: string,
    after: string,
    note: string,
  ): Promise<void> {
    if (before === after) {
      return;
    }
    await this.backup.preWriteBackup(configPath, `site-config override: ${note}`);
    this.atomicWrite(configPath, after);
  }

  /** 原子写（单源见 common/fs/atomic-write；mergeAndPersistConfig 同型） */
  private atomicWrite(absPath: string, text: string): void {
    atomicWriteFile(absPath, text);
  }
}
