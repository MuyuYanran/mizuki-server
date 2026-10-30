# Shirone ↔ Mizuki 主题字段级对照表

- 目的：为 Mizuki-Server 的「主题兼容面」提供一份字段级对照参考（集合 / 文章 frontmatter / 站点配置 / 目录与构建契约）。
- 冻结口径：**Mizuki 侧以本地分叉实例 `../Mizuki` 为准**；上游克隆 `.test-tmp/upstream-Mizuki-20261028` 仅用于标注分叉差异；
  **Shirone 侧** `.test-tmp/upstream-Shirone-20261029`（v1.0.6，Astro 7.3.8）。
- 快照日期：2026-10-29。本文**只读源码**，未执行任何构建、未改动任何代码。
- 表格中的「来源路径」除特别注明外均相对各自主题根。
- 「未确认」= 该行无法从源码直接读出，已列出查过的路径，不做推测。

---

## 1. 集合对照表（`src/data/`）

### 1.1 文件级对照

| Mizuki（`../Mizuki/src/data/`） | 导出变量 | 条目 interface | Shirone（`.test-tmp/upstream-Shirone-20261029/src/data/`） |
|---|---|---|---|
| `anime.ts` | `localAnimeList`（**default 导出**；`AnimeItem` 为具名接口导出） | `AnimeItem` | `anime.ts` → `animeData: AnimeItem[]`（另导出类型 `AnimeStatus`） |
| `diary.ts` | `getDiaryList` / `getAllTags`（数据常量 `diaryData` **不导出**） | `DiaryItem` | **无** —— 载体已迁移，见 §1.2 |
| `friends.ts` | `friendsData` | `FriendItem` | `friends.ts` → `friendsData: FriendItem[]`（同名同形） |
| `projects.ts` | `projectsData` + `getProjectStats` / `getProjectsByCategory` / `getFeaturedProjects` / `getAllTechStack` | `Project` | `projects.ts` → `projectsData: ProjectItem[]`（**无派生函数**；类型在 `Shirone/src/types/projectsConfig.ts`） |
| `skills.ts` | `skillsData` | `Skill` | `skills.ts` → `skillsData: SkillItem[]`（类型在 `Shirone/src/types/skillsConfig.ts`） |
| `devices.ts` | `devicesData` | `Device` + `DeviceCategory` | `devices.ts` → `devicesData: DeviceItem[]`（类型在 `Shirone/src/types/devicesConfig.ts`） |
| `timeline.ts` | `timelineData` | `TimelineItem`（import 自 `Mizuki/src/components/features/timeline/types`） | `timeline.ts` → `timelineData: TimelineItem[]`（类型在 `Shirone/src/types/timelineConfig.ts`） |
| `bilibili-data.json` | 无（纯 JSON 数据文件） | — | **无同名文件**；B 站数据改由 `Shirone/src/config/animeConfig.ts` 的 `providers` / `snapshot` 键与 `src/data/anime-snapshots/` 承担 |
| （上游 Mizuki 独有）`ai-tools.ts` | `aiToolsData` | `AITool`（另 `AIToolCategory` / `AIToolFrequency` / `LocaleString`） | **未确认**（`Shirone/src/data/` 无对应文件；未深查 Shirone 是否另有 AI 工具导航页） |
| —（Shirone 新增） | — | — | `compass.ts` → `compassData: CompassShelf[]`（接口 `CompassEntry` / `CompassShelf`） |
| —（Shirone 新增） | — | — | `games.ts` → `gamesData: GameItem[]`（类型在 `Shirone/src/types/gamesConfig.ts`） |
| —（Shirone 新增） | — | — | `music.ts` → `musicTracks: readonly TrackDescriptor[]`（类型在 `Shirone/src/types/musicConfig.ts`） |
| —（Shirone 新增） | — | — | `anime-snapshots/`（**空目录**，无内容文件；用途见 `Shirone/src/config/animeConfig.ts` 的 `snapshot` 键） |

**结论**：Mizuki 侧 8 个 `.ts` 中，Shirone 侧 6 个有同名对应（`anime` / `friends` / `projects` / `skills` / `devices` / `timeline`），
`diary.ts` 被移除（§1.2）；Shirone **新增** `compass.ts` / `games.ts` / `music.ts` 与 `anime-snapshots/`。
上游 Mizuki 的 `ai-tools.ts` 在本地分叉中**不存在**（本地 `../Mizuki/src/data/` 无此文件）。

### 1.2 `diary` 在 Shirone 里的载体：`moments` 集合

Mizuki 的 `diary` 在 Shirone 中**不再是 `src/data/` 下的数据文件**，而变成一个**内容集合（content collection）**：

| 载体 | 路径 |
|---|---|
| 内容条目 | `Shirone/src/content/moments/*.md`（示例：`2026-07-27-reading.md`、`2026-08-15-welcome.md`，共 6 篇） |
| schema | `Shirone/src/content.config.ts` → `momentsCollection`（collection 名 `moments`，loader `glob({ base: "./src/content/moments", pattern: "**/*.md" })`） |
| 站点配置域 | `Shirone/src/config/momentsConfig.ts` → `momentsConfig`（键：`enable` / `title` / `description`） |
| 集合页导航 | `Shirone/src/config/navBarConfig.ts`（导航键含 `Moments`） |

字段级对照（`Mizuki/src/data/diary.ts` 的 `DiaryItem` ↔ `Shirone/src/content.config.ts` 的 `momentsCollection.schema`）：

| Mizuki `DiaryItem` | Shirone moments frontmatter | 差异 |
|---|---|---|
| `id: number` | — | **删除**：条目身份改由文件名（如 `2026-07-27-reading.md`）派生 |
| `content: string` | Markdown 正文 body | **改载体**：由字段变为正文 |
| `date: string` | `published: z.date()`（必填） | **改型**：ISO 字符串 → `Date`，且必填 |
| `images?: string[]` | `images: { src: string; alt?: string }[]`，默认 `[]` | **改型**：字符串数组 → 对象数组（带 alt） |
| `location?: string` | `location: string`，默认 `""` | 可选性变化：可选 → 有默认值 |
| `mood?: string` | `mood: string`，默认 `""`（Iconify 图标名，如 `material-symbols:sentiment-…`） | 语义收紧（自由文本 → Iconify 名） |
| `tags?: string[]` | `tags: string[]`，默认 `[]` | 一致 |
| — | `pinned: boolean`，默认 `false`；`draft: boolean`，默认 `false` | **Shirone 新增** |

---

## 2. 文章 frontmatter 字段对照表（posts schema）

来源：`Mizuki/src/content.config.ts` 的 `postsCollection` ↔ `Shirone/src/content.config.ts` 的 `postsCollection`。

### 2.1 共有字段（19）（表头曾误写 20；实际逐字段展开为 19 —— 2026-10-29 订正）

| 字段 | Mizuki 类型/默认 | Shirone 类型/默认 | 备注 |
|---|---|---|---|
| `title` | `string`（必填） | `string`（必填） | 一致 |
| `published` | `z.date()`（必填） | `z.date()`（必填） | 一致 |
| `updated` | `z.date().optional()` | `z.date().optional()` | 一致 |
| `draft` | `boolean`，默认 `false` | `boolean`，默认 `false` | 一致 |
| `description` | `string`，默认 `""` | `string`，默认 `""` | 一致 |
| `image` | `string`，默认 `""` | `string`，默认 `""` | 一致 |
| `tags` | `string[]`，默认 `[]` | `string[]`，默认 `[]` | 一致 |
| `category` | `string` 可空，默认 `""` | `string` 可空，默认 `""` | 一致 |
| `lang` | `string`，默认 `""` | `string`，默认 `""` | 一致 |
| `pinned` | `boolean`，默认 `false` | `boolean`，默认 `false` | 一致 |
| `comment` | `boolean`，默认 `true` | `boolean`，默认 `true` | 一致 |
| `encrypted` | `boolean`，默认 `false` | `boolean`，默认 `false` | 一致 |
| `alias` | `string`（可选） | `string`（可选） | 一致 |
| `permalink` | `string`（可选） | `string`（可选） | 一致 |
| `passwordHint` | `string`，默认 `""` | `string`，默认 `""` | 一致 |
| `prevTitle` / `prevSlug` | `string`，默认 `""` | `string`，默认 `""` | 一致（内部字段） |
| `nextTitle` / `nextSlug` | `string`，默认 `""` | `string`，默认 `""` | 一致（内部字段） |

### 2.2 改型字段（2）

| 字段 | Mizuki | Shirone | 影响 |
|---|---|---|---|
| `password` | `z.string().optional().default("")` | `z.union([z.string(), z.number()]).transform(String).optional()`（**无 default**） | Shirone 接受数字口令并统一转字符串；未写该字段时不再落 `""` |
| 版权三字段 → `license` | `licenseName` / `licenseUrl` / （无作者字段以外）三条独立 `string`，默认 `""` | `license`：`string`（简写许可证名）或对象 `{ enable?, name?, url?, author?: string \| {name?,url?}, source? }`，可选 | **结构合并 + 增强**：支持单篇覆写作者与转载来源 |

### 2.3 Shirone 新增字段（8）

| 字段 | 类型/默认 | 来源 |
|---|---|---|
| `publishedAt` | `z.date().optional()` | `Shirone/src/content.config.ts` |
| `updatedAt` | `z.date().optional()` | 同上 |
| `series` | `string`，默认 `""`，`.transform(trim)` | 同上（单归属系列 slug） |
| `seriesOrder` | `z.number().int().optional()` | 同上（系列内顺序） |
| `hideHomeContent` | `boolean`，默认 `true` | 同上（加密文章首页内容隐藏） |
| `prevUrl` | `string`（可选） | 同上（内部字段） |
| `nextUrl` | `string`（可选） | 同上（内部字段） |
| `license` | 见 §2.2 | 同上 |

### 2.4 Mizuki 独有字段（Shirone posts schema 中不存在，5）

| 字段 | Mizuki 类型/默认 |
|---|---|
| `priority` | `z.number().optional()` |
| `author` | `string`，默认 `""` |
| `sourceLink` | `string`，默认 `""` |
| `licenseName` | `string`，默认 `""` |
| `licenseUrl` | `string`，默认 `""` |

### 2.5 集合集与 glob / mdx

| 维度 | Mizuki（本地分叉） | Shirone |
|---|---|---|
| 集合集 | `posts`、`spec`（`Mizuki/src/content.config.ts` 的 `collections`） | `posts`、`spec`、`series`、`moments`（`Shirone/src/content.config.ts`） |
| posts glob | `glob({ pattern: "**/*.md", base: "./src/content/posts" })` | `glob({ base: "./src/content/posts", pattern: "**/*.{md,mdx}" })` |
| spec glob | `**/*.md` | `**/*.{md,mdx}` |
| series / moments loader | 无 | `series`：`**/*.md`（`title` / `status` 枚举 `ongoing\|completed` 默认 `ongoing` / `defaultCategory` 默认 `""`）；`moments`：见 §1.2 |
| mdx 支持 | posts/spec **仅 `.md`**，仓内无 `.mdx` 样例、无 mdx 集成配置 | posts/spec **含 `.mdx`**：样例 `Shirone/src/content/posts/mdx-showcase.mdx`，集成参数 `Shirone/src/config/integrationsConfig.ts` → `mdxOptions` |

---

## 3. 站点配置域对照表

### 3.1 Mizuki `src/config.ts` 顶层导出（18）→ Shirone `src/config/` 域

| Mizuki 导出（`Mizuki/src/config.ts`） | Shirone 域文件 | 导出 config 变量 | 该域顶层键名（前 8，括号内为一级缩进键行数） |
|---|---|---|---|
| `siteConfig` | `siteConfig.ts` | `siteConfig` | `site` `base` `title` `subtitle` `topAppBar` `displaySettings` `lang` `timeZone`（24，含嵌套同名键） |
| `fullscreenWallpaperConfig` | **无独立域**，归入 `siteConfig.ts` | `siteConfig` | `wallpaperMode` `texture` `banner` `layoutMode` `reduceMotion` |
| `navBarConfig` | `navBarConfig.ts` | `navBarConfig`（另 `LinkPresets`） | `Home` `Archive` `Friends` `Moments` `Anime` `Compass` `Skills` `Projects`（21） |
| `profileConfig` | `profileConfig.ts` | `profileConfig` | `avatar` `name` `bio` `links`（4） |
| `licenseConfig` | `licenseConfig.ts` | `licenseConfig` | `enable` `name` `url`（3） |
| `permalinkConfig` | `permalinkConfig.ts` | `permalinkConfig` | `enable` `format`（2） |
| `expressiveCodeConfig` | `expressiveCodeConfig.ts` | `expressiveCodeConfig` | `theme` `lightTheme` `darkTheme`（3） |
| `commentConfig` | `commentConfig.ts` | `commentConfig` | `enable` `provider` `lazy` `twikoo` `giscus` `waline` `config`（7） |
| `shareConfig` | `articleConfig.ts`（`share` 子键） | `articleConfig` | `lastUpdated` `discovery` `share` `relatedCount` `randomCount` `includeCover` `config`（9） |
| `announcementConfig` | `announcementConfig.ts` | `announcementConfig` | `title` `content` `closable` `link`（4） |
| `musicPlayerConfig` | `musicConfig.ts` | `musicConfig` | `enable` `provider` `meting` `defaultVolume` `defaultMode` `track` `usedIds`（9） |
| `footerConfig` | `footerConfig.ts` | `footerConfig` | `enable`（1；其余渲染落 `Mizuki/src/FooterConfig.html` ↔ `Shirone/src/config/FooterConfig.html`） |
| `sidebarLayoutConfig` | `sidebarConfig.ts` | `sidebarConfig` | `enable` `arrangement` `side` `components`（4） |
| `sakuraConfig` | **无独立域**；`sakura` 仅作为**纹理预设取值** | — | `Shirone/src/config/siteConfig.ts`（`texture.defaultPreset` 可选值枚举含 `"sakura"`）、`Shirone/src/constants/constants.ts`（`"sakura"`）。语义不同：Mizuki 为飘落特效开关，Shirone 为纹理预设名 |
| `pioConfig` | **无** —— 已查 `Shirone/src/config/`、`Shirone/src/constants/constants.ts`、全 `Shirone/src/` grep `live2d|pio`（无命中） | — | — |
| `relatedPostsConfig` | `articleConfig.ts`（`relatedCount`） | `articleConfig` | 见上（无同名声明） |
| `randomPostsConfig` | `articleConfig.ts`（`randomCount`） | `articleConfig` | 见上（无同名声明） |
| `widgetConfigs` | `sidebarConfig.ts`（`components`）+ `Shirone/src/components/molecules/WidgetLayout.astro`（归并，无同名导出） | `sidebarConfig` | `enable` `arrangement` `side` `components`（4） |

### 3.2 Shirone `src/config/` 全量域文件（**总数：35 个 `.ts`，其中域文件 33 个**）

**口径订正（2026-10-29 实测，以此为准）**：`src/config/*.ts` 共 35；其中**非域文件 3 个** —— `index.ts`（barrel 再导出）、
`sitemapFilter.ts`（辅助函数）、`integrationsConfig.ts`（构建/集成参数，无 YAML 对应）。
⇒ **域共 32 个**，与上游 `scripts/content/config-domains.mjs` 的 `CONFIG_DOMAINS`（上冻结登记表）**等长**；
但 `withUserConfig("<域名>", …)` 调用点只有 **31 个** —— 差额是 `navBar`：它走 `getUserConfig("navBar")`
**整体替换**（登记表标 `partial: false`），不经过合并器。
逐域寻址表（域名/key ↔ `config/<域>.yaml` ↔ TS 类型 ↔ 生效时机）见
[`shirone-config-domains.md`](shirone-config-domains.md)。**本条早期写的「33 个域文件 / 32 个 `withUserConfig`」是错的，已废。**

| 域文件（`Shirone/src/config/`） | 导出 config 变量 | 顶层键名（前 8） | 一级键行数 |
|---|---|---|---|
| `aboutConfig.ts` | `aboutConfig` | `enable` `title` `description` | 3 |
| `albumsConfig.ts` | `albumsConfig` | `enable` `title` `description` | 3 |
| `animeConfig.ts` | `animeConfig`（另 `resolveAnimeOptions` / `resolvedAnimeOptions`） | `enable` `title` `description` `source` `fallback` `providers` `snapshot` | 7 |
| `announcementConfig.ts` | `announcementConfig` | `title` `content` `closable` `link` | 4 |
| `articleConfig.ts` | `articleConfig` | `lastUpdated` `discovery` `share` `relatedCount` `randomCount` `includeCover` `config` | 9 |
| `commentConfig.ts` | `commentConfig` | `enable` `provider` `lazy` `twikoo` `giscus` `waline` `config` | 7 |
| `compassConfig.ts` | `compassConfig` | `enable` `title` `description` | 3 |
| `contextMenuConfig.ts` | `contextMenuConfig` | `enable` `actions` | 2 |
| `devicesConfig.ts` | `devicesConfig` | `enable` `title` `description` `categories` | 4 |
| `expressiveCodeConfig.ts` | `expressiveCodeConfig` | `theme` `lightTheme` `darkTheme` | 3 |
| `fabConfig.ts` | `fabConfig` | `enable` `align` `size` `offset` `items` | 5 |
| `fontConfig.ts` | `fontConfig`（另 `resolvedFontOptions`） | `mode` `fontFamilies` `subsetting` `budget` | 4 |
| `footerConfig.ts` | `footerConfig` | `enable` | 1 |
| `friendsConfig.ts` | `friendsConfig` | `enable` `title` `description` | 3 |
| `gamesConfig.ts` | `gamesConfig` | `enable` `title` `description` `categories` | 4 |
| `i18nConfig.ts` | `i18nConfig` | （空对象 `{}`，由 i18n 资源接管） | 0 |
| `imageBloomConfig.ts` | `imageBloomConfig` | `enable` `blurRadius` `opacity` `transitionDuration` `config` | 5 |
| `integrationsConfig.ts` | `swupOptions` / `mdxOptions` / `viteBuildShared` / `TRAILING_SLASH` 等（**无 `*Config` 声明**） | `theme` `ignore` `animationClass` `containers` `smoothScrolling` `cache` `preload` `accessibility` | 23 |
| `licenseConfig.ts` | `licenseConfig` | `enable` `name` `url` | 3 |
| `llmsConfig.ts` | `llmsConfig` | `enable` `generateFull` `siteSummary` `descriptionMaxLength` `excludeTags` `excludeCategories` `corePages` `customSections` | 8 |
| `momentsConfig.ts` | `momentsConfig` | `enable` `title` `description` | 3 |
| `musicConfig.ts` | `musicConfig`（另 `resolveMusicOptions`） | `enable` `provider` `meting` `defaultVolume` `defaultMode` `track` `usedIds` | 9 |
| `navBarConfig.ts` | `navBarConfig`（另 `LinkPresets`） | `Home` `Archive` `Friends` `Moments` `Anime` `Compass` `Skills` `Projects` | 21 |
| `permalinkConfig.ts` | `permalinkConfig` | `enable` `format` | 2 |
| `postListConfig.ts` | `postListConfig`（另 `POST_CARD_MIN_WIDTH`） | `pageSize` `layout` `compact` `regular` `relaxed` | 5 |
| `profileConfig.ts` | `profileConfig` | `avatar` `name` `bio` `links` | 4 |
| `projectsConfig.ts` | `projectsConfig` | `enable` `title` `description` `categories` | 4 |
| `seriesConfig.ts` | `seriesConfig` | `enable` `title` `description` `cardPosition` | 4 |
| `sidebarConfig.ts` | `sidebarConfig` | `enable` `arrangement` `side` `components` | 4 |
| `siteConfig.ts` | `siteConfig`（另 `resolveTextureOptions` / `getDefaultStyle` / `getDefaultSpec` / `resolveDisplaySettings`） | `site` `base` `title` `subtitle` `topAppBar` `displaySettings` `lang` `timeZone` | 24 |
| `skillsConfig.ts` | `skillsConfig` | `enable` `title` `description` `categories` | 4 |
| `timelineConfig.ts` | `timelineConfig` | `enable` `title` `description` `categories` `order` | 5 |
| `umamiConfig.ts` | `umamiConfig` | `enable` `shareUrl` `websiteId` `scriptUrl` | 4 |

> 计数口径说明：`一级键行数` = 该文件内以「一个制表符 + 键名 + `:`」开头的行数，**含少数位于嵌套对象内、恰好同缩进**的同名键（如 `siteConfig.ts` 的 `wallpaperMode` / `texture` 各出现两次），故属上界。

---

## 4. 目录与构建契约对照表

| 维度 | Mizuki（`../Mizuki`） | Shirone（`.test-tmp/upstream-Shirone-20261029`） |
|---|---|---|
| 文章落点 | `src/content/posts`、`src/content/spec`（`Mizuki/src/content.config.ts`） | `src/content/{posts,spec,series,moments}`（`Shirone/src/content.config.ts`） |
| 集合数据落点 | `src/data/*.ts`（8 个 `.ts` + `bilibili-data.json`） | `src/data/*.ts`（9 个 `.ts`）+ `src/data/anime-snapshots/`（空目录） |
| 配置落点 | 单文件 `src/config.ts`（18 个顶层导出） | `src/config/*.ts`（33 域）+ `src/user/user-config.ts`（覆盖层，由 `scripts/content/config-overlay.mjs` 生成） |
| public 落点 | `public/`（`assets` `favicon` `images` `js` `pio` `sakura.webp` `_headers`） | `public/`（`assets` `favicon` `images` `logo`） |
| 内容仓挂载映射 | 内容仓目录 `content/` → `src/content/posts`、`src/content/spec`、`src/data`、`public/images`（`Mizuki/scripts/sync-content.js`，优先建 junction，失败则递归复制；原目录先备份为 `*.backup`） | `shirone.content.json` 的 `mounts`，默认 `{ content: "src/content", data: "src/data", assets: "src/assets", public: "public" }`（`Shirone/scripts/content/resolve-source.mjs` 的 `DEFAULT_MOUNTS`） |
| 内容分离机制 | 环境变量 + 脚本：`ENABLE_CONTENT_SYNC`（默认 `true`，`false` 关闭）、`CONTENT_REPO_URL`、`CONTENT_DIR`（默认 `<root>/content`）；`.env` 经 `Mizuki/scripts/load-env.js` 加载，示例见 `Mizuki/.env.example` | 清单文件 + 脚本族：`shirone.content.json`（`Shirone/scripts/content/resolve-source.mjs` 中 `MANIFEST_FILE`），示例 `Shirone/shirone.content.example.json`（键 `schemaVersion` / `source{type,url,ref}` / `mounts` / `keep` / `prune`）；`CONTENT_DIR` 环境变量亦可（`resolve-source.mjs` 支持），机制说明见 `Shirone/docs/content-separation/` |
| 内容脚本集 | `Mizuki/scripts/`：`sync-content.js` `load-env.js` `init-content-repo.js` `new-post.js` `update-anime.mjs` `update-bangumi.mjs` `update-bilibili.mjs` 等 | `Shirone/scripts/content/` 共 14 个 `.mjs`：`sync` `export` `eject` `status` `clean` `cli` `config-overlay` `config-diff` `config-domains` `config-introspect` `config-introspect-hooks` `config-introspect-worker` `generate-config-schemas` `resolve-source` |
| 部署形态 | **无** npm 包模式（仅源码模板） | **有** npm 包模式：`pnpm add shirones`，由 `Shirone/src/integration/` 实现，`Shirone/astro.config.mjs` 仅一行 `integrations: [shirones()]`；说明见 `Shirone/docs/npm-package-mode.md` |
| `package.json` name / version | `mizuki` / `9.0` | `shirone` / `1.0.6` |
| Astro 版本 | `6.1.2` | `7.3.8` |
| pnpm 版本 | `packageManager: pnpm@10.22.0` | `packageManager: pnpm@11.28.2` |
| Node 版本要求 | `Mizuki/package.json` 无 `engines`；CI 用 `lts/*`（`Mizuki/.github/workflows/{CI,build,lint}.yml`），`deploy.yml` 用 `'20'` ⇒ 最低版本**未确认** | `Shirone/package.json` 无 `engines`、根目录无 `.nvmrc`；`Shirone/docs/ci-and-node-tests.md` 记 CI 用 Node 22 与 24，工作流实际用 22 ⇒ 最低版本**未确认** |

---

## 5. 未确认项

| # | 未确认内容 | 查过的路径 |
|---|---|---|
| 1 | Shirone 要求的**最低 Node 版本**（无 `engines` / `.nvmrc` / `.node-version`） | `Shirone/package.json`、`Shirone/docs/ci-and-node-tests.md`、`Shirone/.github/workflows/{ci.yml,content-validate.yml,deploy.yml.example}` |
| 2 | Mizuki 要求的**最低 Node 版本**（无 `engines` / 版本文件） | `Mizuki/package.json`、`Mizuki/.github/workflows/{CI,build,lint,deploy}.yml` |
| 3 | 上游 Mizuki `ai-tools.ts` 在 Shirone 是否有对应功能页/域 | `Shirone/src/data/`（无对应文件）、`Shirone/src/config/`（无同名域）；未逐页检索 `Shirone/src/pages/` |
| 4 | `Shirone/src/data/anime-snapshots/` 的产物格式与生成者 | 该目录为空；仅有 `Shirone/src/config/animeConfig.ts` 的 `snapshot` 键可佐证用途，未追生成脚本 |
| 5 | `Shirone/src/config/siteConfig.ts` 的**精确顶层键总数** | `Shirone/src/config/siteConfig.ts`：一级缩进键行数 24，但含嵌套对象内同缩进的同名键（`wallpaperMode` / `texture` 各 2 次），精确值未确认 |
| 6 | `Shirone/src/config/footerConfig.ts` 的完整配置面（一级键仅 `enable`） | `Shirone/src/config/footerConfig.ts`、`Shirone/src/types/footerConfig.ts`、`Shirone/src/config/FooterConfig.html`（未逐键核对 HTML 内的键） |
| 7 | Shirone `integrationsConfig.ts` 内的键语义归类（按缩进计数得 23，但该文件非 `withUserConfig` 域） | `Shirone/src/config/integrationsConfig.ts` |
