/**
 * [Phase4-E3a] theme/theme-registry — 主题注册表（双轴正交，ADR-024）
 * [职责] 把主题结构隐式假设升格为可机检机制：
 *   - 漂移轴（诊断）：live 指纹 vs 基线快照，三态（无基线/零漂移/漂移清单
 *     path+kind——added/removed/modified）；re-capture 可重置；
 *   - 探针轴（执法）：live config.ts 声明结构 vs 档案内置预期（T1.3 三钉，
 *     参照源 = MizukiTier1Profile，禁取运行基线——洗白防护）；re-capture
 *     不可重置。两轴独立计算、独立呈现，声明级缺失归探针轴不混入漂移轴。
 * [基线] R3 分派表四态：合法（version 匹配）→ 正常加载；缺失 → 无基线态
 *   （提示 capture，非错误）；失配 → 拒绝加载 + 重捕获指引；解析失败 →
 *   拒绝加载 + 诊断明细。基线存 apps/server/data/theme-baseline/（路径定稿，
 *   gitignored 运行时产物）。
 * [R1 检查项评估] theme-status 响应字段全部源自文件系统扫描与档案常量——
 *   无请求参数/env/路由绑定的 host 或 URL 值、无 cookie domain 派生、无绑定
 *   地址硬编码 → R1 未触发（T3 落地评估结论）。
 * [detector 关系] 与 P6 mizuki-detector 并存（T1.1 三分结论）：detector =
 *   init 期一次性布尔判定；Registry = 运行期可重复（逐请求活读，无缓存）。
 * [状态] ACTIVE
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConflictException, Injectable } from '@nestjs/common';
import {
  CommentConfigSchema,
  type DeclarationProbeSpec,
  MizukiTier1Profile,
  type ProbeResult,
  type ThemeBaselineFile,
  ThemeBaselineFileSchema,
  type ThemeStatusView,
} from '@mizuki/shared';
import {
  Node,
  type SourceFile,
} from 'ts-morph';
import { z } from 'zod';
import { sha256File } from '../../common/crypto/hash';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { requireMizukiRoot } from '../../common/fs/mizuki-root';
import { getAppConfig } from '../../config/app-config';
import {
  UnsupportedLiteralError,
  astToValueWithConsts,
  extractSimpleConsts,
  loadSourceFile,
  unwrapExpression,
} from '../data-files/evaluator';

/** 基线默认位置：apps/server/data/theme-baseline/baseline.json（env 可覆盖，测试注入钩子） */
export function defaultBaselinePath(): string {
  return (
    process.env['MIZUKI_THEME_BASELINE_PATH'] ??
    path.resolve(__dirname, '../../../data/theme-baseline/baseline.json')
  );
}

/** 探针失败三步指引（T4 门禁 409 detail；措辞与 ADR-024 一致） */
export const PROBE_GATE_GUIDANCE = [
  '① 重新捕获基线（POST /api/v1/admin/theme/capture）——仅重置漂移轴（诊断用），探针轴不受影响',
  '② 核对并修订 Tier 1 档案（packages/shared/src/theme-profile.ts 与 docs/profiles/mizuki-tier1.md 派生件同步）',
  '③ 评估物化适配性：确认 site-config 受控子集写入器与新主题结构兼容后再放行',
] as const;

/** value-parses-schema 检查的受控 schema 映射（canonical 符号 → zod schema） */
const PROBE_SCHEMAS: Record<string, z.ZodType> = {
  commentConfig: CommentConfigSchema,
};

/** live 指纹条目（扫描输出；目录级条目 sha256 恒 null） */
interface LiveFingerprintEntry {
  path: string;
  role: ThemeStatusView['fingerprint']['entries'][number]['role'];
  present: boolean;
  sha256: string | null;
}

/** 基线加载结果（R3 分派表四态载体） */
interface BaselineLoad {
  state: ThemeStatusView['baseline']['state'];
  file?: ThemeBaselineFile;
  detail?: string;
}

@Injectable()
export class ThemeRegistryService {
  // ── 端点面 ──

  /** GET /admin/theme/status：身份 + 指纹时间戳 + 漂移三态 + 探针结果（全只读） */
  getStatus(): ThemeStatusView {
    const live = this.scanLive();
    const baseline = this.loadBaseline();
    return {
      identity: this.readIdentity(),
      fingerprint: {
        scannedAt: live.scannedAt,
        digest: live.digest,
        entries: live.entries,
      },
      baseline: {
        state: baseline.state,
        profileVersion: baseline.file?.profileVersion ?? null,
        capturedAt: baseline.file?.capturedAt ?? null,
        detail: baseline.detail ?? null,
      },
      drift: this.computeDrift(live.entries, baseline),
      probes: this.runAllProbes(),
    };
  }

  /** POST /admin/theme/capture：live 指纹 → 基线快照（原子写；重置漂移轴、不重置探针轴） */
  captureBaseline(): ThemeStatusView {
    const live = this.scanLive();
    const baseline: ThemeBaselineFile = {
      profileVersion: MizukiTier1Profile.profileVersion,
      capturedAt: new Date().toISOString(),
      entries: live.entries.map((entry) => ({
        path: entry.path,
        present: entry.present,
        sha256: entry.sha256,
      })),
    };
    const baselinePath = defaultBaselinePath();
    // 原子写单源（common/fs/atomic-write）
    atomicWriteFile(baselinePath, JSON.stringify(baseline, null, 2), { ensureDir: true });
    return this.getStatus();
  }

  /**
   * [T4 门禁] 物化写入器前置探针（参照源 = 档案内置预期，写入器目标 = T1.3
   * canonical 符号）：探针失败 → 409（探针明细 + 三步指引），调用方零物化；
   * 探针通过 → 调用方行为字节级不变（门禁只读不写）。
   */
  assertProbesPass(targets: string[]): void {
    const failed = this.runAllProbes().filter(
      (probe) => targets.includes(probe.target) && !probe.passed,
    );
    if (failed.length > 0) {
      throw new ConflictException({
        message: `主题声明探针失败（${failed.map((probe) => probe.target).join('、')}）——物化已阻断，主题结构可能已升级`,
        detail: {
          probes: failed,
          guidance: PROBE_GATE_GUIDANCE,
        },
      });
    }
  }

  // ── 身份（运行期活读 package.json） ──

  private readIdentity(): ThemeStatusView['identity'] {
    const root = this.requireMizukiRoot();
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return { name: null, version: null, fallback: 'fingerprint' };
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      const name = typeof pkg.name === 'string' ? pkg.name : null;
      const version = typeof pkg.version === 'string' ? pkg.version : null;
      // name+version 双全 → package.json 身份；否则降级指纹代身份（T1.4 无 version 降级）
      return {
        name,
        version,
        fallback: name !== null && version !== null ? 'package.json' : 'fingerprint',
      };
    } catch {
      return { name: null, version: null, fallback: 'fingerprint' };
    }
  }

  // ── 漂移轴（live vs 基线） ──

  /** 按 Tier 1 档案编目表扫描 live 指纹（全只读；sha256 = node:crypto） */
  private scanLive(): { scannedAt: string; digest: string; entries: LiveFingerprintEntry[] } {
    const root = this.requireMizukiRoot();
    const scannedAt = new Date().toISOString();
    const entries: LiveFingerprintEntry[] = MizukiTier1Profile.fingerprintSeeds.map((seed) => {
      const abs = path.join(root, ...seed.path.split('/'));
      let present = false;
      let sha256: string | null = null;
      try {
        const stat = fs.statSync(abs);
        present = seed.path.endsWith('/') ? stat.isDirectory() : stat.isFile();
        if (present && !seed.path.endsWith('/')) {
          sha256 = sha256File(abs);
        }
      } catch {
        present = false;
      }
      return { path: seed.path, role: seed.role, present, sha256 };
    });
    // digest：排序后「path=哈希/absent」行集的 sha256（时间戳不进 digest——重扫幂等可断言）
    const material = entries
      .map((entry) => `${entry.path}=${entry.present ? (entry.sha256 ?? 'dir') : 'absent'}`)
      .sort()
      .join('\n');
    const digest = createHash('sha256').update(material).digest('hex');
    return { scannedAt, digest, entries };
  }

  /** 基线加载（R3 分派表四态） */
  private loadBaseline(): BaselineLoad {
    const baselinePath = defaultBaselinePath();
    if (!fs.existsSync(baselinePath)) {
      return { state: 'absent' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch (error) {
      return {
        state: 'parse-error',
        detail: `基线 JSON 解析失败（${baselinePath}）: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const parsed = ThemeBaselineFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return { state: 'parse-error', detail: `基线校验失败（${baselinePath}）: ${issues}` };
    }
    if (parsed.data.profileVersion !== MizukiTier1Profile.profileVersion) {
      return {
        state: 'version-mismatch',
        file: parsed.data,
        detail: `基线 profileVersion（${parsed.data.profileVersion}）与 Tier 1 档案（${MizukiTier1Profile.profileVersion}）失配——请重新捕获基线（POST /api/v1/admin/theme/capture）`,
      };
    }
    return { state: 'loaded', file: parsed.data };
  }

  /** 漂移三态（基线未加载 → 无基线态；声明级缺失归探针轴，不混入） */
  private computeDrift(
    liveEntries: LiveFingerprintEntry[],
    baseline: BaselineLoad,
  ): ThemeStatusView['drift'] {
    if (baseline.state !== 'loaded' || baseline.file === undefined) {
      return { state: 'no-baseline', items: [] };
    }
    const baseMap = new Map(baseline.file.entries.map((entry) => [entry.path, entry]));
    const liveMap = new Map(liveEntries.map((entry) => [entry.path, entry]));
    const items: ThemeStatusView['drift']['items'] = [];
    for (const entryPath of [...new Set([...baseMap.keys(), ...liveMap.keys()])].sort()) {
      const base = baseMap.get(entryPath);
      const live = liveMap.get(entryPath);
      const basePresent = base?.present ?? false;
      const livePresent = live?.present ?? false;
      if (!basePresent && livePresent) {
        items.push({ path: entryPath, kind: 'added' });
      } else if (basePresent && !livePresent) {
        items.push({ path: entryPath, kind: 'removed' });
      } else if (basePresent && livePresent && base?.sha256 !== live?.sha256) {
        items.push({ path: entryPath, kind: 'modified' });
      }
    }
    return { state: items.length === 0 ? 'clean' : 'drifted', items };
  }

  // ── 探针轴（live config.ts vs 档案内置预期） ──

  /** 全量声明探针（档案 declarationProbes 逐条；config.ts 缺失 → 全失败） */
  private runAllProbes(): ProbeResult[] {
    const root = this.requireMizukiRoot();
    const configPath = path.join(root, 'src', 'config.ts');
    let sf: SourceFile | null = null;
    let consts: Map<string, string | number> = new Map();
    if (fs.existsSync(configPath)) {
      sf = loadSourceFile(configPath);
      consts = extractSimpleConsts(sf);
    }
    return MizukiTier1Profile.declarationProbes.map((spec) => this.runProbe(spec, sf, consts, configPath));
  }

  /** 单探针：结构性形态匹配（三钉③——存在 + 对象形态 + 键面过 schema；禁配置值预期） */
  private runProbe(
    spec: DeclarationProbeSpec,
    sf: SourceFile | null,
    consts: Map<string, string | number>,
    configPath: string,
  ): ProbeResult {
    const fail = (detail: string): ProbeResult => ({ target: spec.target, passed: false, detail });
    if (sf === null) {
      // 对外 detail 用相对投影（E1：响应体不泄露磁盘绝对路径）
      return fail(`主题 config.ts 不存在（<mizukiRoot>/src/config.ts）`);
    }
    const baseTarget = spec.target.split('.')[0] ?? spec.target;
    for (const check of spec.checks) {
      if (check === 'declaration-exists') {
        if (sf.getVariableDeclaration(baseTarget) === undefined) {
          return fail(`${baseTarget} 声明缺失（${spec.target} 探针目标）`);
        }
        continue;
      }
      const decl = sf.getVariableDeclaration(baseTarget);
      if (decl === undefined) {
        return fail(`${baseTarget} 声明缺失（${spec.target} 探针目标）`);
      }
      const init = decl.getInitializer();
      if (init === undefined) {
        return fail(`${baseTarget} 无初始化器`);
      }
      const unwrapped = unwrapExpression(init);
      if (check === 'initializer-object') {
        if (!Node.isObjectLiteralExpression(unwrapped)) {
          return fail(`${baseTarget} 初始化器非对象字面量（实际 ${unwrapped.getKindName()}）`);
        }
        continue;
      }
      const obj = Node.isObjectLiteralExpression(unwrapped) ? unwrapped : null;
      if (check === 'property-exists') {
        if (spec.property === undefined || obj === null || obj.getProperty(spec.property) === undefined) {
          return fail(`${spec.target} 属性缺失（${spec.property ?? '(未声明)'}）`);
        }
        continue;
      }
      const prop =
        spec.property !== undefined && obj !== null ? obj.getProperty(spec.property) : undefined;
      if (check === 'property-assignment') {
        if (prop === undefined || !Node.isPropertyAssignment(prop)) {
          return fail(`${spec.target} 非 PropertyAssignment（实际 ${prop?.getKindName() ?? '缺失'}）`);
        }
        continue;
      }
      if (check === 'property-array-literal') {
        if (prop === undefined || !Node.isPropertyAssignment(prop)) {
          return fail(`${spec.target} 属性缺失或非 PropertyAssignment`);
        }
        const propInit = unwrapExpression(prop.getInitializerOrThrow());
        if (!Node.isArrayLiteralExpression(propInit)) {
          return fail(`${spec.target} 非数组字面量（实际 ${propInit.getKindName()}）`);
        }
        continue;
      }
      // value-parses-schema：常量代入求值 + 受控 schema 键面校验（commentConfig 专用）
      const schema = PROBE_SCHEMAS[baseTarget];
      if (schema === undefined) {
        return fail(`${baseTarget} 无受控 schema 映射（value-parses-schema 不可用）`);
      }
      let value: unknown;
      try {
        value = astToValueWithConsts(init, configPath, consts);
      } catch (error) {
        if (error instanceof UnsupportedLiteralError) {
          return fail(`${baseTarget} 常量代入求值失败（${error.message}）`);
        }
        throw error;
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ');
        return fail(`${baseTarget} 键面不符受控 schema（${issues}）`);
      }
    }
    return { target: spec.target, passed: true, detail: '通过' };
  }

  /** mizukiRoot 活取值（未配置 → 404 显式报错，与 site-config 同口径） */
  /** 未配置 → 404（文案与异常类型逐字保留；root 判定单源见 common/fs/mizuki-root） */
  private requireMizukiRoot(): string {
    return requireMizukiRoot(getAppConfig().mizukiRoot, {
      missing: 'not-found',
      missingMessage: 'mizukiRoot 未配置（初始化向导完成后生效）',
    });
  }
}
