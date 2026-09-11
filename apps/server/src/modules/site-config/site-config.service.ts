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
  type CommentConfigValue,
  type ConfigOverrideFile,
  ConfigOverrideFileSchema,
  type NavConfigValue,
} from '@mizuki/shared';
import { Node } from 'ts-morph';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { requireMizukiRoot } from '../../common/fs/mizuki-root';

/** 配置源在对外错误信息中的投影（相对形态，不泄露磁盘绝对路径——E1 纪律） */
const CONFIG_TS_DISPLAY = '<mizukiRoot>/src/config.ts';
import { logger } from '../../common/logger';
import { getAppConfig } from '../../config/app-config';
import { BackupService } from '../../infra/backup/backup.service';
import {
  UnsupportedLiteralError,
  astToValueWithConsts,
  extractSimpleConsts,
  getVariableDeclarationOrThrow,
  loadSourceFile,
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
    return {
      siteConfig: {
        lang: carrier.siteConfig?.lang ?? null,
        baselineLang: baseline.siteLang,
      },
      commentConfig: carrier.commentConfig ?? baseline.commentConfig,
      nav: carrier.nav ?? baseline.nav,
      baselineNav: baseline.nav,
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
      throw new Error(
        `config-override.json 解析失败（${overridePath}）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = ConfigOverrideFileSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`config-override.json 校验失败（${overridePath}）: ${detail}`);
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
    return { siteLang, commentConfig, nav };
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
