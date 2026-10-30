/**
 * [T2] common/theme/theme-adapter — 主题识别与能力画像（纯只读探测，L0 单源）
 * [来源] 逐字下沉自 modules/theme/theme-adapter.service.ts（T1 实现不改一行），
 *   因为 L2 的 collections 需要「按当前主题 kind 取集合表」：L2 之间禁止互导
 *   （boundaries 硬约束），实现只能落在 L0。原文件保留为薄装饰器子类。
 * [职责] resolve(root, serverMode) → ThemeAdapterProfile：识别主题**形态**（三档：mizuki-legacy /
 *   mizuki HEAD / shirone；mizuki 两形态 kind 均为 'mizuki'，靠 layout 与 capabilities.config 区分），
 *   逐条落证据，再按档位回传固定能力画像。判据与能力均为**实现内单源**（本文件常量），
 *   schema 契约在 packages/shared/src/theme-adapter.ts。
 * [T3a] 三档形态判定阶梯（每步都是固定叶子 statSync，**禁止递归遍历**）：
 *   1. `src/config.ts` 是文件 → **mizuki-legacy**（6.1.2，单文件形态）；
 *   2. `src/config/overrideLoader.ts` 是文件 → **mizuki HEAD**（7.1.3，目录形态 + overrides 侧车）；
 *   3. `src/config/integrationsConfig.ts` 是文件，或 `src/integration/index.ts` 是文件 → **shirone**；
 *   4. 包名/依赖命中 shirone 但 1–3 全不成立 → **包模式，降级 unknown**（Q2 裁定不支持）；
 *   5. `astro` 依赖 + `astro.config.*` +（`src/config.ts` | `src/data/diary.ts`）→ mizuki-legacy
 *      （**既有兜底分支，逻辑不变**：存量 fixture 无 `src/config.ts` 但有 `src/data/diary.ts`，load 行为零变化）；
 *   6. 否则 → **unknown**。
 * [为什么不能用「src/config/ 是目录 + siteConfig.ts 是文件」判 shirone] 实测 Mizuki HEAD 的
 *   `src/config/` 里也有 `siteConfig.ts` 与 `index.ts`（两档 `src/config/*.ts` 有 12 个文件名完全重合）
 *   ⇒ 旧判据会把 HEAD 判成 shirone、拿 overlay-yaml 去写 Shirone 的 `config/<域>.yaml`（写错地方）。
 *   唯一可靠的判别子是上面 1–3 的三个固定叶子。
 * [Q2 裁定] shirone **npm 包模式**（依赖含 shirones 但项目根无源码形态叶子）
 *   当前阶段不支持 → 降级 kind='unknown' + unknownCapabilities()，并单独落一条
 *   `shirone-package-mode` 证据（相对路径明细，禁绝对路径）。仅**源码仓模式**判 shirone。
 * [Q4 透传] serverMode 为可选入参（默认 'manage'）：模式是 Kova 自身配置、与主题无关，
 *   由调用方注入而非适配器 import getAppConfig（保持 L0 纯函数可测）。
 *   当前 enforcement 恒为 'declared-only'——服务端对 mode 零行为分支（审计结论）。
 * [探测口径] 只做「存在性 + 少量文件读取」：statSync 命中的都是固定叶子路径，
 *   **不做任何递归遍历**（大树主题下也常数级 IO）；只读，零写盘。
 * [T3a 边界] 本文件只做**判定 + 策略声明**（含可写配置名名单 domains）：**零写入器**，
 *   不生成、不解析任何覆盖文件内容。
 * [失败语义] root 为空串或不存在 → kind='unknown'，不抛错（健康探测不得因未初始化而 500）。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  type ThemeAdapterProfile,
  type ThemeCapabilities,
  type ThemeLayout,
  type ThemeMode,
  type ThemeProbeEvidence,
} from '@mizuki/shared';
import { SHIRONE_CONFIG_DOMAIN_KEYS } from './config-domains';

/** 探测命中的固定叶子路径（相对 root，POSIX 形态） */
const P = {
  packageJson: 'package.json',
  mizukiConfigFile: 'src/config.ts',
  mizukiDiary: 'src/data/diary.ts',
  mizukiHeadOverrideLoader: 'src/config/overrideLoader.ts',
  shironeIntegrationsConfig: 'src/config/integrationsConfig.ts',
  shironeIntegrationIndex: 'src/integration/index.ts',
  astroConfig: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'],
} as const;

/** shirone 身份依赖名（package.json dependencies / devDependencies） */
const SHIRONE_PACKAGE_NAMES = ['shirones'] as const;

/**
 * mizuki HEAD（7.1.3）可覆盖配置名 —— 逐字、顺序照抄上游 `src/config/overrideLoader.ts`
 * 的 `OVERRIDABLE_CONFIGS`。⚠ **覆盖文件名 = 覆盖名**，不是源文件名
 * （如 `sakuraConfig` 覆盖的是 `effectsConfig.ts`）。本批只声明名单。
 */
const MIZUKI_HEAD_CONFIG_DOMAINS = [
  'siteConfig',
  'fullscreenWallpaperConfig',
  'navBarConfig',
  'profileConfig',
  'licenseConfig',
  'permalinkConfig',
  'expressiveCodeConfig',
  'commentConfig',
  'shareConfig',
  'announcementConfig',
  'musicPlayerConfig',
  'footerConfig',
  'sidebarLayoutConfig',
  'sakuraConfig',
  'pioConfig',
  'relatedPostsConfig',
  'randomPostsConfig',
  'markdownConfig',
] as const;

/** 逐字照抄上游 scripts/content/config-domains.mjs 的 CONFIG_DOMAINS（现由 config-domains.ts 单源持有） */
const SHIRONE_CONFIG_DOMAINS = SHIRONE_CONFIG_DOMAIN_KEYS;

/** 形状投影（各档固定；unknown 全空） */
const MIZUKI_LAYOUT: Omit<ThemeLayout, 'root'> = {
  kind: 'mizuki',
  configDir: 'src',
  configFile: P.mizukiConfigFile,
  dataDir: 'src/data',
  contentDir: 'src/content',
  postsDir: 'src/content/posts',
  publicDir: 'public',
};

/**
 * [T3a] mizuki HEAD 形状：配置在 `src/config/` 目录（无常量单文件），其余与 legacy 相同。
 * 集合表等能力面在两形态下完全相同 ⇒ 区分只落在 configDir/configFile 与 config.strategy 上。
 */
const MIZUKI_HEAD_LAYOUT: Omit<ThemeLayout, 'root'> = {
  kind: 'mizuki',
  configDir: 'src/config',
  configFile: null,
  dataDir: 'src/data',
  contentDir: 'src/content',
  postsDir: 'src/content/posts',
  publicDir: 'public',
};

const SHIRONE_LAYOUT: Omit<ThemeLayout, 'root'> = {
  kind: 'shirone',
  configDir: 'src/config',
  configFile: null,
  dataDir: 'src/data',
  contentDir: 'src/content',
  postsDir: 'src/content/posts',
  publicDir: 'public',
};

const UNKNOWN_LAYOUT: Omit<ThemeLayout, 'root'> = {
  kind: 'unknown',
  configDir: '',
  configFile: null,
  dataDir: '',
  contentDir: '',
  postsDir: '',
  publicDir: '',
};

/** 每档能力画像以工厂形式返回：调用方拿到的是独立副本，避免跨请求共享可变对象 */
function mizukiCapabilities(serverMode: ThemeMode): ThemeCapabilities {
  return {
    // 可写面由既有 site-config 契约（受控子集）持有，故 domains 留空，避免两处真源
    config: { supported: true, strategy: 'ts-morph-declaration', domains: [] },
    dataFiles: {
      supported: true,
      collections: ['diary', 'friends', 'projects', 'timeline', 'skills', 'devices', 'anime'],
    },
    posts: { supported: true, extensions: ['.md'], frontmatterSchemaId: 'mizuki-posts' },
    contentCollections: { supported: false, ids: [] },
    themeLock: { supported: true, profileId: 'mizuki-tier1' },
    serverMode: { mode: serverMode, enforcement: 'declared-only' },
  };
}

/**
 * [T3a] mizuki HEAD 能力：仅 config 组换成 overlay-ts + 18 个覆盖名；
 * 其余四组与 mizukiCapabilities() 逐字一致（同一批集合表 / 同一 posts 面 / 同一 themeLock 档）。
 */
function mizukiHeadCapabilities(serverMode: ThemeMode): ThemeCapabilities {
  return {
    config: {
      supported: true,
      strategy: 'overlay-ts',
      domains: [...MIZUKI_HEAD_CONFIG_DOMAINS],
    },
    dataFiles: {
      supported: true,
      collections: ['diary', 'friends', 'projects', 'timeline', 'skills', 'devices', 'anime'],
    },
    posts: { supported: true, extensions: ['.md'], frontmatterSchemaId: 'mizuki-posts' },
    contentCollections: { supported: false, ids: [] },
    themeLock: { supported: true, profileId: 'mizuki-tier1' },
    serverMode: { mode: serverMode, enforcement: 'declared-only' },
  };
}

function shironeCapabilities(serverMode: ThemeMode): ThemeCapabilities {
  return {
    config: { supported: true, strategy: 'overlay-yaml', domains: [...SHIRONE_CONFIG_DOMAINS] },
    dataFiles: {
      supported: true,
      collections: [
        'friends',
        'projects',
        'timeline',
        'skills',
        'devices',
        'anime',
        'compass',
        'games',
        'music',
      ],
    },
    posts: {
      supported: true,
      extensions: ['.md', '.mdx'],
      frontmatterSchemaId: 'shirone-posts',
    },
    contentCollections: { supported: true, ids: ['series', 'moments'] },
    themeLock: { supported: true, profileId: 'shirone-tier1' },
    serverMode: { mode: serverMode, enforcement: 'declared-only' },
  };
}

function unknownCapabilities(serverMode: ThemeMode): ThemeCapabilities {
  return {
    config: { supported: false, strategy: 'none', domains: [] },
    dataFiles: { supported: false, collections: [] },
    posts: { supported: false, extensions: [], frontmatterSchemaId: '' },
    contentCollections: { supported: false, ids: [] },
    themeLock: { supported: false, profileId: '' },
    serverMode: { mode: serverMode, enforcement: 'declared-only' },
  };
}

export class ThemeAdapter {
  /** 同步只读探测：按三档形态判定阶梯识别主题并回传 layout + capabilities + 证据链 */
  resolve(root: string, serverMode: ThemeMode = 'manage'): ThemeAdapterProfile {
    const evidence: ThemeProbeEvidence[] = [];

    const rootOk = root.length > 0 && isDirectory(root);
    evidence.push({
      name: 'root',
      passed: rootOk,
      detail: rootOk ? '.' : '主题根缺失或非目录（空串视为未初始化）',
    });
    // unknown 分派：缺失 / 空 / 非法一律不抛错，回传全空能力面
    if (!rootOk) {
      return {
        kind: 'unknown',
        layout: { root, ...UNKNOWN_LAYOUT },
        capabilities: unknownCapabilities(serverMode),
        evidence,
      };
    }

    const pkg = readPackageJson(root);
    const pkgDetail = pkg === null ? `${P.packageJson} 缺失或非法` : P.packageJson;
    evidence.push({ name: 'package-json', passed: pkg !== null, detail: pkgDetail });

    // --- 形态判定阶梯 1–3：三个固定叶子（互斥的判别子，禁止用 siteConfig.ts 判 shirone） ---
    const legacyConfigFileOk = isFile(path.join(root, P.mizukiConfigFile));
    evidence.push({
      name: 'mizuki-legacy-config-file',
      passed: legacyConfigFileOk,
      detail: P.mizukiConfigFile,
    });

    const headOverrideLoaderOk = isFile(path.join(root, P.mizukiHeadOverrideLoader));
    evidence.push({
      name: 'mizuki-head-override-loader',
      passed: headOverrideLoaderOk,
      detail: P.mizukiHeadOverrideLoader,
    });

    // 阶梯 3：shirone 的固定叶子（HEAD 的 src/config/ 里也有 siteConfig.ts / index.ts，禁用旧判据）
    const shironeSourceMode =
      isFile(path.join(root, P.shironeIntegrationsConfig)) ||
      isFile(path.join(root, P.shironeIntegrationIndex));
    evidence.push({
      name: 'shirone-integrations-config',
      passed: shironeSourceMode,
      detail: `${P.shironeIntegrationsConfig} | ${P.shironeIntegrationIndex}`,
    });

    const ladderHit = legacyConfigFileOk || headOverrideLoaderOk || shironeSourceMode;

    // --- 身份命中（仅作 Q2 包模式降级依据；源码形态由上面三个叶子决定） ---
    const shironeName =
      pkg !== null &&
      (readString(pkg, 'name') === 'shirone' || hasDependency(pkg, SHIRONE_PACKAGE_NAMES));
    evidence.push({
      name: 'shirone-identity',
      passed: shironeName,
      detail: `name === 'shirone' 或依赖含 ${SHIRONE_PACKAGE_NAMES.join('/')}（${pkgDetail}）`,
    });

    // 阶梯 4：npm 包模式（身份命中但形态叶子全不成立）
    // → 内容与配置都在 node_modules 的包内，本服务当前阶段不支持（Q2 裁定）
    const shironePackageMode = shironeName && !ladderHit;
    evidence.push({
      name: 'shirone-package-mode',
      passed: shironePackageMode,
      detail: shironePackageMode
        ? `检测到 ${SHIRONE_PACKAGE_NAMES.join('/')} 依赖/包名但三档形态叶子均未命中（npm 包模式，Q2 裁定不支持）`
        : ladderHit
          ? '三档形态叶子已命中（不按包模式降级）'
          : `未检测到 ${SHIRONE_PACKAGE_NAMES.join('/')} 依赖，且包名非 shirone`,
    });

    // --- 阶梯 5 的兜底条件（mizuki legacy 既有分支，逻辑不变） ---
    const astroDep = pkg !== null && hasDependency(pkg, ['astro']);
    evidence.push({
      name: 'mizuki-astro-dep',
      passed: astroDep,
      detail: `依赖含 astro（${pkgDetail}）`,
    });

    const astroConfig = P.astroConfig.find((name) => isFile(path.join(root, name)));
    evidence.push({
      name: 'mizuki-astro-config',
      passed: astroConfig !== undefined,
      detail: astroConfig ?? `${P.astroConfig.join(' | ')} 均不存在`,
    });

    const mizukiDiaryOk = isFile(path.join(root, P.mizukiDiary));
    evidence.push({
      name: 'mizuki-config-or-diary',
      passed: legacyConfigFileOk || mizukiDiaryOk,
      detail: P.mizukiConfigFile + ' | ' + P.mizukiDiary,
    });

    // --- 阶梯分派：1 legacy → 2 HEAD → 3 shirone → 4 包模式 unknown → 5 legacy 兜底 → 6 unknown ---
    if (legacyConfigFileOk) {
      return {
        kind: 'mizuki',
        layout: { root, ...MIZUKI_LAYOUT },
        capabilities: mizukiCapabilities(serverMode),
        evidence,
      };
    }

    if (headOverrideLoaderOk) {
      return {
        kind: 'mizuki',
        layout: { root, ...MIZUKI_HEAD_LAYOUT },
        capabilities: mizukiHeadCapabilities(serverMode),
        evidence,
      };
    }

    if (shironeSourceMode) {
      return {
        kind: 'shirone',
        layout: { root, ...SHIRONE_LAYOUT },
        capabilities: shironeCapabilities(serverMode),
        evidence,
      };
    }

    if (shironeName) {
      return {
        kind: 'unknown',
        layout: { root, ...UNKNOWN_LAYOUT },
        capabilities: unknownCapabilities(serverMode),
        evidence,
      };
    }

    if (astroDep && astroConfig !== undefined && (legacyConfigFileOk || mizukiDiaryOk)) {
      return {
        kind: 'mizuki',
        layout: { root, ...MIZUKI_LAYOUT },
        capabilities: mizukiCapabilities(serverMode),
        evidence,
      };
    }

    return {
      kind: 'unknown',
      layout: { root, ...UNKNOWN_LAYOUT },
      capabilities: unknownCapabilities(serverMode),
      evidence,
    };
  }
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

/** 读取 root/package.json；缺失、非法 JSON、非对象一律 → null */
function readPackageJson(root: string): Record<string, unknown> | null {
  const file = path.join(root, P.packageJson);
  if (!isFile(file)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 取对象里的字符串字段（非字符串 → null） */
function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

/** 依赖判定：dependencies 或 devDependencies 含任一给定名 */
function hasDependency(pkg: Record<string, unknown>, names: readonly string[]): boolean {
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const section = pkg[field];
    if (typeof section !== 'object' || section === null || Array.isArray(section)) continue;
    const record = section as Record<string, unknown>;
    for (const name of names) {
      if (typeof record[name] === 'string') return true;
    }
  }
  return false;
}
