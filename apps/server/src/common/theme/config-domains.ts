/**
 * [T4] common/theme/config-domains — 主题配置域的**两张权威登记表**（L0 单源，纯数据零 IO）
 * [来源] Shirone 表逐行照抄上游 `.test-tmp/upstream-Shirone-20261029/scripts/content/config-domains.mjs`
 *   的 `CONFIG_DOMAINS`（32 行，顺序不变），交叉核对 `docs/refs/theme-compat/shirone-config-domains.md`；
 *   Mizuki HEAD 表逐字取自上游 `src/config/overrideLoader.ts` 的 `OVERRIDABLE_CONFIGS`（18 名，顺序不变）。
 * [为什么必须是一张表] YAML 文件基名、领域 key、TS 类型名三者**不是同一个字符串**
 *   （32 行里有 5 行 `key !== file`），靠 kebab-case 推导必然写错文件。
 * [职责] 只做「域名 → 文件 / 类型 / 类型模块」的寻址；零逻辑、零 IO、零写入器。
 *   `theme-adapter.ts` 的 32 项名单已改为引用本表（单源，禁再出现第二份字面数组）。
 * [状态] ACTIVE
 */

/** 上游 Shirone `config/<域>.yaml` 侧车的一个配置域 */
export interface ShironeConfigDomain {
  /** `withUserConfig(key, ...)` 使用的领域名 */
  readonly key: string;
  /** 内容仓 `config/<file>.yaml` 的文件基名（kebab-case） */
  readonly file: string;
  /** 该领域的 TS 类型名 */
  readonly type: string;
  /** 类型所在模块（上游写法，如 `@/types/config`） */
  readonly module: string;
  /** 是否允许部分覆盖（默认 true；仅 navBar 为 false —— 整体替换的专用类型） */
  readonly partial: boolean;
}

/**
 * Shirone 32 个配置域 —— 逐字照抄上游 `scripts/content/config-domains.mjs` 的 `CONFIG_DOMAINS`。
 * ⚠ **禁止**按直觉重排或改写 `file`：`key !== file` 的行是真实约定
 * （`expressiveCode`→`expressive-code` / `postList`→`post-list` / `contextMenu`→`context-menu` /
 *  `imageBloom`→`image-bloom` / `navBar`→`nav-bar`），改一行就等于写错用户的文件。
 */
export const SHIRONE_CONFIG_DOMAINS: readonly ShironeConfigDomain[] = Object.freeze([
  { key: 'site', file: 'site', type: 'SiteConfig', module: '@/types/config', partial: true },
  { key: 'permalink', file: 'permalink', type: 'PermalinkConfig', module: '@/types/permalinkConfig', partial: true },
  { key: 'profile', file: 'profile', type: 'ProfileConfig', module: '@/types/config', partial: true },
  { key: 'license', file: 'license', type: 'LicenseConfig', module: '@/types/config', partial: true },
  { key: 'expressiveCode', file: 'expressive-code', type: 'ExpressiveCodeConfig', module: '@/types/config', partial: true },
  { key: 'announcement', file: 'announcement', type: 'AnnouncementConfig', module: '@/types/announcementConfig', partial: true },
  { key: 'postList', file: 'post-list', type: 'PostListConfig', module: '@/types/postListConfig', partial: true },
  { key: 'article', file: 'article', type: 'ArticleConfig', module: '@/types/articleConfig', partial: true },
  { key: 'comment', file: 'comment', type: 'CommentConfig', module: '@/types/commentConfig', partial: true },
  { key: 'contextMenu', file: 'context-menu', type: 'ContextMenuConfig', module: '@/types/contextMenuConfig', partial: true },
  { key: 'fab', file: 'fab', type: 'FabConfig', module: '@/types/fabConfig', partial: true },
  { key: 'sidebar', file: 'sidebar', type: 'SidebarConfig', module: '@/types/sidebarConfig', partial: true },
  { key: 'footer', file: 'footer', type: 'FooterConfig', module: '@/types/footerConfig', partial: true },
  { key: 'imageBloom', file: 'image-bloom', type: 'ImageBloomConfig', module: '@/types/imageBloomConfig', partial: true },
  { key: 'skills', file: 'skills', type: 'SkillsConfig', module: '@/types/skillsConfig', partial: true },
  { key: 'projects', file: 'projects', type: 'ProjectsConfig', module: '@/types/projectsConfig', partial: true },
  { key: 'timeline', file: 'timeline', type: 'TimelineConfig', module: '@/types/timelineConfig', partial: true },
  { key: 'devices', file: 'devices', type: 'DevicesConfig', module: '@/types/devicesConfig', partial: true },
  { key: 'games', file: 'games', type: 'GamesConfig', module: '@/types/gamesConfig', partial: true },
  { key: 'music', file: 'music', type: 'MusicConfig', module: '@/types/musicConfig', partial: true },
  { key: 'anime', file: 'anime', type: 'AnimeConfig', module: '@/types/animeConfig', partial: true },
  { key: 'font', file: 'font', type: 'FontConfig', module: '@/types/fontConfig', partial: true },
  { key: 'llms', file: 'llms', type: 'LlmsConfig', module: '@/types/llmsConfig', partial: true },
  { key: 'umami', file: 'umami', type: 'UmamiConfig', module: '@/types/umamiConfig', partial: true },
  { key: 'about', file: 'about', type: 'AboutConfig', module: '@/types/aboutConfig', partial: true },
  { key: 'friends', file: 'friends', type: 'FriendsConfig', module: '@/types/friendsConfig', partial: true },
  { key: 'moments', file: 'moments', type: 'MomentsConfig', module: '@/types/momentsConfig', partial: true },
  { key: 'albums', file: 'albums', type: 'AlbumsConfig', module: '@/types/albumsConfig', partial: true },
  { key: 'compass', file: 'compass', type: 'CompassConfig', module: '@/types/compassConfig', partial: true },
  { key: 'i18n', file: 'i18n', type: 'I18nConfig', module: '@/types/i18nConfig', partial: true },
  { key: 'series', file: 'series', type: 'SeriesConfig', module: '@/types/seriesConfig', partial: true },
  // 导航项要引用 LinkPresets 并调用 i18n()，无法用「默认值 ⊕ 覆盖」表达 ⇒ 整体替换的中间形态。
  { key: 'navBar', file: 'nav-bar', type: 'NavBarConfigOverride', module: '@/types/navBarConfig', partial: false },
] satisfies ShironeConfigDomain[]);

/** 32 个领域 key（保持上游顺序） */
export const SHIRONE_CONFIG_DOMAIN_KEYS: readonly string[] = SHIRONE_CONFIG_DOMAINS.map((d) => d.key);

/** 反查：内容仓文件基名 → 领域（`get('nav-bar')` 命中 `key === 'navBar'`） */
export const SHIRONE_DOMAIN_BY_FILE: ReadonlyMap<string, ShironeConfigDomain> = new Map(
  SHIRONE_CONFIG_DOMAINS.map((d) => [d.file, d]),
);

/** 上游 Mizuki HEAD `src/config/overrides/<name>.ts` 侧车的一个覆盖域 */
export interface MizukiHeadOverrideDomain {
  /** 覆盖名 —— **它就是写入的文件名**（`src/config/overrides/<name>.ts`） */
  readonly name: string;
  /** 上游源文件（仅诊断用：`name` 与源文件基名在 4 行上不同） */
  readonly sourceFile: string;
  /** 覆盖值的 TS 类型名 */
  readonly typeName: string;
  /**
   * 类型模块 —— 基准是**同步后的目标位置** `src/config/overrides/<name>.ts`，
   * **不是** Kova 的落盘位置 `<内容目录>/overrides/<name>.ts`。
   *
   * [上游原文] `scripts/sync-content.js:100-104`：
   * 「覆盖文件是带相对导入的 TS 模块，符号链接会被 Vite 解析到内容仓库真实路径导致
   *   找不到 types/config，因此**复制进代码仓库**而不是建链接」；
   * 上游各源文件 `src/config/<file>.ts` 用的是 `../types/config`（已逐文件核实），
   * 从 `overrides/` 子目录回退一级即 `../../types/config`。
   *
   * ⚠ **禁止**按落盘目录（`<内容目录>/overrides/`）计算本路径 —— 那会生成在同步后必然断链的相对路径。
   * ⚠ `markdownConfig` 的类型 `MarkdownEnhancementConfig` **不在** `types/config.ts`
   *   （实测命中 0 次），而是 `export interface` 声明在 `markdownConfig.ts:1` 自己文件里
   *   ⇒ 它的类型模块是 `../../config/markdownConfig`。type-only 导入编译期擦除，不构成运行期循环。
   *   **禁止**把它「统一」成 `../../types/config`。
   */
  readonly typeModule: string;
  /**
   * 面板可编辑性 —— 由「该域的覆盖文件能否只用字面量表达」决定。
   * - `'literal'`：覆盖文件只含字面量 ⇒ 面板可完整读写（18 行里的 17 行）
   * - `'none'`：覆盖文件**必须**含非字面量（枚举成员引用）⇒ 面板既读不回也写不出。
   *   `GET` 只回原始文本、`PUT` 拒绝、`DELETE`（恢复默认）仍允许。
   *
   * [上游依据] `docs/CONTENT_SEPARATION.md:329` 逐字：
   *   「`navBarConfig.links` 里的预设项是**枚举**，要写 `LinkPreset.Home` 并
   *     `import { LinkPreset } from "../../types/config"`，**不能写裸数字**」
   * `navBarConfig.ts:2` 确实 `import { LinkPreset } from "../types/config"` 并在 links 里引用成员。
   * ⇒ `LinkPreset.Home` 是 PropertyAccessExpression，既不是字面量、也没有可逆的字面量编码。
   *
   * ⚠ 本标志位**属于本档**（Mizuki HEAD）。**不得**外推到 Shirone 的同名概念域：
   *   Shirone 的 `navBar` 用**字符串引用**（`preset: "Home"` / `"$t:home"`）表达同一件事
   *   （`src/types/navBarConfig.ts:20-41` 逐字：「navBarConfig 本身要调用 i18n() 并引用 LinkPresets，
   *   无法用 YAML 直接表达，因此内容仓写的是这份**引用 + 字面量**的中间形态」）
   *   ⇒ Shirone 的 `navBar` **可被面板完整读写**。同一概念域、两档判决相反，故标志位必须按「档位 × 域」持有。
   */
  readonly panelSupport: 'literal' | 'none';
}

/** 上游 `src/config/overrides/` 的相对回退一级（基准 = 同步后的 `src/config/overrides/<name>.ts`） */
const TYPES_CONFIG_MODULE = '../../types/config';

/**
 * Mizuki HEAD 18 个可覆盖配置 —— 逐字照抄上游 `src/config/overrideLoader.ts` 的 `OVERRIDABLE_CONFIGS`。
 * ⚠ **覆盖文件名 = 覆盖名**，不是源文件名（4 行不同名，见 `sourceFile`）。
 */
export const MIZUKI_HEAD_OVERRIDE_DOMAINS: readonly MizukiHeadOverrideDomain[] = Object.freeze([
  { name: 'siteConfig', sourceFile: 'siteConfig.ts', typeName: 'SiteConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'fullscreenWallpaperConfig', sourceFile: 'backgroundWallpaper.ts', typeName: 'FullscreenWallpaperConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'navBarConfig', sourceFile: 'navBarConfig.ts', typeName: 'NavBarConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'none' },
  { name: 'profileConfig', sourceFile: 'profileConfig.ts', typeName: 'ProfileConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'licenseConfig', sourceFile: 'licenseConfig.ts', typeName: 'LicenseConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'permalinkConfig', sourceFile: 'permalinkConfig.ts', typeName: 'PermalinkConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'expressiveCodeConfig', sourceFile: 'expressiveCodeConfig.ts', typeName: 'ExpressiveCodeConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'commentConfig', sourceFile: 'commentConfig.ts', typeName: 'CommentConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'shareConfig', sourceFile: 'shareConfig.ts', typeName: 'ShareConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'announcementConfig', sourceFile: 'announcementConfig.ts', typeName: 'AnnouncementConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'musicPlayerConfig', sourceFile: 'musicConfig.ts', typeName: 'MusicPlayerConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'footerConfig', sourceFile: 'footerConfig.ts', typeName: 'FooterConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'sidebarLayoutConfig', sourceFile: 'sidebarConfig.ts', typeName: 'SidebarLayoutConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'sakuraConfig', sourceFile: 'effectsConfig.ts', typeName: 'SakuraConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'pioConfig', sourceFile: 'pioConfig.ts', typeName: 'PioConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'relatedPostsConfig', sourceFile: 'relatedPostsConfig.ts', typeName: 'RelatedPostsConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  { name: 'randomPostsConfig', sourceFile: 'randomPostsConfig.ts', typeName: 'RandomPostsConfig', typeModule: TYPES_CONFIG_MODULE, panelSupport: 'literal' },
  // ⚠ 唯一一行不走 types/config：类型自己声明在 markdownConfig.ts 里（见 interface 上的说明）。
  { name: 'markdownConfig', sourceFile: 'markdownConfig.ts', typeName: 'MarkdownEnhancementConfig', typeModule: '../../config/markdownConfig', panelSupport: 'literal' },
] satisfies MizukiHeadOverrideDomain[]);

/** 反查：覆盖名 → 覆盖域 */
export const MIZUKI_HEAD_OVERRIDE_BY_NAME: ReadonlyMap<string, MizukiHeadOverrideDomain> = new Map(
  MIZUKI_HEAD_OVERRIDE_DOMAINS.map((d) => [d.name, d]),
);
