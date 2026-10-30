# Shirone 配置域权威登记表（`config/<域>.yaml` ←→ 主题配置域）

> **用途**：T3（配置双档策略）的**唯一寻址依据**。Kova 写的是内容仓 `config/<域>.yaml`，
> 而 YAML 的文件名、域名 key、TS 类型名三者**不是同一个字符串**，靠推导必然出错。
> 本表由上游登记表**导出**，不是手抄。

## 0. 复现命令（逐字照跑即可）

```bash
# 工作目录：上游 Shirone 源码仓（本仓存档于 .test-tmp/upstream-Shirone-20261029）
node -e "
import('./scripts/content/config-domains.mjs').then(m=>{
  for(const x of m.CONFIG_DOMAINS)
    console.log([x.key,'config/'+x.file+'.yaml',x.type,x.module,x.partial===false?'PARTIAL=false':''].join(' | '));
});"
```

上游权威源：`scripts/content/config-domains.mjs` 的 `CONFIG_DOMAINS`（`Object.freeze`，注释明写
「新增一个可外置的配置领域：在下表补一行即可，无需改动生成器」⇒ **它就是该层的登记表**）。

---

## 1. 常量的权威值

| 常量 | 值 | 出处 |
|---|---|---|
| `CONFIG_DIRECTORY` | `config` | `config-domains.mjs` |
| `GENERATED_CONFIG_FILE` | `src/user/user-config.ts` | 同上 |
| 生成器 | `scripts/content/config-overlay.mjs` → `syncUserConfig()` | 同上 |
| 落点说明 | 放 `src/user/` 而非 `src/generated/`，**否则图标收集会跳过它** | 文件头注释 |
| 非 YAML 的配置产物 | 内容仓 `footer.html` → 主题 `src/config/FooterConfig.html`（**原样拷贝，不参与 YAML 合并**） | `FOOTER_HTML_SOURCE`/`_TARGET` |
| 域总数 | **32** | 见下表 |

---

## 2. 32 个域（`key` ｜ YAML ｜ TS 类型 ｜ 类型模块 ｜ 应用方式）

| # | `key`（`withUserConfig` 域名） | 内容仓文件 | TS 类型 | 类型模块 | 应用方式 |
|---|---|---|---|---|---|
| 1 | `site` | `config/site.yaml` | `SiteConfig` | `@/types/config` | 深合并 |
| 2 | `permalink` | `config/permalink.yaml` | `PermalinkConfig` | `@/types/permalinkConfig` | 深合并 |
| 3 | `profile` | `config/profile.yaml` | `ProfileConfig` | `@/types/config` | 深合并 |
| 4 | `license` | `config/license.yaml` | `LicenseConfig` | `@/types/config` | 深合并 |
| 5 | `expressiveCode` | `config/expressive-code.yaml` | `ExpressiveCodeConfig` | `@/types/config` | 深合并 |
| 6 | `announcement` | `config/announcement.yaml` | `AnnouncementConfig` | `@/types/announcementConfig` | 深合并 |
| 7 | `postList` | `config/post-list.yaml` | `PostListConfig` | `@/types/postListConfig` | 深合并 |
| 8 | `article` | `config/article.yaml` | `ArticleConfig` | `@/types/articleConfig` | 深合并 |
| 9 | `comment` | `config/comment.yaml` | `CommentConfig` | `@/types/commentConfig` | 深合并 |
| 10 | `contextMenu` | `config/context-menu.yaml` | `ContextMenuConfig` | `@/types/contextMenuConfig` | 深合并 |
| 11 | `fab` | `config/fab.yaml` | `FabConfig` | `@/types/fabConfig` | 深合并 |
| 12 | `sidebar` | `config/sidebar.yaml` | `SidebarConfig` | `@/types/sidebarConfig` | 深合并 |
| 13 | `footer` | `config/footer.yaml` | `FooterConfig` | `@/types/footerConfig` | 深合并 |
| 14 | `imageBloom` | `config/image-bloom.yaml` | `ImageBloomConfig` | `@/types/imageBloomConfig` | 深合并 |
| 15 | `skills` | `config/skills.yaml` | `SkillsConfig` | `@/types/skillsConfig` | 深合并 |
| 16 | `projects` | `config/projects.yaml` | `ProjectsConfig` | `@/types/projectsConfig` | 深合并 |
| 17 | `timeline` | `config/timeline.yaml` | `TimelineConfig` | `@/types/timelineConfig` | 深合并 |
| 18 | `devices` | `config/devices.yaml` | `DevicesConfig` | `@/types/devicesConfig` | 深合并 |
| 19 | `games` | `config/games.yaml` | `GamesConfig` | `@/types/gamesConfig` | 深合并 |
| 20 | `music` | `config/music.yaml` | `MusicConfig` | `@/types/musicConfig` | 深合并 |
| 21 | `anime` | `config/anime.yaml` | `AnimeConfig` | `@/types/animeConfig` | 深合并 |
| 22 | `font` | `config/font.yaml` | `FontConfig` | `@/types/fontConfig` | 深合并 |
| 23 | `llms` | `config/llms.yaml` | `LlmsConfig` | `@/types/llmsConfig` | 深合并 |
| 24 | `umami` | `config/umami.yaml` | `UmamiConfig` | `@/types/umamiConfig` | 深合并 |
| 25 | `about` | `config/about.yaml` | `AboutConfig` | `@/types/aboutConfig` | 深合并 |
| 26 | `friends` | `config/friends.yaml` | `FriendsConfig` | `@/types/friendsConfig` | 深合并 |
| 27 | `moments` | `config/moments.yaml` | `MomentsConfig` | `@/types/momentsConfig` | 深合并 |
| 28 | `albums` | `config/albums.yaml` | `AlbumsConfig` | `@/types/albumsConfig` | 深合并 |
| 29 | `compass` | `config/compass.yaml` | `CompassConfig` | `@/types/compassConfig` | 深合并 |
| 30 | `i18n` | `config/i18n.yaml` | `I18nConfig` | `@/types/i18nConfig` | 深合并 |
| 31 | `series` | `config/series.yaml` | `SeriesConfig` | `@/types/seriesConfig` | 深合并 |
| 32 | `navBar` | `config/nav-bar.yaml` | `NavBarConfigOverride` | `@/types/navBarConfig` | **整体替换**（`partial:false`） |

---

## 3. 三个会写错地方的陷阱（实测，非推测）

### 3.1 `key` ≠ YAML 文件名

`expressiveCode`→`expressive-code`、`postList`→`post-list`、`contextMenu`→`context-menu`、
`imageBloom`→`image-bloom`、`navBar`→`nav-bar`。本批 32 条里「驼峰转 kebab」**恰好**全部命中，
但这是**巧合而非契约**（`file` 是登记表里的显式字段，上游将来加一条不守驼峰规律的就会静默写错文件名）。
⇒ T3 **必须查表取 `file`，禁止字符串推导**。

### 3.2 `navBar` 不走 `withUserConfig`

| 事实 | 证据 |
|---|---|
| 登记表标 `partial: false` | `config-domains.mjs` 第 32 条 |
| 生成器对 `partial === false` 走单独分支 | `config-overlay.mjs:316`（`entries.some(e => e.domain.partial !== false)`）、`:337` |
| 消费端用**读取器**而非合并器 | `src/config/navBarConfig.ts:242` `getUserConfig("navBar") as NavBarConfigOverride \| undefined` |
| 类型是整体替换型 | `NavBarConfigOverride`（`DeepPartial` 的例外） |

⇒ Kova 对 `navBar` 的写法与其他 31 个域**不同**：它是整体替换语义，**不能只发部分键**。
（这与本仓既有的同类缺口一致：`PUT /admin/config/site-info` 必须整档。）

### 3.3 「35 个 `.ts`」里有 4 个不是域

`Shirone/src/config/*.ts` 共 **35** 个文件：

| 文件 | 性质 |
|---|---|
| `index.ts` | barrel 再导出，非域 |
| `sitemapFilter.ts` | 辅助函数，非域 |
| `integrationsConfig.ts` | 构建/集成参数（Astro integration 消费），非域、无 YAML 对应 |
| `navBarConfig.ts` | **是域**，但用 `getUserConfig` 而非 `withUserConfig` |

⇒ `withUserConfig(...)` 调用点共 **31** 个，域共 **32** 个，二者**不相等**，差额恰为 `navBar`。
早期文档写的「33 个域文件、32 个 `withUserConfig`」把 `navBar` 错算进了 `withUserConfig` 组，**以此表为准**。

---

## 4. 生效时机（决定了 T3 的写入契约）

`config/<域>.yaml` **不是被拷贝进主题**的，而是被**编译**成 `src/user/user-config.ts`。
所以「写完 YAML」到「站点可见」之间隔着一个生成步骤：

| 触发路径 | 上游脚本 | 是否重跑生成器 |
|---|---|---|
| `pnpm dev` / `pnpm start` | `node scripts/content/sync.mjs && astro dev` | ✅ 启动时**一次** |
| `pnpm build` | `node scripts/content/sync.mjs && astro build && …` | ✅ **每次构建** |
| `pnpm content:sync` | `node scripts/content/sync.mjs` | ✅ 手动 |
| `pnpm content:watch` | `node scripts/content/sync.mjs --watch` | ✅ 保存即增量，但**仅** `source.type === "path"` 且非 `local` 模式（`sync.mjs` `runWatch()` 显式 return/throw） |
| 主题 dev server 自身 | — | ❌ **不监听内容仓 `config/*.yaml`** |

dev server 的 watcher 只覆盖两处（`src/integration/index.ts:449` `astro:server:setup`）：
主题自己的 `src/config/`（仅 `invalidateConfigCache()`）与 overlay 用户目录（重建 override 注册表）。
**内容仓的 `config/` 不在其中。**

⇒ **结论（T3 必须遵守）**：Kova 写入 YAML 后，若目标是「dev 下即时可见」，必须由 Kova 自己跑一次
`node scripts/content/sync.mjs`（它会重写主题内 `src/user/user-config.ts`，而该文件**在** Vite
watcher 覆盖范围内，于是触发 HMR）；否则改动的生效边界就是**下一次 `dev` 启动或 `build`**，
面板须照本仓既有口径（`site-config` 的「保存后需跑 build 才生效」）明确标注。

顺序注意（上游注释明写，`sync.mjs:450`）：**配置覆盖必须在挂载之后**——覆盖层的类型校验会读
内容仓刚物化过来的 `src/data/*.ts`。⇒ 任何「只跑生成器、跳过挂载」的捷径都不成立。

---

## 5. 待 T3 补齐的映射（本表只到「域」粒度）

本表给到**域名 → 文件 → 类型**的寻址；**域内字段**的 Mizuki↔Shirone 对照另见
[`README.md`](README.md) §3.1（Mizuki `src/config.ts` 顶层导出 → Shirone 域）。
孤儿域（`sakuraConfig` / `pioConfig` 等无 Shirone 对应者）与归并域
（`fullscreenWallpaperConfig`→`site`、`shareConfig`/`relatedPostsConfig`/`randomPostsConfig`→`article`、
`widgetConfigs`→`sidebar.components`）按 dj 2026-10-29 裁定：孤儿报 `unsupported` 并置灰，归并做字段级拆装。
