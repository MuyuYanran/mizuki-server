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
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CommentConfigValue,
  type ConfigOverrideFile,
  ConfigOverrideFileSchema,
} from '@mizuki/shared';
import {
  AsExpression,
  Node,
  ObjectLiteralExpression,
  ParenthesizedExpression,
  PrefixUnaryExpression,
  SatisfiesExpression,
  StringLiteral,
  SyntaxKind,
  type SourceFile,
} from 'ts-morph';
import { logger } from '../../common/logger';
import { getAppConfig } from '../../config/app-config';
import { BackupService } from '../../infra/backup/backup.service';
import {
  UnsupportedLiteralError,
  getVariableDeclarationOrThrow,
  loadSourceFile,
} from '../data-files/evaluator';
import { valueToTsLiteral } from '../data-files/serializer';

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
}

/** override 侧车默认位置：apps/server/data/config-override.json（env 可覆盖，测试注入钩子） */
export function defaultOverridePath(): string {
  return (
    process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] ??
    path.resolve(__dirname, '../../../data/config-override.json')
  );
}

/** 主题 config.ts 绝对路径（mizukiRoot 活取值，init 后免重启生效） */
function configTsPath(): string {
  const root = getAppConfig().mizukiRoot;
  if (!root) {
    throw new BadRequestException('mizukiRoot 未配置（初始化向导完成后生效）');
  }
  return path.join(root, 'src', 'config.ts');
}

/** 简单常量值判定：字符串字面量 / 无插值模板 / 数字字面量 → 值；其余 → undefined */
function constValueOf(init: Node): string | number | undefined {
  switch (init.getKind()) {
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return (init as StringLiteral).getLiteralText();
    case SyntaxKind.NumericLiteral: {
      const num = Number(init.getText());
      return Number.isFinite(num) ? num : undefined;
    }
    default:
      return undefined;
  }
}

/** 顶层非导出简单常量表（config.ts 的 SITE_LANG / SITE_TIMEZONE 类，代入标识符引用） */
function extractSimpleConsts(sf: SourceFile): Map<string, string | number> {
  const map = new Map<string, string | number>();
  for (const stmt of sf.getVariableStatements()) {
    if (stmt.hasExportKeyword()) {
      continue; // 导出的业务对象不走常量表（siteConfig/commentConfig 本体）
    }
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init === undefined) {
        continue;
      }
      const value = constValueOf(init);
      if (value !== undefined) {
        map.set(decl.getName(), value);
      }
    }
  }
  return map;
}

/**
 * AST → JS 值（data-files/evaluator astToValue 的常量代入变体）：
 * 分派表同型（自包含字面量），唯一差异——Identifier 节点查常量表代入
 * （config.ts 允许 `lang: SITE_LANG` 式引用）；常量表未命中的标识符与其他
 * 未支持节点 → UnsupportedLiteralError（调用方按「基线不可得」处置）。
 */
function astToValueWithConsts(node: Node, filePath: string, consts: Map<string, string | number>): unknown {
  switch (node.getKind()) {
    case SyntaxKind.ObjectLiteralExpression: {
      const obj = node as ObjectLiteralExpression;
      const result: Record<string, unknown> = {};
      for (const property of obj.getProperties()) {
        if (!Node.isPropertyAssignment(property)) {
          throw new UnsupportedLiteralError(filePath, property.getStartLineNumber(), property.getKindName());
        }
        const key = property.getNameNode();
        const name = Node.isStringLiteral(key) ? key.getLiteralText() : key.getText();
        result[name] = astToValueWithConsts(property.getInitializerOrThrow(), filePath, consts);
      }
      return result;
    }
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return (node as StringLiteral).getLiteralText();
    case SyntaxKind.NumericLiteral:
      return Number(node.getText());
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.NullKeyword:
      return null;
    case SyntaxKind.AsExpression:
    case SyntaxKind.SatisfiesExpression:
    case SyntaxKind.ParenthesizedExpression:
      return astToValueWithConsts(
        (node as AsExpression | SatisfiesExpression | ParenthesizedExpression).getExpression(),
        filePath,
        consts,
      );
    case SyntaxKind.PrefixUnaryExpression: {
      const expr = node as PrefixUnaryExpression;
      if (expr.getOperatorToken() === SyntaxKind.MinusToken) {
        const operand = astToValueWithConsts(expr.getOperand(), filePath, consts);
        if (typeof operand === 'number') {
          return -operand;
        }
      }
      throw new UnsupportedLiteralError(filePath, node.getStartLineNumber(), node.getKindName());
    }
    case SyntaxKind.Identifier: {
      const value = consts.get(node.getText());
      if (value === undefined) {
        throw new UnsupportedLiteralError(filePath, node.getStartLineNumber(), node.getKindName());
      }
      return value;
    }
    default:
      throw new UnsupportedLiteralError(filePath, node.getStartLineNumber(), node.getKindName());
  }
}

@Injectable()
export class SiteConfigService {
  constructor(private readonly backup: BackupService) {}

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
    };
  }

  // ── 写（PUT lang / PUT comments） ──

  /**
   * PUT /admin/config/lang：undefined/空串 → 归一缺省（清除 override：config.ts
   * 还原留档原文本 + 侧车移除键）；合法值 → 物化进 config.ts + 侧车。
   * 校验已在管道层完成（PutLangBodySchema，C5 口径共享终行）。
   */
  async putLang(lang: string | undefined): Promise<AdminSiteConfigView> {
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
    const overridePath = defaultOverridePath();
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    const tmp = path.join(
      path.dirname(overridePath),
      `.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.writeFileSync(tmp, JSON.stringify(carrier, null, 2));
    fs.renameSync(tmp, overridePath);
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
      throw new NotFoundException(`主题 config.ts 不存在（${configPath}）`);
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
  } {
    const configPath = configTsPath();
    if (!fs.existsSync(configPath)) {
      throw new NotFoundException(`主题 config.ts 不存在（${configPath}）`);
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
    return { siteLang, commentConfig };
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
    const decl = getVariableDeclarationOrThrow(sf, 'siteConfig');
    const init = decl.getInitializer();
    if (init === undefined || !Node.isObjectLiteralExpression(init)) {
      throw new NotFoundException(`siteConfig 初始化器形态不符（${configPath}）`);
    }
    const prop = init.getProperty('lang');
    if (prop === undefined || !Node.isPropertyAssignment(prop)) {
      throw new NotFoundException(`siteConfig 缺 lang 属性（${configPath}）`);
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
    const decl = getVariableDeclarationOrThrow(sf, 'commentConfig');
    decl.setInitializer(valueToTsLiteral(value));
    return sf.getFullText();
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

  /** 原子写（同目录临时文件 → rename，mergeAndPersistConfig 同型） */
  private atomicWrite(absPath: string, text: string): void {
    const tmp = path.join(
      path.dirname(absPath),
      `.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, absPath);
  }
}
