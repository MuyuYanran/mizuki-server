/**
 * [Q3 裁定] common/theme/content-source — 内容源解析（L0 只读探测，单源能力）
 *
 * ① 本文件是 Q3「内容分离 mounts：只读感知 + 路径跟随，**不提供挂载配置 UI**」裁定的实现：
 *    只解析「内容仓在哪、挂到哪」，不提供任何挂载配置的读写接口，面板不出现相关 UI。
 * ② 为什么必须跟随 mounts：Shirone 的内容分离把内容放在**另一个仓**，每次 sync 从
 *    内容仓 → 代码仓物化（`prune` 默认 true）。写在**代码仓**里的内容文件会在下次 sync
 *    被删掉。⇒ T3（配置）/ T4（文章）/ T5（moments / series）要写入，必须先经本文件拿到
 *    内容仓落点（`contentRoot` / `configDirInContent` / `overridesDirInContent`），
 *    否则写进去的东西会蒸发。
 * ③ 本文件**只读、零写盘**：只 `statSync` / 读固定叶子文件（`shirone.content.json`、
 *    `content.lock.json`、`.env` / `.env.local`），**不做任何递归遍历**（大树主题下也是常数级 IO）。
 * ④ 事实源：上游 `scripts/content/resolve-source.mjs`（本机存档
 *    `.test-tmp/upstream-Shirone-20261029`）。常量、归一化与 mounts 边界口径逐条对照上游，
 *    唯一刻意的偏离：上游非法项直接 `fail()` 抛错，本文件**永不抛错** —— 非法项落证据后
 *    视为无效并保留默认值（调用方是只读探测，不得因清单写坏而 500）。
 *    `schemaVersion > 1` ⇒ 明确 `supported: false` + reason，**不静默按 1 处理**。
 * ⑤ [env 对齐] 上游 `resolve-source.mjs:396-441` 会读**主题根**的 `.env` → `.env.local`
 *    （后者覆盖前者，`\r?\n` 切行、`#` 注释、第一个 `=`、两端同型引号才剥），
 *    并据此把 `CONTENT_DIR` / `CONTENT_REPO_URL`(`_REF`) 排在清单 `source` **之前**；
 *    `SHIRONE_CONTENT_SYNC` ∈ {0,false,off,no} ⇒ 直接 `mode:'local'`。
 *    上游顺手写 `process.env`；本文件把「进程 env + 文件」合并成**只读视图**
 *    （`resolveThemeEnv`）而**绝不写 `process.env`** —— 这是唯一刻意的写法偏离，
 *    解析出的**有效值**与上游逐字一致（进程 env 优先，文件键永不覆盖已继承的键）。
 * [失败语义] root 为空串 / 不存在 ⇒ `mode: 'local'`，不抛错（与 `theme-adapter.ts` 同口径）。
 * [路径纪律] `evidence.detail` 与 `manifestPath` 只写相对路径；`contentRoot` 是绝对路径，
 *    **仅供后端内部使用**，不进任何响应体（仓规红线 6）。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import { type ThemeProbeEvidence } from '@mizuki/shared';

/** 主题/项目根下的内容分离清单（上游 `MANIFEST_FILE`） */
export const MANIFEST_FILE = 'shirone.content.json';

/** `type: 'git'` 时内容仓工作副本的落盘目录，主题根下，已 gitignore（上游 `WORKING_COPY_DIR`） */
export const WORKING_COPY_DIR = '.content-src';

/** 每次 sync 后写出的溯源文件，主题根下，已 gitignore（上游 `LOCK_FILE`） */
export const LOCK_FILE = 'content.lock.json';

/** 当前支持的清单结构版本（上游 `SUPPORTED_SCHEMA_VERSION`） */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** 内容仓内约定目录（T3 用）：Shirone 的 `config/<域>.yaml` 落点 */
export const CONFIG_DIR_IN_CONTENT = 'config';

/** 内容仓内约定目录（T3 用）：Mizuki HEAD 的 `overrides/<导出名>.ts` 落点 */
export const OVERRIDES_DIR_IN_CONTENT = 'overrides';

/**
 * 默认挂载表：**内容仓目录 → 代码仓落点**（键 = 内容仓里的目录名，值 = 代码仓里的落点）。
 * 与上游 `DEFAULT_MOUNTS` 逐字同值；`mode: 'local'` 时不使用。
 */
export const DEFAULT_MOUNTS: Readonly<Record<string, string>> = Object.freeze({
  content: 'src/content',
  data: 'src/data',
  assets: 'src/assets',
  public: 'public',
});

/** 保留挂载**源**根（上游 `RESERVED_MOUNT_SOURCE_ROOTS`） */
const RESERVED_MOUNT_SOURCE_ROOTS = new Set(['.git', 'node_modules']);

/** 保留挂载**目标**根（上游 `RESERVED_MOUNT_TARGET_ROOTS`） */
const RESERVED_MOUNT_TARGET_ROOTS = new Set([
  '.git',
  '.astro',
  '.content-backup',
  '.content-src',
  '.export-backup',
  'node_modules',
  'scripts',
  'tests',
]);

/** 内容分离模式：`local` = 主题仓自持内容（不使用 mounts）；`external` = 内容来自独立内容仓 */
export type ContentSourceMode = 'local' | 'external';

/** 生效的挂载映射：内容仓目录 → 代码仓落点 */
export type ContentMounts = Record<string, string>;

export interface ContentSourceGitDescriptor {
  type: 'git';
  url: string;
  ref: string | null;
}

export interface ContentSourcePathDescriptor {
  type: 'path';
  path: string;
}

export type ContentSourceDescriptor = ContentSourceGitDescriptor | ContentSourcePathDescriptor;

/** 被判定为非法的挂载覆盖项（键 + 原因，均相对口径） */
export interface InvalidMountEntry {
  key: string;
  reason: string;
}

/** `content.lock.json` 只读摘要（用户可能从未 sync ⇒ 全 null 且 `readable: false`） */
export interface ContentLockSummary {
  readable: boolean;
  schemaVersion: number | null;
  syncedAt: string | null;
  sourceType: 'git' | 'path' | null;
  commit: string | null;
  /** 仅 `type: 'path'` 时：内容仓路径（原样，仅供内部推算 contentRoot） */
  sourcePath: string | null;
}

/** 内容源档案：只读解析结果（`contentRoot` 为绝对路径，仅内部使用） */
export interface ContentSourceProfile {
  mode: ContentSourceMode;
  /** 清单声明的结构版本；无 manifest 时为 `SUPPORTED_SCHEMA_VERSION` */
  schemaVersion: number;
  /** `schemaVersion > 1`（或非法）⇒ false：调用方应拒绝任何写入 */
  supported: boolean;
  /** 不支持 / 退化到 local 的原因；正常 external 时为 null */
  reason: string | null;
  /** 清单的相对路径（POSIX），无 manifest ⇒ null */
  manifestPath: string | null;
  source: ContentSourceDescriptor | null;
  /** 生效挂载（local 时为空对象：不使用 mounts） */
  mounts: ContentMounts;
  /** 被 `null | false` 显式关闭的挂载键 */
  disabledMounts: string[];
  /** 非法挂载项：保留默认值并落证据，不抛错 */
  invalidMounts: InvalidMountEntry[];
  /** manifest `keep` 白名单（POSIX 相对） */
  keep: string[];
  /** 默认 true：同步时裁剪代码仓内容落点 */
  prune: boolean;
  /** 绝对路径，**仅供后端内部使用**（local ⇒ root 本身） */
  contentRoot: string;
  /** `<contentRoot>/config` —— Shirone `config/<域>.yaml` 落点 */
  configDirInContent: string;
  /** `<contentRoot>/overrides` —— Mizuki HEAD `overrides/<导出名>.ts` 落点 */
  overridesDirInContent: string;
  lock: ContentLockSummary;
  evidence: ThemeProbeEvidence[];
}

/** 目录判定（不存在 / 权限不足 → false，不抛） */
function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** 文件判定（不存在 / 权限不足 → false，不抛） */
function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [env 对齐] 环境文件读取（上游 `resolve-source.mjs:396-441`）
// ─────────────────────────────────────────────────────────────────────────────

/** 主题根下的环境文件，**顺序即优先级**（后者覆盖前者；上游 `for (const file of [...])`） */
export const ENV_FILES = ['.env', '.env.local'] as const;

/** 「显式关闭」取值（上游 `DISABLED_VALUES`） */
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);

/** 关闭判据（上游 `isDisabled`：trim + toLowerCase 后命中关闭表） */
function isDisabled(value: string | undefined): boolean {
  return value !== undefined && DISABLED_VALUES.has(value.trim().toLowerCase());
}

/**
 * 生效环境视图：**只读**，不写 `process.env`（常驻服务零全局副作用）。
 * 取值口径与上游一致 —— 进程 env 优先（上游先快照 `inheritedEnvKeys`，
 * 已继承的键**永不**被文件覆盖），文件之间 `.env.local` 覆盖 `.env`。
 */
export interface ThemeEnvView {
  /** 进程 env 里已有、因而压过文件的键（调试与证据用，只含键名不含量） */
  readonly inherited: readonly string[];
  /** 实际读到的环境文件（相对文件名，按读取顺序） */
  readonly files: readonly string[];
  /** 生效键 → 来自哪个文件（进程继承的键不记） */
  readonly origins: Readonly<Record<string, string>>;
  /** 读取生效值（上游 `readEnv` 口径：trim，空串等于未设置） */
  read(name: string): string | undefined;
}

/**
 * 解析「进程 env + 主题根 `.env` / `.env.local`」的**只读合并视图**。
 *
 * 解析器逐字复刻上游（`\r?\n` 切行 · 跳空行与 `#` · 第一个 `=` 切键值 · 两端同型引号才剥 ·
 * 键为空跳过）；文件缺失 / 读不了 ⇒ 静默跳过、不抛错。
 * `root` 不是可用目录 ⇒ 不读任何文件（此时仍按进程 env 取值）。
 */
export function resolveThemeEnv(root: string): ThemeEnvView {
  const inherited = Object.keys(process.env);
  const inheritedKeys = new Set(inherited);
  const fileValues = new Map<string, string>();
  const origins: Record<string, string> = {};
  const files: string[] = [];

  if (typeof root === 'string' && root.trim() !== '' && isDirectory(root)) {
    for (const file of ENV_FILES) {
      const envPath = path.join(root, file);
      if (!isFile(envPath)) continue;
      let content: string;
      try {
        content = fs.readFileSync(envPath, 'utf8');
      } catch {
        continue;
      }
      files.push(file);
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let val = trimmed.slice(eqIndex + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key !== '' && !inheritedKeys.has(key)) {
          fileValues.set(key, val);
          origins[key] = file;
        }
      }
    }
  }

  return {
    inherited,
    files,
    origins,
    read(name: string): string | undefined {
      const raw = inheritedKeys.has(name) ? process.env[name] : fileValues.get(name);
      if (raw === undefined) return undefined;
      const trimmed = raw.trim();
      return trimmed === '' ? undefined : trimmed;
    },
  };
}

/** 读取固定叶子 JSON 文件；缺失、非法 JSON、非对象一律 → null */
function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

/** 取对象里的非空字符串字段（否则 null） */
function readNonEmptyString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

type NormalizedDirectory =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * 归一化挂载目录（逐条照抄上游 `normalizeMountDirectory` 口径）：
 * 必须是相对目录、不许 `..`、不许绝对路径、不许 `.`（保留目录）。
 */
function normalizeMountDirectory(value: string, label: string): NormalizedDirectory {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, reason: `${label} must be a non-empty string.` };
  }
  const raw = value.trim();
  const rawSegments = toPosix(raw).split('/');
  const normalized = toPosix(path.normalize(raw)).replace(/\/$/, '');
  if (
    path.isAbsolute(raw) ||
    path.win32.isAbsolute(raw) ||
    normalized === '.' ||
    rawSegments.includes('..') ||
    normalized.split('/').includes('..')
  ) {
    return { ok: false, reason: `${label} must be a relative directory without "..", received ${value}.` };
  }
  return { ok: true, value: normalized };
}

/** 单键边界校验（照抄上游 `validateMountBoundaries` 前半段）；通过 ⇒ null */
function mountBoundaryError(sourceDir: string, target: string): string | null {
  const sourceRoot = (sourceDir.split('/')[0] ?? '').toLowerCase();
  const targetRoot = (target.split('/')[0] ?? '').toLowerCase();
  if (RESERVED_MOUNT_SOURCE_ROOTS.has(sourceRoot)) {
    return `mounts.${sourceDir} cannot access reserved directory ${sourceRoot}/.`;
  }
  if (target.toLowerCase() === 'src') {
    return `mounts.${sourceDir} points to the entire src/, which is too broad. Please use a more specific target directory.`;
  }
  if (RESERVED_MOUNT_TARGET_ROOTS.has(targetRoot)) {
    return `mounts.${sourceDir} cannot write to reserved directory ${targetRoot}/.`;
  }
  return null;
}

interface MountResolution {
  mounts: ContentMounts;
  disabledMounts: string[];
  invalidMounts: InvalidMountEntry[];
  overridden: string[];
}

/**
 * 解析 mounts：在 `DEFAULT_MOUNTS` 上覆盖；`null | false` ⇒ 消除该项并记入禁用集；
 * 非法项 ⇒ 保留默认值、记入 `invalidMounts`（**不抛错**）。
 */
function resolveMounts(raw: unknown): MountResolution {
  const mounts: ContentMounts = { ...DEFAULT_MOUNTS };
  const disabledMounts: string[] = [];
  const invalidMounts: InvalidMountEntry[] = [];
  const overridden: string[] = [];
  const result = (): MountResolution => ({ mounts, disabledMounts, invalidMounts, overridden });

  if (raw === undefined) return result();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    invalidMounts.push({ key: 'mounts', reason: `${MANIFEST_FILE} 的 mounts 必须是对象` });
    return result();
  }

  const seen = new Map<string, string>();
  for (const [rawSourceDir, target] of Object.entries(raw as Record<string, unknown>)) {
    const sourceDir = normalizeMountDirectory(
      rawSourceDir,
      `Mount source directory ${JSON.stringify(rawSourceDir)} in mounts`,
    );
    if (!sourceDir.ok) {
      invalidMounts.push({ key: rawSourceDir, reason: sourceDir.reason });
      continue;
    }
    const key = sourceDir.value;
    const duplicate = seen.get(key.toLowerCase());
    if (duplicate !== undefined) {
      invalidMounts.push({
        key,
        reason: `Mount source directories ${JSON.stringify(rawSourceDir)} 与 ${JSON.stringify(duplicate)} 归一化后重复`,
      });
      continue;
    }
    seen.set(key.toLowerCase(), rawSourceDir);

    if (target === null || target === false) {
      delete mounts[key];
      disabledMounts.push(key);
      continue;
    }
    if (typeof target !== 'string' || target.trim() === '') {
      invalidMounts.push({ key, reason: `mounts.${key} must be a non-empty string, null, or false.` });
      continue;
    }
    const normalizedTarget = normalizeMountDirectory(target, `mounts.${key}`);
    if (!normalizedTarget.ok) {
      invalidMounts.push({ key, reason: normalizedTarget.reason });
      continue;
    }
    const boundary = mountBoundaryError(key, normalizedTarget.value);
    if (boundary !== null) {
      invalidMounts.push({ key, reason: boundary });
      continue;
    }
    mounts[key] = normalizedTarget.value;
    overridden.push(key);
  }

  // 交叉重叠（上游 `validateMountBoundaries` 后半段）：上游直接 fail；
  // 只读阶段无法安全裁剪（不知道调用方想要哪一侧），故只标记不裁剪 —— 本批零写盘。
  const entries = Object.entries(mounts);
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const leftEntry = entries[left];
      const rightEntry = entries[right];
      if (leftEntry === undefined || rightEntry === undefined) continue;
      const [leftSource, leftTarget] = leftEntry;
      const [rightSource, rightTarget] = rightEntry;
      const lowerLeft = leftTarget.toLowerCase();
      const lowerRight = rightTarget.toLowerCase();
      const overlappingTarget =
        lowerLeft === lowerRight ||
        lowerLeft.startsWith(`${lowerRight}/`) ||
        lowerRight.startsWith(`${lowerLeft}/`);
      if (overlappingTarget) {
        invalidMounts.push({
          key: `${leftSource},${rightSource}`,
          reason: `Mount targets ${leftTarget}/ and ${rightTarget}/ overlap and would cause overwrites or incorrect pruning.`,
        });
      }
    }
  }

  return result();
}

/** 解析 `content.lock.json`（缺失 / 非法 ⇒ readable:false，全 null；不抛错） */
function readLockSummary(root: string, rootUsable: boolean): ContentLockSummary {
  const empty: ContentLockSummary = {
    readable: false,
    schemaVersion: null,
    syncedAt: null,
    sourceType: null,
    commit: null,
    sourcePath: null,
  };
  if (!rootUsable) return empty;
  const lock = readJsonObject(path.join(root, LOCK_FILE));
  if (lock === null) return empty;

  const source = lock.source;
  const sourceObject =
    typeof source === 'object' && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : null;
  const rawType = sourceObject?.['type'];
  const sourceType = rawType === 'git' ? 'git' : rawType === 'path' ? 'path' : null;
  const rawVersion = lock['schemaVersion'];

  return {
    readable: true,
    schemaVersion: typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : null,
    syncedAt: typeof lock['syncedAt'] === 'string' ? lock['syncedAt'] : null,
    sourceType,
    commit: typeof sourceObject?.['commit'] === 'string' ? (sourceObject['commit'] as string) : null,
    sourcePath: sourceObject === null ? null : readNonEmptyString(sourceObject, 'path'),
  };
}

/**
 * 解析当前主题根的内容源（**纯只读、常数级 IO**，永不抛错）。
 *
 * @param root 主题/项目根目录绝对路径；空串或不存在 ⇒ `mode: 'local'`
 */
export function resolveContentSource(root: string): ContentSourceProfile {
  const evidence: ThemeProbeEvidence[] = [];
  const rootUsable = typeof root === 'string' && root.trim() !== '' && isDirectory(root);
  const rootPath = rootUsable ? root : typeof root === 'string' ? root : '';

  const manifestAbs = rootUsable ? path.join(root, MANIFEST_FILE) : '';
  const manifestPresent = rootUsable && isFile(manifestAbs);
  evidence.push({
    name: 'manifest',
    passed: manifestPresent,
    detail: `${MANIFEST_FILE} ${manifestPresent ? '存在' : '不存在'}`,
  });

  const manifest = manifestPresent ? readJsonObject(manifestAbs) : null;
  const lock = readLockSummary(rootPath, rootUsable);

  // ── schemaVersion ───────────────────────────────────────────────────────────
  const rawVersion = manifest?.['schemaVersion'];
  const declaredVersion =
    typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 1
      ? rawVersion
      : manifest === null
        ? SUPPORTED_SCHEMA_VERSION
        : Number.NaN;
  const versionValid = Number.isInteger(declaredVersion);
  const schemaVersion = versionValid ? declaredVersion : SUPPORTED_SCHEMA_VERSION;
  const versionSupported = versionValid && schemaVersion <= SUPPORTED_SCHEMA_VERSION;
  evidence.push({
    name: 'schema-version',
    passed: versionSupported,
    detail: versionValid
      ? `schemaVersion=${schemaVersion}（支持上限 ${SUPPORTED_SCHEMA_VERSION}）`
      : `schemaVersion 非法（必须是 >= 1 的整数），按 ${SUPPORTED_SCHEMA_VERSION} 处理`,
  });

  // ── 环境视图（`.env` → `.env.local`；进程 env 优先）────────────────────────
  const env = resolveThemeEnv(rootPath);
  const envDisabled = isDisabled(env.read('SHIRONE_CONTENT_SYNC'));
  const envDir = env.read('CONTENT_DIR');
  const envUrl = env.read('CONTENT_REPO_URL');
  const envRef = env.read('CONTENT_REPO_REF');
  const envFileKeys = Object.keys(env.origins);
  evidence.push({
    name: 'env-files',
    passed: env.files.length > 0,
    detail: env.files.length > 0
      ? `${env.files.join('、')} 已读取（其中生效键 ${envFileKeys.length} 项）`
      : `未发现 ${ENV_FILES.join(' / ')}（只用进程环境变量）`,
  });

  // ── source（优先级：CONTENT_DIR > CONTENT_REPO_URL > 清单 source）───────────
  let source: ContentSourceDescriptor | null = null;
  let sourceOrigin: string | null = null;
  const rawSource = manifest?.['source'];
  const sourceObject =
    typeof rawSource === 'object' && rawSource !== null && !Array.isArray(rawSource)
      ? (rawSource as Record<string, unknown>)
      : null;
  if (!envDisabled) {
    if (envDir !== undefined) {
      source = { type: 'path', path: envDir };
      sourceOrigin = 'CONTENT_DIR';
    } else if (envUrl !== undefined) {
      source = {
        type: 'git',
        url: envUrl,
        ref: envRef ?? readNonEmptyString(sourceObject ?? {}, 'ref') ?? 'main',
      };
      sourceOrigin = 'CONTENT_REPO_URL';
    } else if (sourceObject !== null) {
      const declaredType = sourceObject['type'];
      if (declaredType === 'path') {
        const declaredPath = readNonEmptyString(sourceObject, 'path');
        if (declaredPath !== null) {
          source = { type: 'path', path: declaredPath };
          sourceOrigin = MANIFEST_FILE;
        }
      } else if (declaredType === 'git') {
        const declaredUrl = readNonEmptyString(sourceObject, 'url');
        if (declaredUrl !== null) {
          source = {
            type: 'git',
            url: declaredUrl,
            ref: envRef ?? readNonEmptyString(sourceObject, 'ref') ?? 'main',
          };
          sourceOrigin = MANIFEST_FILE;
        }
      }
    }
  }
  evidence.push({
    name: 'source-type',
    passed: source !== null,
    detail: envDisabled
      ? 'SHIRONE_CONTENT_SYNC 被显式关闭：本次不解析内容源'
      : source === null
        ? `${MANIFEST_FILE} 未声明可用的 source（type 必须是 path 或 git），CONTENT_DIR / CONTENT_REPO_URL 也未设置`
        : `source.type=${source.type}（来源 ${sourceOrigin ?? '未知'}）`,
  });

  // ── mode 判定 ───────────────────────────────────────────────────────────────
  const external = !envDisabled && source !== null;
  let mode: ContentSourceMode = external ? 'external' : 'local';
  let reason: string | null = null;
  if (envDisabled) {
    reason = 'SHIRONE_CONTENT_SYNC 被显式关闭（0 / false / off / no）：不启用内容分离，按本地模式处理';
  } else if (!external) {
    reason = manifest === null
      ? `${MANIFEST_FILE} 不存在，且未设置 CONTENT_DIR / CONTENT_REPO_URL，主题仓自持内容`
      : `${MANIFEST_FILE} 未声明可用的 source，主题仓自持内容`;
  } else if (!versionSupported) {
    reason = versionValid
      ? `${MANIFEST_FILE} 声明 schemaVersion ${schemaVersion}，超出支持上限 ${SUPPORTED_SCHEMA_VERSION}：不支持的清单版本`
      : `${MANIFEST_FILE} 的 schemaVersion 非法：不支持的清单版本`;
  }

  // ── mounts ─────────────────────────────────────────────────────────────────
  const mountResolution = external
    ? resolveMounts(manifest?.['mounts'])
    : { mounts: {}, disabledMounts: [], invalidMounts: [], overridden: [] };
  const mountsDetail = [
    mode === 'local'
      ? 'mode=local，不使用 mounts'
      : `覆盖 ${mountResolution.overridden.length} 项${mountResolution.overridden.length > 0 ? `（${mountResolution.overridden.join(', ')}）` : ''}`,
    mountResolution.disabledMounts.length > 0
      ? `禁用 ${mountResolution.disabledMounts.join(', ')}`
      : '无禁用项',
    mountResolution.invalidMounts.length > 0
      ? `非法 ${mountResolution.invalidMounts.length} 项（保留默认值）`
      : '无非法项',
  ].join('；');
  evidence.push({
    name: 'mounts',
    passed: mountResolution.invalidMounts.length === 0,
    detail: mountsDetail,
  });

  // ── content.lock.json ──────────────────────────────────────────────────────
  evidence.push({
    name: 'content-lock',
    passed: lock.readable,
    detail: lock.readable
      ? `${LOCK_FILE} 可读（source.type=${lock.sourceType ?? '未知'}）`
      : `${LOCK_FILE} 缺失或不可读`,
  });

  // ── contentRoot ────────────────────────────────────────────────────────────
  let contentRoot = rootPath;
  if (mode === 'external') {
    if (source !== null && source.type === 'git') {
      contentRoot = path.join(rootPath, WORKING_COPY_DIR);
    } else {
      // path 型：先信 manifest，再退化到 lock 记录的路径（用户可能只 sync 过没留 manifest 变更）
      const declaredPath = source !== null && source.type === 'path' ? source.path : lock.sourcePath;
      if (declaredPath !== null && declaredPath.trim() !== '') {
        contentRoot = path.resolve(rootPath, declaredPath);
      } else {
        // 无从得知内容仓位置：不猜，退回主题根并把原因写明
        mode = 'local';
        reason = `${MANIFEST_FILE} 的 source.type=path 但未给出可用路径，且 ${LOCK_FILE} 无记录`;
      }
    }
  }

  // ── keep / prune ───────────────────────────────────────────────────────────
  const rawKeep = manifest?.['keep'];
  const keep = Array.isArray(rawKeep)
    ? rawKeep.filter((item): item is string => typeof item === 'string').map(toPosix)
    : [];
  const prune = manifest?.['prune'] !== false;

  return {
    mode,
    schemaVersion,
    supported: versionSupported,
    reason,
    manifestPath: manifestPresent ? MANIFEST_FILE : null,
    source,
    mounts: mountResolution.mounts,
    disabledMounts: mountResolution.disabledMounts,
    invalidMounts: mountResolution.invalidMounts,
    keep,
    prune,
    contentRoot,
    configDirInContent: path.join(contentRoot, CONFIG_DIR_IN_CONTENT),
    overridesDirInContent: path.join(contentRoot, OVERRIDES_DIR_IN_CONTENT),
    lock,
    evidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [T5b-1] 内容挂载点寻址底座（L0 单一来源）
//
// 背景：`config`（T3b）、`posts`（T4-3b）、将来的 `series` / `moments`（T5b）与 `T4-4`
// 都要回答同一个问题 ——「这类内容在当前主题档下，**哪个目录**才是持久的落点」。
// 此前 `config-write-target.ts` 与 `posts-write-target.ts` 各自内联了一份
// `.env` 读取与 `CONTENT_DIR` 解析（靠注释互指保证一致），这是**分叉隐患**。
// ⇒ 本节把它们收敛为 L0 导出，供四条线共用。
//
// 两条**方向相反**的上游事实必须分开表达，不能合用一个函数：
//   - **Mizuki HEAD**（`scripts/load-env.js`）：唯一环境文件 `.env`，且**文件键压过进程 env**；
//   - **Shirone**（`resolve-source.mjs:396-441`）：`.env` → `.env.local`，且**进程 env 优先**。
// 若强行统一成一种，两边必有一边与上游劈叉。故提供两个具名读取器。
// ─────────────────────────────────────────────────────────────────────────────

/** Mizuki HEAD 侧环境读取器（`.env` 单文件；**文件键压过进程 env**） */
export type HeadEnvReader = (name: string) => string | undefined;

/**
 * [T5b-1] Mizuki HEAD 口径的环境读取器（上游 `scripts/load-env.js` 解析器逐字复刻）：
 * `split('\n')` 切行 · `trim` 后跳空行与 `#` · `/^([^=]+)=(.*)$/` 取第一个 `=` 前的键 ·
 * 值 `trim` 后去掉「各一个」首尾引号（不校验配对）。
 *
 * ⚠ **文件键压过进程 env** —— 与 `resolveThemeEnv()`（Shirone 口径）**方向相反**。
 * 上游是 `process.env[key] = value` 无条件赋值；本文件只构造只读视图，**不写 `process.env`**。
 * 文件不存在 / 读不了 ⇒ 全部退回进程 env（不抛错）。
 */
export function resolveHeadEnv(root: string): HeadEnvReader {
  const fileValues = new Map<string, string>();
  if (typeof root === 'string' && root.trim() !== '') {
    try {
      const content = fs.readFileSync(path.join(root, '.env'), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match === null) continue;
        const key = (match[1] ?? '').trim();
        if (key === '') continue;
        fileValues.set(key, (match[2] ?? '').trim().replace(/^["']|["']$/g, ''));
      }
    } catch {
      // 文件不存在 / 读不了 ⇒ 静默跳过（上游同样静默）
    }
  }
  return (name: string): string | undefined =>
    fileValues.has(name) ? fileValues.get(name) : process.env[name];
}

/**
 * [T5b-1] Mizuki HEAD 侧「内容目录」解析（上游 `sync-content.js:17` 口径）。
 *
 * 上游：`const CONTENT_DIR = process.env.CONTENT_DIR || path.join(rootDir, "content")`，
 * 随后把它**原样**用于 `existsSync` / `path.join(CONTENT_DIR, src)` / `git clone` / `cwd`
 * ——全仓**没有**二次 `join(rootDir, CONTENT_DIR)`。
 * ⇒ 绝对值**原样**采用；相对值按 CWD 解析（上游由 pnpm 以主题根为 CWD 调用 ⇒ 等价 `join(root, value)`）。
 *
 * **[勿改回「一律 `join(root, value)`」]** 那会把合法的绝对 `CONTENT_DIR` 拼成
 * `<root>\<盘符>:\x` 这类不存在的路径，于是把**能正常同步**的配置误判成「无内容目录」而拒绝
 * ——正是「Kova 判定的目录与上游实际读取的目录劈叉」那种错（ADR-028 §17 已记一次同类事故）。
 */
export function resolveHeadContentDir(root: string, readEnv: HeadEnvReader): string {
  const raw = readEnv('CONTENT_DIR');
  if (raw === undefined || raw === '') return path.join(root, 'content');
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

/** 内容子目录名（`series` / `moments` / `spec` / `posts` 均落在 `src/content/<名>` 之下） */
export type ContentSubdir = 'posts' | 'series' | 'moments' | 'spec';

/** 子目录寻址失败的原因（取值固定；调用方按它选文案，不做字符串推断） */
export type ContentSubdirRejectionReason =
  /** 主题形态不是 Shirone ⇒ 该子集合在本档不存在 */
  | 'not-shirone'
  /** 清单 `schemaVersion` 超支持上限 ⇒ 无法判断落点，一律拒绝 */
  | 'manifest-unsupported-version'
  /** `mounts.content` 被显式关闭（`null` / `false`）⇒ 该挂载点不参与同步 */
  | 'content-mount-disabled'
  /** `mounts` 有非法项 ⇒ 无法确定真实落点（宁可拒绝，不猜） */
  | 'mounts-invalid'
  /** 内容源是 git ⇒ 工作副本随时被 `checkout --force` + `clean -ffdx` 覆盖 */
  | 'content-source-git'
  /** 内容仓根无法确定（path 型但无可用路径，且 lock 无记录） */
  | 'content-root-unknown';

/** 子目录寻址成功 */
export interface ContentSubdirOk {
  ok: true;
  /** 持久落点的绝对路径（内容仓内），**仅供后端内部使用**（仓规红线 6） */
  dirAbs: string;
  /** 写入后是否必须跑一次内容同步才在代码仓生效（内容仓落点恒 true） */
  needsSync: boolean;
  /** 是否落在内容仓（external）而非代码仓 */
  inContentRepo: boolean;
  /** 生效的挂载目标（代码仓侧），如 `src/content` */
  mountTarget: string;
}

/** 子目录寻址失败 */
export interface ContentSubdirRejected {
  ok: false;
  reason: ContentSubdirRejectionReason;
  /** 人话说明**下一步怎么做**；不含任何绝对路径 */
  message: string;
}

export type ContentSubdirResolution = ContentSubdirOk | ContentSubdirRejected;

function rejectSubdir(
  reason: ContentSubdirRejectionReason,
  message: string,
): ContentSubdirRejected {
  return { ok: false, reason, message };
}

/**
 * [T5b-1] 解析 `series` / `moments` / `spec` / `posts` 在 **Shirone 内容分离**下的持久落点。
 *
 * 语义（逐条对齐上游 `resolveMounts` + `syncMount`）：
 * - 挂载键 `content` 的目标目录（默认 `src/content`）就是要找的代码仓侧落点；
 *   内容仓侧对应 `<contentRoot>/content/<subdir>`。
 * - `mounts.content === null | false` ⇒ 该挂载点被**显式关闭**：上游 `mounts.delete(key)`
 *   后这个子目录根本不会被同步，写进去既不会被物化、也不会被裁剪 —— 是一条**死路**，
 *   必须拒绝并说明（不能静默当作 local）。
 * - `mounts` 有非法项 ⇒ 上游对非法项**保留默认值**，但本服务无从判断用户真实意图，
 *   宁可拒绝也不猜（与 T3b-1 同口径，理由见 `config-write-target.ts` 头部 ③）。
 * - git 源 ⇒ 工作副本每次 sync 被 `checkout --force` + `clean -ffdx`，写入必丢。
 *
 * @param root 主题根绝对路径
 * @param subdir 内容子目录名
 */
export function resolveContentSubdirTarget(
  root: string,
  subdir: ContentSubdir,
): ContentSubdirResolution {
  const profile = resolveContentSource(root);

  if (profile.mode === 'local') {
    // local：主题仓自持内容，落点就是代码仓自己的 src/content/<subdir>
    return {
      ok: true,
      dirAbs: path.join(root, 'src', 'content', subdir),
      needsSync: false,
      inContentRepo: false,
      mountTarget: 'src/content',
    };
  }

  if (!profile.supported) {
    return rejectSubdir(
      'manifest-unsupported-version',
      `${MANIFEST_FILE} 声明的 schemaVersion 超出本服务支持的上限：本服务无法判断内容仓的真实落点，因此不能安全地读写该内容集合。下一步：把 ${MANIFEST_FILE} 的 schemaVersion 改回受支持的版本，或先升级本服务。`,
    );
  }

  if (profile.invalidMounts.length > 0) {
    return rejectSubdir(
      'mounts-invalid',
      `${MANIFEST_FILE} 的 mounts 存在 ${profile.invalidMounts.length} 项非法配置：本服务无从判断这些挂载点究竟指向哪里，写入可能落在不会被同步的目录里。下一步：按 ${MANIFEST_FILE} 的 mounts 规范修正这些键（必须是相对目录、不能含 ".."、不能指向保留目录），然后重试。`,
    );
  }

  if (profile.disabledMounts.includes('content')) {
    return rejectSubdir(
      'content-mount-disabled',
      `${MANIFEST_FILE} 把 mounts.content 显式关闭了（null / false）：内容同步不会处理 src/content 这个挂载点，写进去的文章既不会被物化到主题、也不会被裁剪——是一条死路。下一步：从 ${MANIFEST_FILE} 的 mounts 里删掉 content 那一项（恢复默认的 content → src/content 映射），然后重试。`,
    );
  }

  const mountTarget = profile.mounts['content'];
  if (mountTarget === undefined) {
    // 理论上不可达（默认表含 content，且禁用分支已在上面拦截）；保持诚实的不可能分支
    return rejectSubdir(
      'content-mount-disabled',
      `${MANIFEST_FILE} 未提供 content 挂载点的目标目录：本服务无法判断内容落点。下一步：在 mounts 里显式声明 content 的目标目录。`,
    );
  }

  if (profile.source !== null && profile.source.type === 'git') {
    return rejectSubdir(
      'content-source-git',
      '当前内容源是 git 仓库：内容仓工作副本每次同步都会被强制检出并清理（git checkout --force + git clean -ffdx），直接写进去的文件会消失。下一步：把内容仓克隆到本地并把内容源改成 path 类型（或在本地内容仓提交改动后让它自行拉取），本服务只对本地路径源提供写入。',
    );
  }

  // path 型但 contentRoot 退回了主题根（resolveContentSource 无从得知内容仓位置时不会降级 mode）
  if (profile.source === null) {
    return rejectSubdir(
      'content-root-unknown',
      `${MANIFEST_FILE} 未声明可用的内容源路径，且 ${LOCK_FILE} 没有记录内容仓位置：本服务无从确定持久落点。下一步：在 ${MANIFEST_FILE} 的 source 里写明内容仓的本地路径（type: "path"），或先跑一次内容同步生成 ${LOCK_FILE}。`,
    );
  }

  return {
    ok: true,
    dirAbs: path.join(profile.contentRoot, 'content', subdir),
    needsSync: true,
    inContentRepo: true,
    mountTarget,
  };
}
