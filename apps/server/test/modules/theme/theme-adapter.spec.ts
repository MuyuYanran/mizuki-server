import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ThemeAdapterProfileSchema,
  type ThemeCapabilities,
  type ThemeMode,
} from '../../../../../packages/shared/src/theme-adapter';
import { ThemeAdapterService } from '../../../src/modules/theme/theme-adapter.service';

/**
 * T1 单元层：ThemeAdapterService 两档识别 + 能力画像核对。
 * 全部 fixture 落在 mkdtemp 临时域（仓规红线 9：绝不对真实主题目录做任何操作），
 * 本 spec 对临时域亦只写一次、只读探测。
 * [T3] 追加：shirone npm 包模式降级 unknown（Q2）+ mode 透传（Q4）。
 * [T3a] 追加：配置面三档形态判定（mizuki-legacy / mizuki HEAD / shirone）+ 策略与可写名单
 *   `capabilities.config.domains` 声明；**只做判定，不做任何写入**。
 */

/** T3：三档画像的 serverMode 组恒为声明态（当前服务端对 mode 零行为分支） */
function declaredOnly(mode: ThemeMode = 'manage'): ThemeCapabilities['serverMode'] {
  return { mode, enforcement: 'declared-only' };
}

/** [T3a] Mizuki HEAD（7.1.3）18 个可覆盖名（逐字，顺序照抄上游 overrideLoader.OVERRIDABLE_CONFIGS） */
const MIZUKI_HEAD_DOMAINS = [
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
];

/** [T3a] shirone 32 个配置域 key（逐字照抄上游 scripts/content/config-domains.mjs 的 CONFIG_DOMAINS） */
const SHIRONE_DOMAINS = [
  'site',
  'permalink',
  'profile',
  'license',
  'expressiveCode',
  'announcement',
  'postList',
  'article',
  'comment',
  'contextMenu',
  'fab',
  'sidebar',
  'footer',
  'imageBloom',
  'skills',
  'projects',
  'timeline',
  'devices',
  'games',
  'music',
  'anime',
  'font',
  'llms',
  'umami',
  'about',
  'friends',
  'moments',
  'albums',
  'compass',
  'i18n',
  'series',
  'navBar',
];

const MIZUKI_CAPABILITIES: ThemeCapabilities = {
  config: { supported: true, strategy: 'ts-morph-declaration', domains: [] },
  dataFiles: {
    supported: true,
    collections: ['diary', 'friends', 'projects', 'timeline', 'skills', 'devices', 'anime'],
  },
  posts: { supported: true, extensions: ['.md'], frontmatterSchemaId: 'mizuki-posts' },
  contentCollections: { supported: false, ids: [] },
  themeLock: { supported: true, profileId: 'mizuki-tier1' },
  serverMode: declaredOnly(),
};

/** [T3a] mizuki HEAD 画像：仅 config 组换 overlay-ts + 18 个覆盖名，其余四组与 legacy 一致 */
const MIZUKI_HEAD_CAPABILITIES: ThemeCapabilities = {
  ...MIZUKI_CAPABILITIES,
  config: { supported: true, strategy: 'overlay-ts', domains: MIZUKI_HEAD_DOMAINS },
};

const SHIRONE_CAPABILITIES: ThemeCapabilities = {
  config: { supported: true, strategy: 'overlay-yaml', domains: SHIRONE_DOMAINS },
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
  posts: { supported: true, extensions: ['.md', '.mdx'], frontmatterSchemaId: 'shirone-posts' },
  contentCollections: { supported: true, ids: ['series', 'moments'] },
  themeLock: { supported: true, profileId: 'shirone-tier1' },
  serverMode: declaredOnly(),
};

const UNKNOWN_CAPABILITIES: ThemeCapabilities = {
  config: { supported: false, strategy: 'none', domains: [] },
  dataFiles: { supported: false, collections: [] },
  posts: { supported: false, extensions: [], frontmatterSchemaId: '' },
  contentCollections: { supported: false, ids: [] },
  themeLock: { supported: false, profileId: '' },
  serverMode: declaredOnly(),
};

function makeTempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

/** 仿 Mizuki：astro 依赖 + astro.config.mjs + src/config.ts + src/data/diary.ts + src/content/posts */
function buildMizukiFixture(): string {
  const root = makeTempRoot('theme-adapter-mizuki-');
  writeFile(
    root,
    'package.json',
    JSON.stringify({ name: 'mizuki-blog', dependencies: { astro: '^5.0.0' } }, null, 2),
  );
  writeFile(root, 'astro.config.mjs', 'export default {};\n');
  writeFile(root, 'src/config.ts', 'export const siteConfig = {};\n');
  writeFile(root, 'src/data/diary.ts', 'export const diaryData = [];\n');
  fs.mkdirSync(path.join(root, 'src/content/posts'), { recursive: true });
  return root;
}

/**
 * 仿 Shirone：package.json name=shirone + src/config/{integrationsConfig,siteConfig}.ts
 * + src/data/friends.ts + content。
 * [T3a] `siteConfig.ts` 保留但**已不是判据**（Mizuki HEAD 的 src/config/ 里也有它）；
 * 源码形态的判别子是 `src/config/integrationsConfig.ts`。
 */
function buildShironeFixture(): string {
  const root = makeTempRoot('theme-adapter-shirone-');
  writeFile(root, 'package.json', JSON.stringify({ name: 'shirone' }, null, 2));
  writeFile(root, 'src/config/integrationsConfig.ts', 'export const integrationsConfig = {};\n');
  writeFile(root, 'src/config/siteConfig.ts', 'export const siteConfig = {};\n');
  writeFile(root, 'src/data/friends.ts', 'export const friendsData = [];\n');
  writeFile(root, 'src/content/posts/a.md', '# a\n');
  writeFile(root, 'src/content/moments/b.md', '# b\n');
  return root;
}

/**
 * [T3a] 仿 Mizuki HEAD（7.1.3）：`src/config/` 目录形态 + `overrideLoader.ts`。
 * **刻意**同时造出 `src/config/siteConfig.ts` 与 `src/config/index.ts`
 * （与 shirone 的 12 个重名文件同形）——这正是旧判据会误判成 shirone 的场景。
 */
function buildMizukiHeadFixture(): string {
  const root = makeTempRoot('theme-adapter-mizuki-head-');
  writeFile(
    root,
    'package.json',
    JSON.stringify({ name: 'mizuki', dependencies: { astro: '^5.0.0' } }, null, 2),
  );
  writeFile(root, 'astro.config.mjs', 'export default {};\n');
  writeFile(root, 'src/config/overrideLoader.ts', 'export const OVERRIDABLE_CONFIGS = [];\n');
  writeFile(root, 'src/config/siteConfig.ts', 'export const siteConfig = {};\n');
  writeFile(root, 'src/config/index.ts', "export * from './siteConfig';\n");
  writeFile(root, 'src/data/diary.ts', 'export const diaryData = [];\n');
  fs.mkdirSync(path.join(root, 'src/content/posts'), { recursive: true });
  return root;
}

/** [T3] 仿 shirone **npm 包模式**：依赖含 shirones，但项目根**没有** src/config/ */
function buildShironePackageModeFixture(): string {
  const root = makeTempRoot('theme-adapter-shirone-pkg-');
  writeFile(
    root,
    'package.json',
    JSON.stringify({ name: 'my-blog', dependencies: { shirones: '^1.0.6' } }, null, 2),
  );
  writeFile(root, 'astro.config.mjs', 'export default {};\\n');
  return root;
}

describe('[T1] ThemeAdapterService', () => {
  const service = new ThemeAdapterService();

  it('Mizuki fixture：kind=mizuki 且能力画像全等', () => {
    const root = buildMizukiFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('mizuki');
    expect(profile.capabilities).toEqual(MIZUKI_CAPABILITIES);
    // 形状投影：root 为绝对路径，其余为相对 root 的 POSIX 路径
    expect(profile.layout).toEqual({
      kind: 'mizuki',
      root,
      configDir: 'src',
      configFile: 'src/config.ts',
      dataDir: 'src/data',
      contentDir: 'src/content',
      postsDir: 'src/content/posts',
      publicDir: 'public',
    });
    // 证据链：每步探测均落名 + 通过位 + 相对路径明细（不含绝对路径）
    expect(profile.evidence.length).toBeGreaterThanOrEqual(5);
    expect(profile.evidence.every((item) => item.detail.length > 0)).toBe(true);
    expect(profile.evidence.every((item) => !item.detail.includes(root))).toBe(true);
    expect(ThemeAdapterProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('Shirone fixture：kind=shirone 且能力画像全等', () => {
    const root = buildShironeFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('shirone');
    expect(profile.capabilities).toEqual(SHIRONE_CAPABILITIES);
    expect(profile.layout).toEqual({
      kind: 'shirone',
      root,
      configDir: 'src/config',
      configFile: null,
      dataDir: 'src/data',
      contentDir: 'src/content',
      postsDir: 'src/content/posts',
      publicDir: 'public',
    });
    expect(ThemeAdapterProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('两档能力画像互不相等（防串档）', () => {
    expect(MIZUKI_CAPABILITIES).not.toEqual(SHIRONE_CAPABILITIES);
    expect(
      service.resolve(buildMizukiFixture()).capabilities,
    ).not.toEqual(service.resolve(buildShironeFixture()).capabilities);
  });

  it('空目录 → unknown（能力面全空，不抛错）', () => {
    const root = makeTempRoot('theme-adapter-empty-');
    const profile = service.resolve(root);

    expect(profile.kind).toBe('unknown');
    expect(profile.capabilities).toEqual(UNKNOWN_CAPABILITIES);
    expect(profile.layout.configFile).toBeNull();
    expect(profile.evidence.some((item) => item.name === 'package-json' && !item.passed)).toBe(true);
  });

  it('不存在的路径 → unknown 且不抛错', () => {
    const missing = path.join(makeTempRoot('theme-adapter-missing-'), 'nope', 'deeper');

    expect(() => service.resolve(missing)).not.toThrow();
    const profile = service.resolve(missing);
    expect(profile.kind).toBe('unknown');
    expect(profile.capabilities).toEqual(UNKNOWN_CAPABILITIES);
  });

  it('空串 root → unknown 且不抛错（未初始化态）', () => {
    const profile = service.resolve('');
    expect(profile.kind).toBe('unknown');
    expect(profile.layout.root).toBe('');
    expect(profile.capabilities).toEqual(UNKNOWN_CAPABILITIES);
  });

  it('[T3/Q2] shirone npm 包模式 → kind=unknown，且落 shirone-package-mode 证据', () => {
    const root = buildShironePackageModeFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('unknown');
    expect(profile.capabilities.dataFiles.supported).toBe(false);
    expect(profile.capabilities).toEqual(UNKNOWN_CAPABILITIES);
    expect(profile.layout).toEqual({
      kind: 'unknown',
      root,
      configDir: '',
      configFile: null,
      dataDir: '',
      contentDir: '',
      postsDir: '',
      publicDir: '',
    });
    const pkgEvidence = profile.evidence.filter((item) => item.name === 'shirone-package-mode');
    expect(pkgEvidence).toHaveLength(1);
    expect(pkgEvidence[0]?.passed).toBe(true);
    expect(pkgEvidence[0]?.detail.length).toBeGreaterThan(0);
    // 证据明细只写相对路径/纯文本（仓规红线 6）
    expect(profile.evidence.every((item) => !item.detail.includes(root))).toBe(true);
    expect(pkgEvidence[0]?.detail.startsWith(root)).toBe(false);
    expect(ThemeAdapterProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('[T3/Q2] shirone 源码仓模式不被误伤：仍有 src/config/siteConfig.ts → kind=shirone', () => {
    const root = buildShironeFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('shirone');
    expect(profile.capabilities).toEqual(SHIRONE_CAPABILITIES);
    expect(
      profile.evidence.find((item) => item.name === 'shirone-package-mode')?.passed,
    ).toBe(false);
  });

  it('[T3/Q4] serverMode 透传：显式 additive 与默认 manage', () => {
    const root = buildMizukiFixture();

    expect(service.resolve(root, 'additive').capabilities.serverMode).toEqual({
      mode: 'additive',
      enforcement: 'declared-only',
    });
    expect(service.resolve(root).capabilities.serverMode).toEqual({
      mode: 'manage',
      enforcement: 'declared-only',
    });
    // unknown 档同样透传（mode 是 Kova 自身配置，与主题无关）
    expect(service.resolve('', 'overwrite').capabilities.serverMode).toEqual({
      mode: 'overwrite',
      enforcement: 'declared-only',
    });
    expect(ThemeAdapterProfileSchema.safeParse(service.resolve(root, 'overwrite')).success).toBe(
      true,
    );
  });

  // --- [T3a] 配置面三档形态判定：判定 + 策略声明（零写入器） ---

  it('[T3a] Mizuki HEAD（src/config/ 目录形态）不得被判成 shirone', () => {
    const root = buildMizukiHeadFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('mizuki');
    expect(profile.capabilities.config.strategy).toBe('overlay-ts');
    expect(profile.capabilities.config.domains).toHaveLength(18);
    expect(profile.capabilities).toEqual(MIZUKI_HEAD_CAPABILITIES);
    expect(profile.layout).toEqual({
      kind: 'mizuki',
      root,
      configDir: 'src/config',
      configFile: null,
      dataDir: 'src/data',
      contentDir: 'src/content',
      postsDir: 'src/content/posts',
      publicDir: 'public',
    });
    // 与 shirone 重名的 siteConfig.ts / index.ts 在场也不改判定（旧判据的失败现场）
    expect(profile.evidence.find((item) => item.name === 'mizuki-head-override-loader')?.passed).toBe(
      true,
    );
    expect(
      profile.evidence.find((item) => item.name === 'shirone-integrations-config')?.passed,
    ).toBe(false);
    expect(ThemeAdapterProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('[T3a] Mizuki legacy（单文件 src/config.ts）：策略与可写名单声明不变', () => {
    const root = buildMizukiFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('mizuki');
    expect(profile.layout.configFile).toBe('src/config.ts');
    expect(profile.capabilities.config.strategy).toBe('ts-morph-declaration');
    expect(profile.capabilities.config.domains).toEqual([]);
  });

  it('[T3a] Shirone（src/config/integrationsConfig.ts）→ overlay-yaml + 32 个配置域', () => {
    const root = buildShironeFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('shirone');
    expect(profile.capabilities.config.strategy).toBe('overlay-yaml');
    expect(profile.capabilities.config.domains).toHaveLength(32);
    expect(profile.capabilities.config.domains).toContain('navBar');
    expect(profile.capabilities.config.domains).toContain('series');
    expect(profile.capabilities).toEqual(SHIRONE_CAPABILITIES);
  });

  it('[T3a] shirone npm 包模式仍判 unknown（既有行为不回归）', () => {
    const root = buildShironePackageModeFixture();
    const profile = service.resolve(root);

    expect(profile.kind).toBe('unknown');
    expect(profile.capabilities.config.strategy).toBe('none');
    expect(profile.capabilities.config.domains).toEqual([]);
    expect(profile.capabilities).toEqual(UNKNOWN_CAPABILITIES);
  });

  it('[T3a] 三档 domains 两两不相等（防止误共用一份名单）', () => {
    const legacy = service.resolve(buildMizukiFixture()).capabilities.config.domains;
    const head = service.resolve(buildMizukiHeadFixture()).capabilities.config.domains;
    const shirone = service.resolve(buildShironeFixture()).capabilities.config.domains;

    expect(legacy).not.toEqual(head);
    expect(head).not.toEqual(shirone);
    expect(legacy).not.toEqual(shirone);
    expect(new Set([legacy.length, head.length, shirone.length]).size).toBe(3);
  });
});
