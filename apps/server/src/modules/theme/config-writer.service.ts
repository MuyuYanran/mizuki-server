/**
 * [T4] theme/config-writer.service — 主题配置域读写（面板侧的唯一写入服务，不含 HTTP 控制器）
 *
 * [职责] 把「落点单源」`common/theme/config-write-target` 与「两档文本 ⟷ 值」
 *   `config-serde` / `shirone-config-serde` 接成四个动作：列域 / 读域 / 写域 / 恢复默认。
 *   控制器接线属 ThemeModule 的装配面，本文件**不引入任何 HTTP 装饰器**。
 * [顺序不可变] 总闸 → 白名单 → panelSupport → 空对象 → serde → 路径监狱 → pre_write 备份 → 原子写。
 * [红线 6] 返回值与异常文案**不含任何磁盘绝对路径**：`dirAbs` 只进 pino 日志。
 * [为什么 legacy 全拒] legacy 的可写面归既有 `site-config` 模块（唯一真源 `src/config.ts`），
 *   两处真源争同一份文件必然互相覆盖 ⇒ 本服务对 legacy 只回空表，任何域读/写/删一律拒绝。
 * [为什么空对象要拒] 文件存在但零效果会让 `hasOverride` 失真，且与 DELETE 语义重叠。
 *   ⚠ 上游 `config-overlay.mjs:216-217` 把空映射 `continue` 掉 ⇒ 两档写空对象都是**无副作用**的空操作；
 *   本拒绝是**语义**判断，不是「会弄挂构建」—— 那条理由已被实测推翻一次，禁止写回。
 * [为什么 navBarConfig 写拒删放] 它含 `LinkPreset.Home` 枚举成员引用（PropertyAccessExpression），
 *   面板既读不回也写不出；删除不需要解析，且是用户唯一的逃生门（`panelSupport: 'none'`）。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { getAppConfig } from '../../config/app-config';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { logger } from '../../common/logger';
import { ForbiddenPathError, safeJoin } from '../../common/security/safe-join';
import {
  MIZUKI_HEAD_OVERRIDE_BY_NAME,
  MIZUKI_HEAD_OVERRIDE_DOMAINS,
  SHIRONE_CONFIG_DOMAINS,
} from '../../common/theme/config-domains';
import {
  buildMizukiHeadOverrideSource,
  parseMizukiHeadOverrideSource,
} from '../../common/theme/config-serde';
import {
  buildShironeConfigYaml,
  parseShironeConfigYaml,
  shironeDomainFileName,
} from '../../common/theme/shirone-config-serde';
import {
  resolveConfigWriteTarget,
  type ConfigWriteForm,
  type ConfigWriteSink,
  type ConfigWriteTargetOk,
} from '../../common/theme/config-write-target';
// ⚠ 必须是**值导入**（勿改成 `import type`）：`emitDecoratorMetadata: true`，Nest 的 DI 靠
// 运行期 `design:paramtypes` 元数据解析构造参数；type-only 导入会被编译期擦除 ⇒ 元数据退化为
// `Object` ⇒ 「Nest can't resolve dependencies of ConfigWriterService」。全仓其他服务
// （media / posts / albums / data-files / site-config）对本类均用值导入。
import { BackupService } from '../../infra/backup/backup.service';

/** 面板可编辑性（HEAD 档按域持有；Shirone 档恒为 `literal`） */
export type PanelSupport = 'literal' | 'none';

/** 单域清单条目（对外形状，**无任何绝对路径字段**） */
export interface ThemeConfigDomainEntry {
  readonly form: ConfigWriteForm;
  readonly sink: ConfigWriteSink;
  readonly domain: string;
  /** 落点文件基名（单段；HEAD `<name>.ts`，Shirone `<file>.yaml`） */
  readonly fileName: string;
  readonly panelSupport: PanelSupport;
  readonly hasOverride: boolean;
}

/** 域清单（legacy 档 domains 为空数组：该档可写面不在本服务） */
export interface ThemeConfigDomainList {
  readonly form: ConfigWriteForm;
  readonly sink: ConfigWriteSink;
  readonly needsSync: boolean;
  readonly domains: readonly ThemeConfigDomainEntry[];
}

/** 读域结果（`panelSupport: 'none'` 时 `values` 恒为 null，不尝试解析） */
export interface ThemeConfigDomainRead {
  readonly form: ConfigWriteForm;
  readonly sink: ConfigWriteSink;
  readonly domain: string;
  readonly fileName: string;
  readonly panelSupport: PanelSupport;
  readonly needsSync: boolean;
  readonly hasOverride: boolean;
  readonly values: Record<string, unknown> | null;
  readonly rawSource: string | null;
  readonly parseError: { readonly reason: string; readonly message: string } | null;
}

/** 写域结果 */
export interface ThemeConfigDomainWrite {
  readonly form: ConfigWriteForm;
  readonly sink: ConfigWriteSink;
  readonly domain: string;
  readonly fileName: string;
  readonly needsSync: boolean;
}

/** 恢复默认结果（`removed:false` = 文件本就不存在，幂等成功） */
export interface ThemeConfigDomainReset {
  readonly form: ConfigWriteForm;
  readonly sink: ConfigWriteSink;
  readonly domain: string;
  readonly fileName: string;
  readonly needsSync: boolean;
  readonly removed: boolean;
}

/** 白名单 + 落点解析后的域引用 */
interface ResolvedDomain {
  readonly target: ConfigWriteTargetOk;
  readonly domain: string;
  readonly fileName: string;
  readonly panelSupport: PanelSupport;
}

/** 对外的**唯一**错误构造点：`detail.reason` 供面板分派，`message` 是人话且不含绝对路径 */
function rejection(reason: string, message: string, extra?: Record<string, unknown>): BadRequestException {
  return new BadRequestException({ message, detail: { reason, ...extra } });
}

/** fs 错误码（不依赖 `instanceof Error`，跨域错误对象同样可读） */
function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const value = (error as { code?: unknown }).code;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

/** 回显用户输入前截断：避免把外部字符串原样拼进对外文案 */
function brief(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

@Injectable()
export class ConfigWriterService {
  constructor(private readonly backup: BackupService) {}

  /** 列域：三档的域清单（legacy 为空表；返回值绝不含 dirAbs） */
  listDomains(): ThemeConfigDomainList {
    const target = this.gate();
    const domains: ThemeConfigDomainEntry[] = [];

    if (target.sink === 'mizuki-head-override') {
      for (const domain of MIZUKI_HEAD_OVERRIDE_DOMAINS) {
        const fileName = `${domain.name}.ts`;
        domains.push({
          form: target.form,
          sink: target.sink,
          domain: domain.name,
          fileName,
          panelSupport: domain.panelSupport,
          hasOverride: this.exists(this.fileAbsFor({ target, domain: domain.name, fileName, panelSupport: domain.panelSupport })),
        });
      }
    } else if (target.sink === 'shirone-yaml') {
      for (const domain of SHIRONE_CONFIG_DOMAINS) {
        const fileName = `${domain.file}.yaml`;
        domains.push({
          form: target.form,
          sink: target.sink,
          domain: domain.key,
          fileName,
          panelSupport: 'literal',
          hasOverride: this.exists(this.fileAbsFor({ target, domain: domain.key, fileName, panelSupport: 'literal' })),
        });
      }
    }
    // legacy：domains 保持空数组 —— 该档可写面归 site-config，本服务不持有任何域。

    return { form: target.form, sink: target.sink, needsSync: target.needsSync, domains };
  }

  /** 读域：白名单 → 落点 → 原文 → 解析（解析失败不抛错，回 rawSource + parseError 供面板展示） */
  readDomain(domain: string): ThemeConfigDomainRead {
    const resolved = this.resolveDomain(domain);
    const abs = this.fileAbsFor(resolved);
    const rawSource = this.readTextIfExists(abs);
    const base = {
      form: resolved.target.form,
      sink: resolved.target.sink,
      domain: resolved.domain,
      fileName: resolved.fileName,
      panelSupport: resolved.panelSupport,
      needsSync: resolved.target.needsSync,
      hasOverride: rawSource !== null,
    };

    // panelSupport:'none'：覆盖含枚举成员引用，解析必然失败 ⇒ 不尝试解析，只回原文
    if (resolved.panelSupport === 'none') {
      return { ...base, values: null, rawSource, parseError: null };
    }
    if (rawSource === null) {
      return { ...base, values: {}, rawSource: null, parseError: null };
    }

    const parsed =
      resolved.target.sink === 'mizuki-head-override'
        ? parseMizukiHeadOverrideSource(rawSource)
        : parseShironeConfigYaml(rawSource);
    if (!parsed.ok) {
      return { ...base, values: null, rawSource, parseError: { reason: parsed.reason, message: parsed.message } };
    }
    return { ...base, values: parsed.values, rawSource, parseError: null };
  }

  /** 写域：白名单 → panelSupport → 空对象 → serde → 路径监狱 → 备份 → 原子写 */
  async writeDomain(domain: string, values: Readonly<Record<string, unknown>>): Promise<ThemeConfigDomainWrite> {
    const resolved = this.resolveDomain(domain);

    if (resolved.panelSupport === 'none') {
      throw rejection(
        'panel-unsupported',
        `该域的覆盖需要引用 TS 枚举（LinkPreset.Home），面板无法表达：请直接编辑内容仓的 overrides/${resolved.fileName}。` +
          '下一步：改完该文件后触发一次内容同步再回来查看。',
      );
    }

    if (Object.keys(values).length === 0) {
      throw rejection(
        'empty-values',
        '空对象不是有效的覆盖：文件存在但零效果会让 hasOverride 失真，且与 DELETE 语义重叠。' +
          '下一步：要恢复该域的全部上游默认值，请用 DELETE。',
      );
    }

    let text: string;
    if (resolved.target.sink === 'mizuki-head-override') {
      const built = buildMizukiHeadOverrideSource(resolved.domain, values);
      if (!built.ok) throw rejection(built.reason, built.message);
      text = built.source;
    } else {
      const built = buildShironeConfigYaml(resolved.domain, values);
      if (!built.ok) throw rejection(built.reason, built.message);
      text = built.yaml;
    }

    const abs = this.fileAbsFor(resolved);
    await this.backup.preWriteBackup(abs, `theme config: ${resolved.domain}`); // 新文件 → 跳过（无物可备）
    try {
      atomicWriteFile(abs, text, { ensureDir: true });
    } catch (error) {
      logger.error({ err: error, target: abs }, '主题配置写入失败');
      throw rejection('write-failed', '写入覆盖文件失败：请确认内容目录可写后重试。');
    }

    return {
      form: resolved.target.form,
      sink: resolved.target.sink,
      domain: resolved.domain,
      fileName: resolved.fileName,
      needsSync: resolved.target.needsSync,
    };
  }

  /**
   * 恢复默认：删除该域的覆盖文件（`panelSupport:'none'` 也放行 —— 删除不需要解析）。
   * `removed:false` = 文件本就不存在，视作**成功**（DELETE 语义 = 恢复全部上游默认值，幂等）。
   */
  async resetDomain(domain: string): Promise<ThemeConfigDomainReset> {
    const resolved = this.resolveDomain(domain);
    const abs = this.fileAbsFor(resolved);
    const existed = fs.existsSync(abs);

    await this.backup.preWriteBackup(abs, `theme config reset: ${domain}`); // 不存在 → 跳过（无物可备）

    if (existed) {
      try {
        await fs.promises.unlink(abs);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          logger.error({ err: error, target: abs }, '主题配置删除失败');
          throw rejection('delete-failed', '删除覆盖文件失败：请确认该文件权限后重试。');
        }
      }
    }

    return {
      form: resolved.target.form,
      sink: resolved.target.sink,
      domain: resolved.domain,
      fileName: resolved.fileName,
      needsSync: resolved.target.needsSync,
      removed: existed,
    };
  }

  // ── 内部 ──

  /** 总闸：落点单源不 ok ⇒ 所有操作一律拒绝，`reason` / `message` 原样透传 */
  private gate(): ConfigWriteTargetOk {
    const resolution = resolveConfigWriteTarget(getAppConfig().mizukiRoot);
    if (!resolution.ok) {
      throw rejection(
        resolution.reason,
        resolution.message,
        resolution.invalidMounts.length > 0 ? { invalidMounts: [...resolution.invalidMounts] } : undefined,
      );
    }
    return resolution;
  }

  /** 总闸 + 二维白名单（档 × 域） */
  private resolveDomain(domain: string): ResolvedDomain {
    const target = this.gate();

    switch (target.sink) {
      case 'mizuki-legacy-ts-morph':
        // 该档持久落点与既有 site-config 模块相同 ⇒ 拒绝，避免两处真源争同一个 src/config.ts
        throw rejection(
          'theme-form-unsupported',
          '当前主题是单文件形态（Mizuki legacy）：配置写在 src/config.ts 里，该文件的受控子集由站点配置模块负责。' +
            '下一步：改用站点配置页管理这些配置，或把主题切到内容分离形态后重试。',
        );

      case 'mizuki-head-override': {
        const override = MIZUKI_HEAD_OVERRIDE_BY_NAME.get(domain);
        if (override === undefined) {
          throw rejection('unknown-domain', `未知的配置域：${brief(domain)}。下一步：用域清单里的 domain 名重试。`);
        }
        return {
          target,
          domain: override.name,
          fileName: `${override.name}.ts`,
          panelSupport: override.panelSupport,
        };
      }

      case 'shirone-yaml': {
        const fileBase = shironeDomainFileName(domain);
        if (fileBase === null) {
          throw rejection('unknown-domain', `未知的配置域：${brief(domain)}。下一步：用域清单里的 domain 名重试。`);
        }
        // 文件名只来自 32 行权威表反查，绝不按 kebab-case 硬拼（5 行 key !== file）
        return { target, domain, fileName: `${fileBase}.yaml`, panelSupport: 'literal' };
      }
    }
  }

  /**
   * 路径监狱：`fileName` 必须单段（无分隔符、非 `.` / `..`），再过 `safeJoin(dirAbs, fileName)`
   * 并复查父目录等于 `dirAbs`。**监狱根是 dirAbs（内容目录）**，不是主题根 —— HEAD / Shirone 两档
   * 的落点都可能在主题根之外。
   */
  private fileAbsFor(resolved: ResolvedDomain): string {
    const { fileName } = resolved;
    const illegal =
      fileName.length === 0 ||
      fileName.includes('/') ||
      fileName.includes('\\') ||
      fileName.includes('\0') ||
      fileName === '.' ||
      fileName === '..';
    if (illegal) {
      throw rejection('forbidden-path', '非法的覆盖文件名，已拒绝。下一步：改用域清单里的 domain 名重试。');
    }

    const rootAbs = resolved.target.dirAbs;
    let abs: string;
    try {
      abs = safeJoin(rootAbs, fileName);
    } catch (error) {
      if (error instanceof ForbiddenPathError) {
        throw rejection('forbidden-path', '覆盖文件落点越界，已拒绝。');
      }
      throw error;
    }
    if (path.dirname(abs) !== path.resolve(rootAbs)) {
      throw rejection('forbidden-path', '覆盖文件落点越界，已拒绝。');
    }
    return abs;
  }

  private exists(abs: string): boolean {
    try {
      return fs.statSync(abs).isFile();
    } catch {
      return false;
    }
  }

  /** 读文本：不存在 ⇒ null（含目录/权限导致的 ENOENT 语义）；其余错误人话转译，绝对路径只进日志 */
  private readTextIfExists(abs: string): string | null {
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      logger.error({ err: error, target: abs }, '主题配置读取失败');
      throw rejection('read-failed', '读取覆盖文件失败：请确认该文件权限后重试。');
    }
  }
}
