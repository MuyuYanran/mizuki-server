# ADR-028：双主题兼容 —— 主题适配层（Mizuki / Shirone）

- 状态：**PROPOSED**（2026-10-29，待 dj 批准后转 ACCEPTED）
- 触发：dj 裁决「**同时兼容被冻结的 mizuki 和继任者 Shirone**」
- 关联：ADR-020（config.ts 受控子集物化）、ADR-024（theme-lock 双轴与门禁）、
  `docs/audits/u5-theme-a1/THEME-UPSTREAM-DECISION.md`（上游事实与漂移量化）
- 上游实测：`LyraVoid/Mizuki`（已冻结）+ `LyraVoid/Shirone`（继任者，活跃）
  各一份 `--depth 1` 克隆，本 ADR 的每一条结论都可在其中复现

---

## 1. 决策

**把「主题是什么形状」从散落各处的隐式假设，升格为一等机制：主题适配层（Theme Adapter）。**

本仓不再假定「管理对象一定是 Mizuki」。改为：

```
mizukiRoot ──► [探测] ──► ThemeKind ('mizuki' | 'shirone' | 'unknown')
                       └► ThemeLayout（configDir / dataDir / contentDir / publicDir / postsDir）
                       └► ThemeCapabilities（各域是否可管、用哪种写策略）
                            │
                            ├─ 领域模块只认 ThemeLayout / Capabilities，不再硬编码路径与变量名
                            └─ 与主题无关的域（auth / backup / media / albums / process / AI / preview / settings）零改动
```

**同时兼容**的落点不是「代码里 if 一下两套分支」，而是**各域一张按 kind 索引的策略表**。

---

## 2. 背景（上游实测事实）

### 2.1 两主题的实测差异

| 项 | Mizuki（本地分叉 / 上游 9.0） | Shirone 1.0.6 |
|---|---|---|
| 构建 | Astro **6.1.2**（本地）/ 7.1.3（上游） | Astro **7.3.8** |
| 包管理 | pnpm 10.22.0 / 11.5.3 | pnpm **11.28.2** |
| 站点配置 | **单文件** `src/config.ts`，导出 `siteConfig` / `commentConfig` / `navBarConfig` 等声明 | **目录** `src/config/`，**35 个域文件**，每个 `withUserConfig("<域>", 默认值)` |
| 配置覆盖机制 | 无（本仓自造：ADR-020 侧车 + ts-morph 声明级置换） | **内建覆盖层**：`src/utils/config-overlay.ts`，用户覆盖在**内容仓 `config/*.yaml`**，深度合并（对象递归 / 数组整体替换） |
| `src/data/` | anime.ts、bilibili-data.json、devices.ts、**diary.ts**、friends.ts、projects.ts、skills.ts、timeline.ts | anime.ts、**compass.ts**、devices.ts、friends.ts、**games.ts**、**music.ts**、projects.ts、skills.ts、timeline.ts、**anime-snapshots/**（**无 diary.ts / bilibili-data.json**） |
| content 集合 | posts、spec | posts、spec、**series**（`src/content/series/*.md`）、**moments**（`src/content/moments/*.md`，**取代 diary**） |
| 文章格式 | `**/*.md` | `**/*.{md,mdx}` |
| posts frontmatter | 33 个字段名（逐字段对照表见 [`docs/refs/theme-compat/README.md`](../refs/theme-compat/README.md) §2.1–§2.4） | **双向不兼容，不是单向增量**，且 **三个量必须分开数**（详见 §19）：**存在性** — 仅 Shirone **+8**（`publishedAt` / `updatedAt` / `series` / `seriesOrder` / `hideHomeContent` / `prevUrl` / `nextUrl` / `license`）、仅 Mizuki **−5**（`priority` / `author` / `sourceLink` / `licenseName` / `licenseUrl`）、两档都有但**改型 1**（`password`）；**搬运** — 另有 **4 条字段映射**（`licenseName` / `licenseUrl` / `author` / `sourceLink` → `license.{name,url,author,source}`）|
| 内容分离 | `scripts/sync-content.js`（env 驱动，junction/copy） | **一等机制**：`shirone.content.json`（`source{git url+ref}` + `mounts{content,data,assets,public}` + `keep`/`prune`）+ CLI（`content:sync/status/validate/eject/export`） |
| 部署形态 | 仓库 = 站点 | **两种等价形态**：源码模板（clone 本仓）**或 npm 包**（`pnpm add shirones`，主题代码不在用户仓里，`src/integration/paths.ts` 的 `detectThemeRepo` 自行解析 configDir/dataDir/contentDir） |

### 2.2 本仓当前的 Mizuki 耦合点（逐条清单）

| # | 位置 | 耦合内容 |
|---|---|---|
| C1 | `modules/system/mizuki-detector.service.ts` | 4 项检测：package.json 含 astro / `astro.config.{mjs,ts,js}` / `src/data/` 含 `diary.ts`\|`friends.ts` / `src/content/posts/` |
| C2 | `packages/shared/src/theme-profile.ts` | `MizukiTier1Profile`：指纹角色 + `declarationProbes` 直指 `siteConfig` / `siteConfig.lang` / `commentConfig` / `navBarConfig` / `navBarConfig.links`（**Mizuki 单文件声明**的符号名） |
| C3 | `modules/data-files` + `modules/collections/registry.ts` | 七类集合的**文件路径 + 变量名 + 字段 schema** 全按 Mizuki `src/data/*.ts` 写死 |
| C4 | `modules/posts` | `src/content/posts`（`POSTS_REL_DIR`）+ Mizuki frontmatter schema（`PostFrontmatterSchema`） |
| C5 | `modules/site-config/site-config.service.ts` | `configTsPath()` = `<root>/src/config.ts`；ts-morph 声明级定点置换 |
| C6 | `modules/theme/theme-registry.service.ts` | 基线 `data/theme-baseline/baseline.json` + 漂移轴（按 Mizuki 编目）+ 探针门禁 |
| C7 | `modules/media` / `modules/albums` | `public/images/**`、`public/images/albums/<名>/info.json` |
| C8 | `modules/system` init | `mode: manage\|additive\|overwrite`（**已裁定为无行为的声明**，见 `u5-theme-a1` 相关审计） |

### 2.3 一个偶然的好消息 + 一个必须堵的口子

- **好消息**：C1 的第 3 项接受 `diary.ts` **或** `friends.ts`，而 Shirone 有 `friends.ts` ⇒ **Shirone 工程当前就能通过初始化检测**。另外第 4 项 `src/content/posts/` 两主题都在。
- **必须堵的口子**：通过检测 ≠ 能用。Shirone 上没有 `src/config.ts`（C5 会 404，ADR-020 的显式失败语义能兜住，**不会写坏东西**），但 `data-files` 会去找 `diary.ts` 而 Shirone 里根本没有 —— **这个是"静默写坏"的风险面**：必须先做 §3 的能力协商，再允许任何写操作。

---

## 3. 适配层设计

### 3.1 三个新概念（落在 `packages/shared`，前后端共用）

```ts
export const ThemeKindSchema = z.enum(['mizuki', 'shirone', 'unknown']);

/** 主题目录布局：一次解析，全仓消费；禁在领域模块里再拼路径 */
export interface ThemeLayout {
  kind: ThemeKind;
  root: string;          // 用户给的 mizukiRoot
  configDir: string;     // mizuki: <root>/src/config.ts（单文件）| shirone: <root>/src/config/
  dataDir: string;       //      <root>/src/data
  contentDir: string;    //      <root>/src/content
  postsDir: string;      //      <root>/src/content/posts
  publicDir: string;     //      <root>/public
}

/** 各域能力：能不能管、用哪种写策略、哪些集合存在 */
export interface ThemeCapabilities {
  config:  { supported: boolean; strategy: 'ts-morph-declaration' | 'overlay-yaml' | 'none' };
  dataFiles: { supported: boolean; collections: CollectionId[] };  // 按 kind 的集合清单
  posts:   { supported: boolean; extensions: string[]; frontmatterSchemaId: string };
  contentCollections: { supported: boolean; ids: ('series'|'moments')[] }; // shirone 专有
  themeLock: { supported: boolean; profileId: string };
}
```

### 3.2 各域按 kind 的策略表（**这就是"兼容"的实现形态**）

| 域 | Mizuki | Shirone | 共用部分 |
|---|---|---|---|
| **探测** | 现有 4 项 | `src/config/` 目录 + `src/data/friends.ts` + `package.json` name=`shirone`\|依赖含 `shirones` | 同一 `detect()` 返回 `ThemeKind` |
| **站点配置** | ts-morph 声明级置换 `src/config.ts`（ADR-020，保留） | **覆盖层写 YAML**（`config/<域>.yaml`）—— **零侵入，不碰主题源码**；域清单 = `src/config/*.ts` 的 35 个域 | 侧车留档 / pre_write 备份 / 原子写 / 门禁 |
| **数据文件集合** | diary / friends / projects / timeline / skills / devices / anime（7 类，`src/data/*.ts`） | friends / projects / timeline / skills / devices / anime / **compass** / **games** / **music**（9 类）；**diary → moments**（content collection，另一通道） | `data-files` 8 步写管线原样复用，只换「文件+变量名+schema」表 |
| **内容集合（Shirone 专有）** | — | `series` / `moments`（`src/content/{series,moments}/*.md`） | 走 posts 那套 frontmatter 读写管线（新增一条 registry 条目） |
| **文章** | `**/*.md` + Mizuki frontmatter schema | `**/*.{md,mdx}` + Shirone frontmatter schema（+publishedAt/updatedAt/series/seriesOrder/license/hideHomeContent/prevUrl/nextUrl） | posts 模块骨架、目录式/单文件、about、article 索引表 |
| **theme-lock** | `MizukiTier1Profile`（保留） | 新增 `ShironeTier1Profile`（探针靶点 = `src/config/*.ts` 的 `withUserConfig("<域>", …)` 调用形态，而非符号名） | 双轴机制、基线载体、`GET /admin/theme/status` 形状 |
| **媒体 / 相册** | `public/images/**` | 同（Shirone 的 `public/` 结构一致，实测有 `public/images`） | 上传五件套、引用注册表、409 引用检查 |
| **与主题无关的域** | auth / backup / process / AI / preview / settings / site_setting / article 索引表 | **完全一致** | 零改动 |

### 3.3 Shirone 的配置管理为什么反而更简单

Shirone **内建覆盖层**：`withUserConfig(domain, defaults)` 把内容仓 `config/<域>.yaml` 深合并进默认值，
且覆盖值的键名/取值在生成期已由 `tsc` 对着 `src/types/*Config.ts` 校验过。

⇒ 本仓对 Shirone 的配置写入**可以是零侵入的**：只写 YAML 覆盖文件，不碰 `src/config/*.ts` 一个字节，
**也就不需要 ts-morph、不需要声明探针、不需要 `originals` 留档还原**。
（对比 ADR-020 为 Mizuki 付出的全部复杂度，Shirone 侧成本低一个量级。）

> ⚠ 待确认（§6 Q1）：源码模式下覆盖层从哪读 —— `docs/content-separation/config-overlay.md` 指向「内容仓 `config/*.yaml`」，
> 而仓库模式（无内容仓）下用户覆盖的落地位置需要实读 `src/user/user-config.ts` 与 `scripts/content/config-overlay.mjs` 才能定死。

---

## 4. 影响面与红线

- **不动**：本仓与主题无关的域、公开 API（P8 已冻结）、数据库 12 表结构。
- **新增**：`packages/shared` 增 `ThemeKind` / `ThemeLayout` / `ThemeCapabilities` / Shirone frontmatter schema / Shirone 集合表。
- **分层**：适配层属 L0（`packages/shared` + `server/src/common`）或作为独立 `modules/theme-adapter`（L2，仅 L0 依赖）；
  **不得让领域模块互相 import**（红线 3 不变）。
- **管理 API additive**：`GET /admin/theme/profile` 新增；`GET /admin/theme/status` 增 `kind` 字段；既有响应形状零变化。
- **写盘纪律**：Shirone 覆盖层写 YAML 也必须走 `safeJoin` + pre_write 备份 + `atomic-write.ts`（红线 1）。

---

## 5. 分期（每期一个小批次，独立验收）

| 期 | 交付物 | 验收 |
|---|---|---|
| **T1 探测与画像** | `ThemeKind` / `ThemeLayout` / `ThemeCapabilities` schema + 探测实现 + `GET /admin/theme/profile`（只读） | 对本地 Mizuki 目录 → `kind=mizuki`；对 Shirone 克隆 → `kind=shirone`；两者 `capabilities` 与实测一致；**零写盘** |
| **T2 数据文件层双套** | collections registry 按 kind 选表（先只读） | 两主题各自 `GET /admin/collections/:type` 返回正确条目；Shirone 多出 compass/games/music，diary 返回 404 而非写坏 |
| **T3 配置层双策略** | Shirone 覆盖层读写（YAML）+ 探针分套 | Shirone 上 `PUT /admin/config/...` 写 YAML；主题源码 `src/config/**.ts` **sha256 不变**（零侵入自证）；Mizuki 侧行为零回退 |
| **T4 文章层** | frontmatter schema 双套 + `**/*.md,mdx` | 两主题各自读写往返一致；Shirone 的 series/seriesOrder/license 字段往返不丢 |
| **T5 内容集合（series/moments）** | 新通道：`src/content/{series,moments}/` 读写 | Shirone 上 moments 增删改查通过；Mizuki 上该域返回「不支持」而非报错 |
| **T6 前端按 kind 渲染** | 集合菜单、站点配置页按 `capabilities` 生成 | 两主题各走一遍手验清单 |
| **T7 端到端** | 建一个 Shirone 测试工程（内容仓 + 源码模板各一），跑通 init→内容→配置→构建 | 三连全绿 + 手验清单 |

**T1 之外的每一期都以 T1 的画像为输入**，且每期都能单独停下（不出现"半改状态"）。

---

## 6. 待 dj 裁决 / 待实测

| # | 问题 | 影响 |
|---|---|---|
| Q1 | Shirone **源码模式**下用户覆盖的落地位置（`src/user/user-config.ts` 如何生成、能否直接写） | 决定 T3 的写策略落地形态（写 YAML 还是写生成物） |
| Q2 | 是否要支持 Shirone 的 **npm 包模式**（用户仓里没有 `src/pages`/`src/config`，只有 `astro.config.mjs`） | 影响 T1 探测与所有域的路径解析（可能需读 `.shirones/` 或 `shirones/` 目录） |
| Q3 | Shirone 的**内容分离**（`shirone.content.json` + mounts）是否纳入管理面 | 影响「主题根」是否还存在 —— mounts 会让 content/data/public 指向**别的仓** |
| Q4 | 是否顺势把 `mode: manage\|additive\|overwrite` 三档**真正接上**（现在无行为） | 与本次兼容层天然重合：capabilities 就是三档的实体 |
| Q5 | 本地 `BlogFiles/Mizuki` 的处置（`u5-theme-a1` 的四条路） | 若走「服务端双主题」，本地主题可维持现状（路 C），不必先迁移 |

---

## 7. 已否决的替代

| 替代 | 否决理由 |
|---|---|
| 在领域模块里写 `if (kind === 'shirone')` 分支 | 分支会散到 8 个模块 × N 个方法；新增第三个主题时成本线性上升 |
| 为 Shirone 另建一个 fork 版 server | 双份维护；auth/backup/media/process/AI 等 70% 代码完全重复 |
| 只做探测、不做能力协商 | 通过检测却写坏数据（§2.3 的口子） |
| 立刻把本地主题换成 Shirone | 站点现在是好的；换主题是迁移项目，与「服务端双主题兼容」正交 |

---

## 8. 参考（可复现）

```bash
# 上游事实来源（本 ADR 每条结论均可复现）
git clone --depth 1 https://github.com/LyraVoid/Mizuki.git     # 已冻结（HEAD 即废弃通知）
git clone --depth 1 https://github.com/LyraVoid/Shirone.git    # 继任者，Astro 7.3.8

# Shirone 关键面
cat   Shirone/src/content.config.ts              # posts(含 mdx) / spec / series / moments
ls    Shirone/src/config/                        # 35 个域文件
cat   Shirone/src/utils/config-overlay.ts        # withUserConfig / getUserConfig
cat   Shirone/shirone.content.example.json       # content separation 契约
cat   Shirone/docs/npm-package-mode.md           # 源码模式 vs npm 包模式
```

---

## 9. 追加（2026-10-29 第二回合）：字段级对照实测落地，Q1 结案

**新增权威参考**：[`docs/refs/theme-compat/README.md`](../refs/theme-compat/README.md)（229 行；四张表：集合对照 / posts frontmatter 逐字段 / 站点配置域对照 / 目录与构建契约）。
本 ADR §2.1 的每一行差异都能在该文档里查到来源路径。

### 9.1 Q1 结案：Shirone 覆盖层的落点已查明

覆盖层**不在** `src/config/*.ts`，而是**脚本生成的单文件**：

```
Shirone/src/user/user-config.ts                ← 覆盖层落点（生成物）
Shirone/scripts/content/config-overlay.mjs     ← 生成器（读内容仓 config/*.yaml → 写该文件）
```

⇒ **T3 的写法据此定形**：服务端**不直接手写 `src/user/user-config.ts`**（生成物，手写会被下次生成覆盖），
而是写**上游输入**（内容仓 `config/<域>.yaml`）再触发/等待生成。这与 ADR-020 对 Mizuki 的「留档 + 还原」是**完全不同的形态**，
零侵入性更强（`src/config/*.ts` 与生成物都由服务端之外的角色持有）。

### 9.2 三处必须记住的实测差异（修正 §2.1 的粗粒度描述）

1. **`diary` → `moments` 不是「换个文件」**：`Shirone/src/content/moments/*.md` 是 **content collection**，字段语义整体变形 ——
   `id` **消失**（身份派生自文件名）、`date: string` → **`published: z.date()` 必填**、
   `images: string[]` → **`{src, alt}[]`**（默认 `[]`）、新增 `pinned`/`draft`、**`content` 由字段变为 Markdown 正文**。
   ⇒ 服务端现有的「条目 = 带 id 与 content 字段的对象」模型对它**不成立**；T5 必须是独立通道，不能靠 registry 复用。
2. **站点配置是「18 个顶层导出 → 33 个域文件（32 个带 `withUserConfig`）」的重新切分**，且存在**归并**与**孤儿**：
   - 归并：`fullscreenWallpaperConfig`→`siteConfig`；`shareConfig`/`relatedPostsConfig`/`randomPostsConfig`→`articleConfig`；`widgetConfigs`→`sidebarConfig.components`
   - **孤儿（Shirone 无对等域）**：`sakuraConfig`、`pioConfig` —— Shirone 的 `sakura` 只是 `siteConfig.texture.defaultPreset` 的取值（语义不同）；全 `src` grep `live2d|pio` 无命中
   ⇒ T3 不能做「同名域直映」，必须逐域建映射表，孤儿域显式降级为「不支持」。
3. **posts frontmatter 双向不兼容**（不是单向增量）：Shirone **删** `priority`/`author`/`sourceLink`/`licenseName`/`licenseUrl`；
   **增** `series`(default `""`+trim)、`seriesOrder`、`license`(`string` \| `{enable,name,url,author,source}`)、
   `hideHomeContent`(default `true`)、`publishedAt`/`updatedAt`、`prevUrl`/`nextUrl`；
   `password` 改为 `string|number → transform(String)` 且**无 default**。
   ⇒ T4 的双 schema 必须**双向**（Mizuki→Shirone 丢字段 / Shirone→Mizuki 补字段），不能只写一个方向。

### 9.3 T1 交付与验收

| 项 | 结果 |
|---|---|
| 新增 | `packages/shared/src/theme-adapter.ts`、`apps/server/src/modules/theme/theme-adapter.service.ts`、`apps/server/test/modules/theme/theme-adapter.spec.ts` |
| 改动 | `packages/shared/src/index.ts`、`modules/theme/theme.module.ts`、`modules/theme/theme.controller.ts`（新增 `GET /admin/theme/profile`） |
| 命名偏离（**必要**） | 档案 schema 定名 `ThemeAdapterProfileSchema`/`ThemeAdapterProfile` —— `theme-profile.ts:74` 已导出 `ThemeProfileSchema`，两条 `export *` 会触发 `TS2308`。**禁恢复撞名** |
| 架构师验收 | 单测 6/6 独立复跑通过；`GET profile` 逐键重建 layout **剔除 `root`**（红线 6）已核实；测试仅用 `mkdtemp`（红线 9）；service 只 `statSync`/单文件读取，无递归 |
| **验收发现并修复** | 执行方未跑 lint，实际存在 `UNKNOWN_CAPABILITIES` 未使用 → lint 红。已由架构师删除该死常量（同一画像由 `unknownCapabilities()` 工厂覆盖），`pnpm lint` 现 **EXIT=0** |
| 顺带订正 | `AGENTS.md` §3 写的 `node node_modules/typescript/bin/tsc` 路径**本机不存在**，已按实测改为 `packages/shared/node_modules/typescript/bin/tsc` |

### 9.4 §6 待裁决表状态更新

| # | 问题 | 状态 |
|---|---|---|
| Q1 | Shirone 源码模式下用户覆盖的落地位置 | ✅ **已查明**（见 §9.1） |
| Q2 | 是否支持 Shirone npm 包模式 | ⏳ 待 dj |
| Q3 | Shirone 内容分离（mounts）是否纳入管理面 | ⏳ 待 dj |
| Q4 | `mode` 三档是否顺势接上 | ⏳ 待 dj |
| Q5 | 本地 `BlogFiles/Mizuki` 的处置 | ⏳ 待 dj |

> ↑ 该表为 2026-10-29 第二回合的**历史快照**；Q2–Q5 已于同日晚由 dj 裁定，**结案见 §10**。

---

## 10. 追加（2026-10-29 第三回合）：Q2–Q5 裁定结案 + 三项新实测 + T2 交付

### 10.1 dj 裁定（**结案，不再是待定项**）

| # | 裁定 | 理由（dj 原意） | 对实现的硬约束 |
|---|---|---|---|
| Q2 | **当前阶段不支持 Shirone npm 包模式，只认源码仓模式** | Kova 的集合（`src/data/*.ts`）重度依赖对主题目录源码文件/AST 的直接读写；npm 包模式下主题在 `node_modules` 里只读，集合读写与配置覆盖会劈叉成两套寻址逻辑 | 包模式在**适配器探测**阶段直接归入**不支持 / `unknown` 降级**；先把「源码仓（含挂载内容仓）」主干跑通，npm 包模式留作远期特性 |
| Q3 | **内容分离 `mounts` 只读感知 + 路径跟随，不提供挂载配置 UI** | 配置上游是内容仓 `config/<域>.yaml`，Kova **必须**能解析 `mounts` 以定位真实读写位置，否则 T3/T4/T5 会写错地方；但「改挂载路径 / 初始化挂载结构」是低频基建操作 | 启动时只读接管（由用户本地配置文件决定）；管理面**不出现**挂载编辑 UI |
| Q4 | **`mode` 三档顺势接上契约与透传，UI 侧先做最小展示** | 反正 T1 的档案 schema 与 T3 的配置映射都要动，此刻写进 Schema 与能力画像最便宜；等以后再补要改一轮 shared 契约并重刷 dist | 后端**完整暴露**；前端只读消费，不据此分支 |
| Q5 | **本地 `BlogFiles/Mizuki` 保持冻结，严禁自动化流程触碰** | 单测/E2E 已严格走 `os.tmpdir()` / fixture；本地那份留作**纯手工冒烟的活体对照样本** | Kova 自动化流程一律不碰它；测试不得引它为 fixture（红线 9 的加强表述） |

### 10.2 三项新实测（本轮新增，均可复现）

**(a) 内容仓 `config/<域>.yaml` 的生效时机 —— 回答 dj 的关切①：dev **不会**自动重跑生成器。**

| 触发路径 | 上游脚本 | 重跑生成器 |
|---|---|---|
| `pnpm dev` / `start` | `node scripts/content/sync.mjs && astro dev` | ✅ **仅启动时一次** |
| `pnpm build` | `node scripts/content/sync.mjs && astro build && …` | ✅ **每次构建** |
| `pnpm content:sync` | 手动 | ✅ |
| `pnpm content:watch` | `sync.mjs --watch` | ✅ 但 `runWatch()` 对 `mode === "local"` 直接 return、对 `source.type !== "path"` 抛错 |
| dev server 自身 watcher | `src/integration/index.ts:449` `astro:server:setup` | ❌ 只覆盖主题 `src/config/`（`invalidateConfigCache()`）与 overlay 用户目录（重建注册表），**不含内容仓 `config/`** |

⇒ **结论**：Kova 写完 YAML 后要「dev 下即时可见」，必须**自己跑一次 `node scripts/content/sync.mjs`**——
它会重写主题内 `src/user/user-config.ts`，而该文件**在** Vite watcher 覆盖范围内，于是触发 HMR。
若不跑，则生效边界 = 下一次 `dev` 启动或 `build`，面板须按本仓既有口径（`site-config` 的
「保存后需跑 build 才生效」）显式标注。
**顺序不可颠倒**（`sync.mjs:450` 上游注释）：配置覆盖必须在**挂载之后**——覆盖层类型校验会读内容仓
刚物化过来的 `src/data/*.ts`。⇒ 「只跑生成器、跳过挂载」的捷径不成立。

**(b) 配置域的权威登记表 = 32 个域，且 `navBar` 是例外。**

上游 `scripts/content/config-domains.mjs` 的 `CONFIG_DOMAINS`（`Object.freeze`，注释明写「新增域补一行即可，
无需改动生成器」）就是该层登记表。实测：**域 32 个**，而 `withUserConfig(...)` 调用点只有 **31 个**，
差额恰为 `navBar`（`src/config/navBarConfig.ts:242` 用 `getUserConfig("navBar")` **整体替换**，
登记表标 `partial: false`，生成器 `config-overlay.mjs:316/337` 有对应分支）。
另：`config/` **不是被拷贝**进主题的，而是被**编译**成 `src/user/user-config.ts`；
内容仓 `footer.html` → 主题 `src/config/FooterConfig.html` 属**原样拷贝**、不参与 YAML 合并。
逐域表（key ｜ YAML ｜ TS 类型 ｜ 模块 ｜ 应用方式）已落 **`docs/refs/theme-compat/shirone-config-domains.md`**，
并订正了该 README §3.2 早期「33 域 / 32 `withUserConfig`」的错误口径。
⇒ T3 **必须查表取 YAML 文件名，禁止从 key 推导**（`expressiveCode`→`expressive-code` 等 5 处不一致；
本批「驼峰转 kebab」恰好全中，是巧合不是契约）。

**(c) Shirone `devices` 的身份字段是 `id`，不是 `name`（更正 T2 简报的一处错误）。**

上游 `src/types/devicesConfig.ts:36` `id: string`（**必填**，注释「稳定标识（URL 片段 / 测试选择器）」），
`src/data/devices.ts:8` 实测首条带显式 `id: "macbook-pro-16"`。
⇒ T2a 简报里我写的 `idField: 'name'` **是错的**，执行方拒绝自创、按简报落并标注待裁，属正确处理。
同时上游 `DeviceItem` 字段面（必填 `id/name/brand/category/status/specs/description` + 可选
`enable/specDetails/image/icon/link/featured/year`）比本仓 shared 的 `DeviceItemSchema`
（`.strict()` 五字段）宽得多 ⇒ Shirone 档下 devices 的**写入校验会 400**（读路径不受影响）。
修法**不是**放宽 Mizuki 的 schema（那会污染冻结面），而是**给 Shirone 档加自己的 item schema**——
这正是适配层存在的目的。

### 10.3 T2 交付与验收（主题分档注册表）

| 项 | 结果 |
|---|---|
| 步1 | 适配器下沉 L0：新增 `apps/server/src/common/theme/theme-adapter.ts`（普通类，无 `@Injectable`）；`modules/theme/theme-adapter.service.ts` 改为 `@Injectable() class ThemeAdapterService extends ThemeAdapter {}`。`GET /admin/theme/profile` 行为未动 |
| 步2 | `collections/registry.ts`：`REGISTRY`（Mizuki 七条**逐字保留**）+ `SHIRONE_REGISTRY`（八条）+ `TABLES` + `getRegistryTable(kind)` + `findCollectionDef(type, kind)` + `currentThemeKind()` |
| 步3 | `collections.controller.ts`、`public-collections.controller.ts`、`media-reference.ts` 改按 `currentThemeKind()` 取表；`unknown` **兜底 Mizuki 表**（探测失败不得让功能全灭） |
| 测试 | 新增 `test/modules/collections/theme-registry.spec.ts`（5 用例） |
| **架构师独立复验** | `git diff` 确认 Mizuki 七条**未动**（`@@ -118,6 +131,124 @@` 只在 `];` 之后新增）；复跑 3 个 spec **24/24 通过**（theme-registry 5 + theme-adapter 6 + p4c 13）；`pnpm lint` **EXIT=0** |
| p4c 是有效证据 | 该 e2e 跑的是 `kind='mizuki'` 分支（fixture 含 astro 依赖与 `src/data/diary.ts`）⇒ 是「Mizuki 行为一条没变」的真证据，**不是** `unknown` 兜底路径 |
| 未决（→ T2c） | ① Shirone devices `idField` 应为 `id`；② 需要 Shirone 档专属 `DeviceItem` schema |

### 10.4 T3–T5 方向确认（dj 逐条确认）

| 项 | 确认内容 |
|---|---|
| T3 写入面 | **严禁手写 `src/user/user-config.ts`**（生成物）；只写内容仓 `config/<域>.yaml`。写 YAML 比用 `ts-morph` 硬啃 AST 稳健 |
| T3 生效面 | 见 §10.2(a)：需 Kova 自行触发一次 `content:sync`，或明确标注「下次构建生效」 |
| T3 孤儿域 / 归并域 | 孤儿域（`sakuraConfig`/`pioConfig` 等）在接口层按 capabilities 报 `unsupported`，前端置灰/隐藏，**绝不硬造假配置**；归并域（汇入 `article` 的三项等）在适配层做**字段级拆装** |
| T4 | 按 §9.2 的删 5 增 8 字段清单**双向**各自维护白名单与默认值回退；未知/不支持的源字段在**转换摘要里显式提示**，不静默丢弃 |
| T5 | `moments` 本质是 Markdown Content Collection（无 `id`、文件名寻址、正文在 body），与 `posts` **同构**，与 `src/data/*.ts` 不是一个物种 ⇒ **彻底不塞 `collections/registry.ts`**，复用/参考 `posts` 的 L1 markdown/frontmatter 基建开独立通道 |
| 执行纪律 | 「简报没写 = 执行方大概率不跑」已被 T1 的 `UNKNOWN_CAPABILITIES` 证实 ⇒ 后续**所有**子代理简报把 `pnpm lint` + `pnpm build` + 对应单测**焊死为固定收尾门禁** |

### 10.5 §6 待裁决表终态

| # | 问题 | 状态 |
|---|---|---|
| Q1 | Shirone 源码模式下用户覆盖的落地位置 | ✅ 已查明（§9.1） |
| Q2 | 是否支持 Shirone npm 包模式 | ✅ **不支持**（§10.1） |
| Q3 | 内容分离 mounts 是否纳入管理面 | ✅ **只读感知 + 路径跟随**（§10.1） |
| Q4 | `mode` 三档是否顺势接上 | ✅ **接上，后端完整暴露 / 前端只读**（§10.1） |
| Q5 | 本地 `BlogFiles/Mizuki` 的处置 | ✅ **冻结，自动化不触碰**（§10.1） |
| Q6 | 是否把 `content:sync` 纳入白名单任务（使 dev 下配置改动即时可见） | ⏳ 见 §10.6，倾向**加**（无参、固定、不破「不接受用户传参」的原意） |

### 10.6 新出现的一个小决策（Q6）

现状：任务白名单硬编码 `install|dev|build|preview`（红线 4.5，本意是**不接受用户传参**）。
若要让面板在改完配置后让 dev 立即生效（§10.2(a)），需要 Kova 具备一次 `node scripts/content/sync.mjs` 的能力。

两个选项：

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（倾向）** | 白名单新增**固定无参**的 `sync` 任务；面板在写配置/写内容后提供「同步内容」显式动作 | 触碰冻结的任务集合，需在 ADR/CHANGELOG 登记；不违反「不接受用户传参」的原意（任务名与参数都不来自用户） |
| B | 不新增任务；面板统一标注「下次构建/启动生效」 | 零契约改动，但 dev 体验差，且与「更完善更易用」的目标相悖 |

⇒ 默认按 **A** 推进（dj 已授权「任何可以使该项目更完善更易用的修改皆被允许」），
实施时同步登记 ADR 与 CHANGELOG；若 dj 否决则回落 B。

---

## 12. 追加（2026-10-29 第五回合）：**裁定 A 结案** + 一个由此暴露的误判 bug + Q6 批准

### 12.1 dj 裁定：「主题重新拉取」= **A —— 对齐 `LyraVoid/Mizuki` HEAD**（`c06f000`，7.1.3）

理由（dj 原意）：**终结「直接篡改上游默认源码」的历史包袱**。既然 HEAD 已把配置解耦成
`overrides/<导出名>.ts` 侧车、与 Shirone 的 `config/<域>.yaml` 在哲学上同构
（默认值归上游 / 个人覆盖归侧车 / 未知覆盖名构建期直接报错），Kova 没有理由停留在 6.1.2 的脏改模式。

⇒ **T3 做成三档兼容**（dj 逐字给的边界）：

| 档 | 判据（dj 表述） | 配置读写路径 | 与今日关系 |
|---|---|---|---|
| **mizuki-legacy**（6.1.2） | 存在**单文件** `src/config.ts` | 现有 `ts-morph` + `originals` 路径**不动** | 本地 `BlogFiles/Mizuki` 与存量 `test/fixtures/mizuki` **零退化** |
| **mizuki**（HEAD 7.1.3） | 存在 `src/config/` 目录、无 `shirone.content.json`、属 Mizuki 包特征 | `overrides/<导出名>.ts` 侧车；**若开启内容分离则跟随 T5a 定向到内容仓 `overrides/`** | 新能力 |
| **shirone** | — | 内容仓 `config/<域>.yaml` 侧车 | T3 既定 |

dj 同时确认：**「压住 T3/T4 不盲派」是正确的纪律**（映射表按 A 与按 B 是两份不同东西）。

### 12.2 由此暴露的一个**误判 bug**（裁定 A 让它从潜伏变实活）

**问题**：Shirone 判据是 `src/config/` 是目录 **且** `src/config/siteConfig.ts` 是文件
（`theme-adapter.ts` 的 `shironeConfigDirOk`）。但 **Mizuki HEAD 的 `src/config/` 里也有 `siteConfig.ts`**
—— 两档在这条判据上**完全重合**。⇒ 判定次序里 shirone 分支在前，**Mizuki HEAD 会被判成 `shirone`**，
进而拿到 `overlay-yaml` 策略去写 Shirone 的 `config/<域>.yaml`，写错地方。

本机实测（集合差，不是推测）：两档 `src/config/*.ts` 的 **12 个文件名完全重合**
（`announcementConfig` `commentConfig` `expressiveCodeConfig` `footerConfig` **`index.ts`**
`licenseConfig` `musicConfig` `navBarConfig` `permalinkConfig` `profileConfig` `sidebarConfig` **`siteConfig.ts`**）。

**可靠判别子（实测唯一性）**：

| 叶子（固定路径，statSync 常数级） | 只在 | 数量证据 |
|---|---|---|
| `src/config.ts`（单文件） | **mizuki-legacy** | 本地快照 17321 B；HEAD `git ls-tree` 命中 **0** |
| `src/config/overrideLoader.ts` | **mizuki HEAD** | Mizuki HEAD `src/config/` 21 文件独有 |
| `src/config/integrationsConfig.ts` 或 `src/integration/index.ts` | **shirone** | Shirone 35 文件独有 |

**修正后的判别阶梯**（每步都是固定叶子，无递归）：

1. `src/config.ts` 是文件 → **mizuki legacy**（`configDir='src'`，`configFile='src/config.ts'`）
2. `src/config/overrideLoader.ts` 是文件 → **mizuki HEAD**（`configDir='src/config'`，`configFile=null`）
3. `src/config/integrationsConfig.ts` 或 `src/integration/index.ts` 是文件 → **shirone**
4. 依赖含 `shirones`（或 `name === 'shirone'`）但 1–3 全不成立 → **包模式 → `unknown`**（Q2）
5. `astro` 依赖 + `astro.config.*` + （`src/config.ts` | `src/data/diary.ts`）→ mizuki legacy（既有兜底分支）
6. 否则 → `unknown`

> 注意：`ThemeKind` **不新增取值**。三种形态里两种都是 `mizuki`，而**集合表在两种 Mizuki 形态下完全相同**
> （都是 `src/data/*.ts`）——若拆成两个 kind，会逼出两份逐字相同的注册表。区分放在
> **`layout.configDir` / `layout.configFile` / `capabilities.config.strategy`** 上即可，**零契约膨胀**。
> （dj 原话已给出许可：「或内部子形态判定」。）

### 12.3 Q6 批准：`content:sync` 进固定无参白名单

dj 裁定：**批准**。理由：硬编码任务白名单的防御目标是阻断「任意命令/参数注入」，而 `content:sync`
是**固定脚本、零外部入参**，符合安全边界。

**执行顺序铁律（dj 逐字）**：必须**先完成内容仓挂载物化**（尤其 `src/data/*.ts`）→ **再执行配置覆盖生成**
→ 最后触发 **Vite watcher 范围内**的文件更新以激活 dev HMR；把这个调用链封装成
「配置/内容写盘后的标准收尾动作」（或显式可触发动作），并在 **ADR 与 CHANGELOG 留档**。

> 落地要点：该顺序**由上游脚本自身保证**——Shirone 的 `sync.mjs` 就是先挂载再 `syncUserConfig`
> （`:450` 注释明写「配置覆盖必须在挂载之后」）；Mizuki HEAD 的 `sync-content.js` 同理。
> ⇒ Kova **只负责按主题档位调用**，不重implement、不拆步骤。

**新增的一处实测（Mizuki HEAD `package.json`）**：

| 键 | 值 |
|---|---|
| `sync-content` | `node scripts/sync-content.js` |
| `predev` | `node scripts/sync-content.js \|\| true` |
| `prebuild` | `node scripts/sync-content.js \|\| true` |
| `dev` | `astro dev` |
| `build` | `node scripts/update-anime.mjs && astro build && …` |

⇒ ①`pnpm dev` / `pnpm build` **自带** sync（npm lifecycle 前置钩子），与 Shirone 的显式前缀等价；
② **`|| true` 是雷**：sync 失败被静默吞掉，构建照跑但覆盖层是旧的/空的。
⇒ Kova 自己的 `sync` 动作**必须回传真实退出码**，不得复制这个吞错写法。
③ `build` 里含 `update-anime.mjs`（**联网**步骤）——T7 的端到端构建需注意该步骤的失败语义。

### 12.4 dj 对近期修正的确认

| 项 | dj 判定 |
|---|---|
| `TABLES.unknown = []` 收口 | ✅ 正确。原「兜底 Mizuki 表」会造成假地址盲写、违背 Q2；改空表 + `unknownCollectionMessage()` 明确报错，91 个存量用例验证零误伤，逻辑闭环 |
| `ShironeDeviceItemSchema` + `idField:'id'` | ✅ 及时纠正简报偏差：既保住 Mizuki 五字段 `.strict()` 冻结面，又完整吃下 Shirone 的字段面与只读 `id` 定位器语义 |
| T5a 先行垫底 | ✅ 抓准 `prune: true` 这个致命前提：不先解析 `shirone.content.json` + `content.lock.json`，写进代码仓的东西下次 sync 全被删光 |

---

## 13. 追加（2026-10-29 第六回合）：T5a 交付与验收 + T3 的三条硬约束

### 13.1 T5a 交付（L0 内容源解析）

| 项 | 结果 |
|---|---|
| 新增 | `apps/server/src/common/theme/content-source.ts`（L0 普通导出 `resolveContentSource(root)`，非 `@Injectable`，类型全在本文件内）、`apps/server/test/common/theme-content-source.spec.ts`（**10 用例**，全 `mkdtemp`） |
| 门禁（执行方实跑） | shared build 0 / spec 10 passed / `pnpm build` 0 / `pnpm lint` 0 |
| **架构师独立复验** | 自己复跑该 spec **10/10 通过**；读码确认：常量与上游 `resolve-source.mjs` 逐条同值（`MANIFEST_FILE` / `WORKING_COPY_DIR=.content-src` / `LOCK_FILE` / `SUPPORTED_SCHEMA_VERSION=1` / `DEFAULT_MOUNTS` 四键）；文件头 `[Q3 裁定]` 段把「为何必须跟随 mounts（prune 会删掉写在代码仓的内容）」写清了；**零写盘、无递归** |
| 为 T3 备好的出口 | `DEFAULT_MOUNTS`、`CONFIG_DIR_IN_CONTENT='config'`、`OVERRIDES_DIR_IN_CONTENT='overrides'`、`configDirInContent`、`overridesDirInContent` |

### 13.2 架构师对执行方三处「刻意偏离」的裁定：**全部保留**

| 偏离 | 裁定 | 理由 |
|---|---|---|
| 上游非法 mounts 项 `fail()` 抛错；本实现**永不抛错**，落 `invalidMounts` + `evidence(passed=false)` 并保留默认值 | ✅ **保留** | 这是**只读探测**。清单写坏就让健康探测 500 是错的；降级 + 落证据才是对的口径（与 `theme-adapter` 的 unknown 口径一致） |
| mounts **交叉重叠**上游 `fail()`；本实现只记录、不裁剪映射 | ✅ **保留**（但见 13.3） | 只读阶段没有安全裁剪依据，猜一个裁剪结果比如实报告更糟 |
| `manifestPath` 返回**相对**值（上游是绝对路径） | ✅ **保留** | 仓规红线 6。绝对路径只保留在 `contentRoot`（已标注「仅供后端内部使用」）。调用方要绝对路径时自己 `path.join(root, …)`，一行的事 |

另：执行方补出的两块上游边界（**源**保留根 `{.git,node_modules}`、**目标**保留根
`{.git,.astro,.content-backup,.content-src,.export-backup,node_modules,scripts,tests}`、`target === 'src'` 判 too broad）
系照源码补齐，**比我简报里给的口径更完整**，采纳。`mode` 上游实际取值 `'local' | 'external'`（`resolve-source.mjs:432/450`），
与简报语义一致，采纳。

### 13.3 由此新增的 **T3 硬约束（写入前必须拦）**

T5a 是只读的，所以上面两条「不裁剪」零风险；但 **T3 要写盘 ⇒ 必须硬拦**：

| 条件 | T3 行为 |
|---|---|
| `invalidMounts` 非空（非法挂载项） | **拒绝写入**，回报清单（`400` 语义），不猜落点 |
| 存在 mounts **交叉重叠** | **拒绝写入**，回报冲突键对（`invalidMounts` 里以 `"A,B"` 形式给出） |
| `schemaVersion > 1`（`supported: false`） | **拒绝写入**（仍可只读查看 source/mounts） |

理由：内容分离一旦开启，**写错落点 = 下次 sync 把内容删光**（`prune` 默认 true）。宁可不写。

### 13.4 三张权威表已成体系（T3/T4 的输入面）

| 文件 | 内容 | 服务谁 |
|---|---|---|
| `docs/refs/theme-compat/shirone-config-domains.md` | Shirone **32** 个域：`key` ｜ `config/<file>.yaml` ｜ TS 类型 ｜ 模块 ｜ 应用方式（含 `navBar` 整体替换例外） | T3 shirone 档 |
| `docs/refs/theme-compat/mizuki-config-layouts.md` | Mizuki **两种布局**：判别子 ／ HEAD **18** 个覆盖名（覆盖名 = **文件名**，且 4 处与源文件名不同）／ HEAD→Shirone 的 11 直接 + 4 归并 + 3 孤儿 ／ 两档生效时机 ／ 上游 `\|\| true` 吞错雷 | T3 legacy+HEAD 档 |
| `docs/refs/theme-compat/README.md` §3.1 | Mizuki legacy `src/config.ts` 的 **18** 个顶层导出 → Shirone 域（**与 HEAD 的 18 不是同一组**：legacy 有 `widgetConfigs`、HEAD 有 `markdownConfig`） | T3 legacy 档 |

---

## 14. 追加（2026-10-29 第七回合）：T3a 验收 + **「写哪里才是持久的」三处决定性实测**

### 14.1 T3a 交付与验收（配置面三档判定）

| 项 | 结果 |
|---|---|
| 改动 | `packages/shared/src/theme-adapter.ts`（`ThemeConfigStrategySchema` 增 `'overlay-ts'`；`capabilities.config` 增必填 `domains: string[]`）、`common/theme/theme-adapter.ts`（判定阶梯 + `MIZUKI_HEAD_LAYOUT` + `mizukiHeadCapabilities()`）、`test/modules/theme/theme-adapter.spec.ts`（+5 用例） |
| 门禁 | shared build 0 / spec **14 passed** / `pnpm build` 0 / `pnpm lint` 0 |
| **架构师独立复验** | 自己复跑 **24/24**（adapter 14 + content-source 10）；自己跑 `pnpm lint` **EXIT=0**；grep 确认**无其它 `ThemeCapabilities` 构造点** ⇒ 新增必填 `domains` 零破坏 |
| 执行方主动报的一处冲突（**处理正确**） | 新阶梯下旧 `buildShironeFixture()`（只有 `src/config/siteConfig.ts`）会掉到第 4 条判 `unknown`，与「保留 9 用例」冲突 ⇒ 给该 fixture 补 `src/config/integrationsConfig.ts`。**这是让它更真实而非放水**：`src/integration/index.ts:18` 直接从 `../config/integrationsConfig.ts` import，`astro.config.mjs` 亦指向它 ⇒ 该文件是 Shirone 的**结构必需**，真实源码形态必然存在。9 个旧用例断言逐字未改（仅按上一批 `serverMode` 的补法给期望对象补 `domains`） |

### 14.2 **「写哪里才是持久的」——三处实测（T3b 的全部设计依据）**

> 内容分离的本质是「内容在**另一个仓**，每次 sync 从内容仓 → 代码仓物化」。
> ⇒ **写在代码仓 = 下次 sync 被删**。以下三条都是源码实测，不是推断。

**(a) Shirone：git 型内容仓的工作副本每次 sync 被强制重置**

`sync.mjs` `ensureWorkingCopy`（fetch 允许时）：
```js
git fetch --depth 1 --force origin <ref>
git checkout --detach --force FETCH_HEAD
git clean -ffdx            // ← 连未跟踪文件一起删
```
且 `allowFetch === false`（`CONTENT_SYNC_PULL=false`）分支会用 `assertReusableWorkingCopy` 检查
**未提交改动并直接抛错**（"cannot reuse .content-src/ with uncommitted changes"）。
⇒ **git 型内容仓，Kova 一律不得写入**（两种 pull 模式下都不能）。写进去要么被清掉、要么把构建弄挂。

**(b) Shirone：`mode === 'local'` 时 `config/<域>.yaml` 是**死文件**

`sync.mjs:425` 在 local 模式**直接 `return null`**，`syncUserConfig` **根本不被调用**
⇒ `src/user/user-config.ts` 不会从 `config/*.yaml` 重新生成。
上游自己给了 local 模式的正当配置方式：**直接改 `src/config/*Config.ts`**
（`docs/CONTENT_SEPARATION.md` 回滚段逐字：「想完全退回直接修改 `src/config/*.ts` 的旧方式也可以」）。
⇒ local 模式 Shirone 的配置面**不能**用 YAML 侧车；要么报不支持 + 指向「启用内容分离」，
要么走 ts-morph 改 `src/config/<域>Config.ts`（= 把 legacy 写入器参数化，另立批次）。

**(c) Mizuki HEAD：与 Shirone **完全不同的**内容分离机制，且会主动删掉代码仓副本**

| | **Mizuki HEAD** | **Shirone** |
|---|---|---|
| 声明载体 | **环境变量** `ENABLE_CONTENT_SYNC` / `CONTENT_REPO_URL` / `CONTENT_DIR` | **清单文件** `shirone.content.json` |
| 内容目录默认 | **`<主题根>/content`**（`CONTENT_DIR` 可覆盖） | git → `<主题根>/.content-src`；path → manifest `source.path` |
| 覆盖落点 | `<内容目录>/overrides/<覆盖名>.ts` | `<内容目录>/config/<域>.yaml` |
| 开关关闭（`ENABLE_CONTENT_SYNC=false`） | 脚本**早退**，overrides 不动 | `mode: 'local'` ⇒ 生成器不跑 |
| 内容目录**不存在** | 脚本**早退**（"将使用本地内容"） | 同上 |
| 内容目录存在但**没有** `overrides/` | **`fs.rmSync(destPath, {recursive:true, force:true})` 删掉 `src/config/overrides/`**（`sync-content.js:111-118`，注释：「内容仓库删掉 overrides/ 后清掉上次的副本，避免旧配置继续生效」） | 无文件可编 ⇒ 生成空模块 |
| 内容目录是 git 克隆 | **`git reset --hard origin/<branch>`**（`sync-content.js:84`）+ `git checkout <branch>` | 见 (a) |

**统一结论（T3b 的唯一落点规则）**：
> **写内容仓，不写代码仓；内容仓是 git 工作副本时拒绝写入。**
> 落点 = `<内容目录>`（按各档机制解析）+ 各自的覆盖子目录
> （Shirone `config/`、Mizuki HEAD `overrides/`），而 `<内容目录>` 由 T5a 的
> `resolveContentSource` 给出（Shirone），Mizuki HEAD 则按上游口径取 `CONTENT_DIR ?? <主题根>/content`。

### 14.3 因此新增的拒绝清单（T3b 必须逐条硬拦，全部「宁可不写」）

| 条件 | 结果 | 给用户的下一步 |
|---|---|---|
| 内容仓 `source.type === 'git'` | **拒绝写入** | 把内容源改为本地路径（`source: {type:'path'}` / 设 `CONTENT_DIR` 为本地目录） |
| `invalidMounts` 非空 | **拒绝写入** + 回报清单 | 修清单 |
| mounts 交叉重叠 | **拒绝写入** + 回报冲突键对（`"A,B"`） | 修清单 |
| `schemaVersion > 1` | **拒绝写入**（只读查看仍可） | 升级 Kova 或降 manifest |
| Shirone `mode === 'local'` | **拒绝写入**（`config/*.yaml` 不参与构建） | 启用内容分离（加 `shirone.content.json`）；或直接改 `src/config/*Config.ts`（后续批次支持） |
| Mizuki HEAD 内容目录不存在 | **拒绝写入**（sync 早退，属本地上游默认形态） | 建内容目录 + 配 `CONTENT_DIR`；或直接改 `src/config/*.ts`（后续批次支持） |
| Mizuki HEAD 内容目录存在但无 `overrides/` | **允许写入**，但**必须在写入后立即触发一次 sync**，否则下次 sync 会 `rmSync` 掉 | —（面板标注「需同步生效」） |

### 14.4 T3 的批次重排（据此）

| 批次 | 内容 | 状态 |
|---|---|---|
| T3a | 三档形态判定 + 策略与可写名单声明 | ✅ 已交付（§14.1） |
| **T3b-1** | **配置写落点解析**（纯函数：给主题根 + 档位 → 持久的绝对落点，或带原因的拒绝） | ⏳ 待派 |
| T3b-2 | 写入器 + API（`safeJoin` + preWriteBackup + 原子写；`GET/PUT /admin/config/domains/:domain`） | ⏳ |
| T3c | local 模式 Shirone / HEAD 的 ts-morph 路径（把 legacy 写入器参数化到 `src/config/<域>Config.ts`） | ⏳ |
| T3d | `content:sync` 进白名单（Q6 已批，§12.3 顺序铁律） | ⏳ |

---

## 15. 追加（2026-10-29 第八回合）：env 解析对齐 + **一处由我自己简报造成的误拒，已修**

### 15.1 env 批交付与验收

| 项 | 结果 |
|---|---|
| 改动 | `content-source.ts`（+`resolveThemeEnv`：进程 env 优先、`.env`→`.env.local` 后者覆盖；source 优先级改为 `CONTENT_DIR` > `CONTENT_REPO_URL`(+`_REF`) > manifest；`SHIRONE_CONTENT_SYNC ∈ {0,false,off,no}` ⇒ local + reason）、`config-write-target.ts`（+`readRootEnvFile` 复刻 `load-env.js`；**文件键压过进程 env**；内容目录缺失 + `CONTENT_REPO_URL` 已设 ⇒ 新 reason `mizuki-head-content-repo-url`）＋两个 spec |
| 门禁 | shared build 0 / 两 spec **38 passed** / `pnpm build` 0 / `lint` 0 |
| **架构师独立复验** | 复跑 **52/52**（content-source 17 + write-target 21 + adapter 14）；`pnpm lint` **EXIT=0** |
| 执行方遵守的硬要求 | **零 `process.env` 写入**：两个 spec 各加「调用前后 `process.env` 深等」断言；env 类用例 `beforeEach` 清场 + `afterEach` 还原 |

**两档 env 模型（实测，互不相同——这是本轮最容易被写错的地方）**

| | Mizuki HEAD（`scripts/load-env.js`） | Shirone（`resolve-source.mjs:396-441`） |
|---|---|---|
| 读哪些文件 | **只有 `.env`** | **`.env` + `.env.local`**（后者覆盖） |
| 与 `process.env` 的优先级 | **`.env` 压过 `process.env`**（无条件赋值，反常规） | **`process.env` 优先**（先快照 `inheritedEnvKeys`，已存在的键永不被覆盖） |
| 解析细节 | 按 `\n` 切、`/^([^=]+)=(.*)$/`、值去**各一个**首尾引号（不校验配对） | 按 `\r?\n` 切、第一个 `=` 切、**两端同型**才去引号 |

### 15.2 **我自己写错的一处简报**（已修，记录以防复犯）

**我在 T3b-2 前的 brief 里写「按上游口径用字面 `path.join(root, CONTENT_DIR)`」——这是错的。**

实测（`grep -c "join(rootDir, CONTENT_DIR)" scripts/sync-content.js` = **0**）：上游是
`const CONTENT_DIR = process.env.CONTENT_DIR || path.join(rootDir, "content")`，之后把 `CONTENT_DIR`
**原样**用在 `fs.existsSync(CONTENT_DIR)`（:32）、`path.join(CONTENT_DIR, mapping.src)`（:107）、
`git clone … {CONTENT_DIR}`（:46）、`cwd: CONTENT_DIR`（:65/71/174/181）。**全仓没有二次 join。**

⇒ 执行方忠实实现了我的错误描述（「一律 `join(root, value)`」），后果是：
**一个合法的绝对 `CONTENT_DIR`（如 `<盘符>:\my-content`）会被拼成 `<root>\<盘符>:\my-content` ⇒ 不存在 ⇒ 被误拒**。

这正是 dj 在本轮提醒的那个风险（「避免 Kova 判定的内容目录和上游脚本实际读取的目录劈叉」），
**方向是假拒绝**——比假成功好，但仍然是错的。

**修正**（架构师直接实施，含两处被我错误前提污染的用例）：

```ts
const raw = readEnv('CONTENT_DIR');
if (raw === undefined || raw === '') return path.join(root, 'content');
return path.isAbsolute(raw) ? raw : path.join(root, raw);   // 绝对值原样；相对值按主题根
```

- 绝对值**原样**使用（与上游一致）⇒ 存在且非 git ⇒ **允许写入**，落点 `<该绝对目录>/overrides`
- 绝对/相对值**不存在** ⇒ 上游 `fs.existsSync` 为假 ⇒ 早退不 sync ⇒ **照旧拒绝**（诚实）
- 相对值：上游原样交给 Node 按进程 CWD 解析，而 pnpm 以主题根为 CWD ⇒ 等价 `join(root, value)`
- 注释里写了 **「勿改回一律 join」** 与原因，防止后来人「修回去」

修订后复跑 `theme-config-write-target.spec` **21/21**、`pnpm lint` **EXIT=0**。

### 15.3 由此给 T3b-2 新增的两条设计输入

**(a) 路径监狱根要换成内容仓，不是主题根。**
`safeJoin(root, untrusted)` 是**两参**函数（`common/security/safe-join.ts:42`），监狱根由调用方给。
内容仓完全可能落在主题根之外（绝对 `CONTENT_DIR` / manifest `source.path`），
⇒ T3b-2 必须用 `safeJoin(<内容目录>, '<覆盖文件名>')`，**不得**绕开 `safeJoin` 自己去拼路径。
另有 `safeRealJoin`（realpath 防符号链接逃逸）在同一文件，选用见其头注。

**(b) 覆盖名必须是白名单，否则能写坏用户的构建。**
上游 `overrideLoader` 对**未知覆盖名直接 `throw`**（构建期报错），Shirone 侧对未知 YAML 同样有校验。
⇒ T3b-2 写之前必须校验「请求的域名 ∈ `capabilities.config.domains`」（legacy/unknown 为空 ⇒ 一律拒），
并叠加 `common/validation/segment-name` 的单段名校验（纵深防御）。
**这条把「Kova 能改配置」升级为「Kova 不能改坏构建」**，不能省。

### 15.4 T3b-2 之前还缺的一张表（架构师待办）

Mizuki HEAD 的覆盖文件是**手写 TS 模块**：

```ts
import type { SiteConfig } from "../../types/config";
export default { … } satisfies DeepPartial<SiteConfig>;
```

⇒ 要生成**同形**文件，需要一张 18 行表：`{ 覆盖名, 源文件, TS 类型名, 类型模块 }`
（覆盖名 ≠ 源文件名的 4 处见 `docs/refs/theme-compat/mizuki-config-layouts.md` §2.1）。
来源为 `<theme>/src/config/index.ts` 的导入表 + `<theme>/src/types/*`。**未核实前 T3b-2 不得开工**。

---

## 11. 追加（2026-10-29 第四回合）：Q2 的相邻后果收口 + T2c 交付

### 11.1 T2c 交付（适配层契约修订）

| 项 | 结果 |
|---|---|
| `packages/shared/src/theme-adapter.ts` | 新增 `ThemeModeSchema`/`ThemeMode`（本包独立声明，不复用 server 侧 app-config）；`ThemeCapabilitiesSchema` 新增 `.strict()` 的 `serverMode` 组；能力画像「五组 → 六组」 |
| `apps/server/src/common/theme/theme-adapter.ts` | `resolve(root, serverMode = 'manage')`；三个能力工厂各收 `serverMode`；**shirone 判定拆三态**：`shironeConfigDirOk` → `shirone` ／ 仅 `shironeName`（依赖命中）→ **包模式 → `unknown`** ／ 其余原 mizuki 判定**一字未改**；新增 `shirone-package-mode` 证据（相对路径纯文本） |
| `theme.controller.ts` | 传 `getAppConfig().mode`；`layout.root` 剔除逻辑未动 |
| 架构师独立复验 | spec **9/9**、`pnpm lint` **EXIT=0**；读码确认三态分支、证据无绝对路径、`enforcement:'declared-only'` 如实标注（**未发明**强制语义） |

**`serverMode.enforcement: 'declared-only'` 的用意**：`mode` 至今在服务端**零行为分支**。把它写进能力画像时若只写 `mode`，前端会合理地以为它管着什么。
⇒ 用 `enforcement` 显式标注「今天只是声明」，将来真落地强制再改 `'enforced'`。这是**如实**，不是占位。

### 11.2 Q2 的相邻后果（**已收口**，架构师直接实施）

**问题**：T2c 之后，包模式项目的 kind 从 `shirone` 变成 `unknown`，而 `registry.ts` 的
`TABLES.unknown` 当时**兜底指向 Mizuki 表** ⇒ 包模式会去读写 `src/data/*.ts`——
在那个根下**并不存在**。这不是「保住功能」，是**拿假地址读写**，且与 Q2 裁定的「归入不支持」冲突。

**修法**（`unknown` **不再**兜底成 Mizuki 表）：

| 位置 | 改动 |
|---|---|
| `registry.ts` | `TABLES.unknown` = **空表**；文件头补 `[Q2/裁定]` 段说明两个 unknown 来源（①根缺失/未初始化 ②Shirone 包模式）以及**为何不得改回** |
| `registry.ts` | 新增 `unknownCollectionMessage(type, kind)`：空表时给「当前主题未被识别，或该部署形态不支持集合纳管」，**不再拼出空的「可用：」**（那会把「主题没识别」误导成「类型拼错」） |
| 两个 controller | 改用该 helper（单源），`collections.controller.ts` / `public-collections.controller.ts` |
| `media-reference.ts` | 注释订正（`unknown` → 空表 ⇒ 遍历自然为空） |
| spec | 原断言 `getRegistryTable('unknown') === REGISTRY` 改为 `toEqual([])`；新增文案用例（空表说「未被识别」／非空表保持既有文案的回归保护） |

**为何这不是「让功能全灭」**：pre-T2 的 shipped 行为里，主题根不可识别时集合路由本来就会去读
不存在的文件并失败 —— 空表**没有让情况变差**，只是把失败换成了可读的话。而真实主题（源码仓）
必然通过探测（`astro` 依赖 + `astro.config.*` + `src/config.ts`|`src/data/diary.ts`），能力面照旧。

**爆炸半径实测**：命中集合路由的 8 个 e2e **全部**使用 `test/fixtures/mizuki`（含 `astro` 依赖 +
`astro.config.mjs` + `src/data/diary.ts`）⇒ 探测必判 `mizuki`，不受本次改动影响。

**验证**：`theme-registry.spec` 7/7 + 5 个集合 e2e（49 用例）+ 另 4 个消费方 e2e（42 用例）
＝ **6 文件 49 + 4 文件 42 全绿**，`pnpm lint` **EXIT=0**。

### 11.3 顺带钉住的一条既有事实（Mizuki 上游 HEAD 与本地快照布局不同）

**这条不属于本轮交付，但会决定 T3 的形状，留档等裁决。**

| | 本地 `BlogFiles/Mizuki`（生产，只读核查） | `LyraVoid/Mizuki` **HEAD**（`c06f000`） |
|---|---|---|
| astro | 6.1.2 | 7.1.3 |
| 配置形态 | **单文件 `src/config.ts`**（17321 B，18 顶层导出） | **`src/config/` 21 文件**（`git ls-tree HEAD` 实测 `src/config.ts` **0 个**） |
| 用户覆盖 | 无（由 mizuki-java-server 注入 `src/server/`） | **一等公民侧车** `src/config/overrides/<导出名>.ts` ← `sync-content` 从内容仓 `overrides/` 复制（`/src/config/overrides/` 已 gitignore） |
| 合并语义 | — | `overrideLoader.withOverride` = `deepMerge(上游默认, overrides/<名>.ts default)`，未知覆盖名**构建期抛错** |

⇒ Kova 现有配置面（`modules/site-config` 用 ts-morph 改写 `src/config.ts`；T1 的
`MIZUKI_LAYOUT.configFile='src/config.ts'`）**只对本地旧布局成立**。若「主题重新拉取」= 拉到 HEAD，
配置面必须改走 `overrides/` 侧车 —— 而那正好与 Shirone 的 `config/<域>.yaml` **同构**
（默认值在代码、个人值在侧车、名字拼错就报错），T3 因此可做成**真正对称**的两档。

**上游背书（同时回答 dj 关切的①）**：`LyraVoid/Mizuki` 的 `docs/CONTENT_SEPARATION.md:365` 明写
「**开发服务器不监听内容仓库**……dev 运行中修改覆盖文件需要重启 `pnpm dev` 才会重新同步」——
与 Shirone 的 `sync.mjs` 行为完全一致。⇒ §10.2(a) 的契约两档通用，**不是推断**。
另：本地 clone 为 **depth-1**（`git rev-list --count HEAD` = 1），无法定位该改版的提交；要定位需 deepen。

---

## 16. 追加（2026-10-29 第九回合）：T3b-2 开工前的三项契约钉死 + 一个真阻塞

dj 放行 T3b-2 并补了三条契约叮嘱。三条**全部成立**，其中第 1 条我在原简报里只给了表、**没给基准**。

### 16.1 dj 的三条叮嘱 → 升格为硬约束（第 1 条已获源码级证明）

**① `import type` 相对路径的基准 = 同步后的目标位置 `src/config/overrides/`，不是落盘位置 `<内容目录>/overrides/`。**

不只是「dj 提醒得对」——上游**自己就是因为这个原因才选择复制而非软链**。`scripts/sync-content.js:100-104` 原文：

```js
// 覆盖文件是带相对导入的 TS 模块，符号链接会被 Vite 解析到内容仓库真实
// 路径导致找不到 types/config，因此复制进代码仓库而不是建链接
{ src: "overrides", dest: "src/config/overrides", copy: true },
```

⇒ `../../types/config` 从 `src/config/overrides/<名>.ts` 回退两级到 `src/types/config`。
**本批次把它写成具名常量并附这段引文**，禁止任何「按落盘目录算相对路径」的实现（那会生成 `../../../../types/config`
这类在同步后必然断链的路径，而 Shirone `partial:false` 的 `navBar` 与 Mizuki 全部 18 个域都会踩）。

**② 增删改对称可悔棋 ⇒ 暴露 `DELETE /admin/config/domains/:domain`，删除前同样走 `preWriteBackup`。**
上游语义已实测确认：`config-overlay.mjs:203-206` 把**空文件**解析成 `null/undefined` 并**视作「没有覆盖」而不是错误**
（注释原文：「用户常常先建好文件再慢慢填」）⇒ **删文件 = 恢复该域全部上游默认值**，与「写空对象」**不等价**
（后者会经 `deepMerge` 把值覆盖成 `null`，正是上游 `assertSerializable` 第 129-133 行专门拦截的事故）。
所以 reset **必须是删文件**，不能是写空对象 —— 这一点写进写入器的实现约束。

**③ `GET` 带 `hasOverride: boolean`；`PUT`/`DELETE` 透传 `needsSync`。** 后者正好接 T3d 的 `content:sync`。

### 16.2 架构师自己的遗留缺陷：`config-write-target.ts` 文件头与函数体互相打脸（已修）

上一批我修了 `resolveContentDir` 的函数体（绝对值原样使用）并加了 `[勿改回]` 警告，**但文件头 ⑧ 段还写着旧口径**
「用的是**字面 `path.join(root, CONTENT_DIR)`**……本实现照上游用 `join`」。

⇒ 同一文件里，头部说「一律 join」、函数体说「绝对值原样」。**这种状态比单纯的旧注释更危险**：下一个读者
（或子代理）会顺着头注释把已修的假拒绝「修回去」。已重写 ⑧ 段，改为陈述上游真实口径，并显式登记
「曾有一版把绝对值也一律 join ……此为已修缺陷，勿复活」。

**教训**：修函数体时**必须同批扫该文件的说明段**。`§15.2` 那次是「简报写错」，这次是「修一半留一半」。

### 16.3 两份白名单交叉核对（写入器的白名单面因此可放心用）

| 档 | 权威源 | 条数 | 集合比对 |
|---|---|---|---|
| Mizuki HEAD 覆盖名 | `src/config/overrideLoader.ts` 的 `OVERRIDABLE_CONFIGS` | **18** | 与本仓 `MIZUKI_HEAD_CONFIG_DOMAINS` **集合完全相等**（顺序不同，无影响） |
| Shirone 配置域 | `scripts/content/config-domains.mjs` 的 `CONFIG_DOMAINS` | **32** | 与本仓 `SHIRONE_CONFIG_DOMAINS` **集合完全相等** |

两边**零多余、零缺失**。上游 `overrideLoader.ts:50-58` 对未知覆盖名与缺 `default` 导出**双重 `throw`**，
`config-overlay.mjs:185-190` 对认不出的文件名 `fail` 并附「Did you mean ...?」⇒ **白名单不是可选项**：
写进去一个不在表里的名字 = **直接把用户的构建弄坏**。这正是 dj 说的「Kova 不能改坏构建」。

### 16.4 **本轮新发现（会改变 T3b-2 形状）**：`capabilities.config.domains` 不足以写 Shirone 文件

`config-overlay.mjs:170-215` 的落点规则是**按文件名反查域名**：

```js
const base = entry.name.slice(0, -extension.length);
const domain = DOMAIN_BY_FILE[base];        // base = 去掉扩展名后的文件名
if (!domain) { /* fail: Did you mean ...? */ }
```

而 **`key ≠ file` 的有 5 个**：`expressiveCode`→`expressive-code`、`postList`→`post-list`、
`contextMenu`→`context-menu`、`imageBloom`→`image-bloom`、`navBar`→`nav-bar`。

⇒ 我们 `capabilities.config.domains` 装的 32 个 **key**，**写不出正确的文件名**。
若照 key 直接拼 `<域>.yaml`，`navBar.yaml` 会被上游判为「无此域」并 `fail` —— **又一次「Kova 写坏构建」**。

**裁定（架构师，本轮生效）**：
- **`capabilities.config.domains` 维持 keys-only 不变**（前端按 key 列域；零 schema 变更、零前端影响）；
- Shirone 的**完整域名表**（`key` / `file` / `type` / `module` / `partial`）落 **L0 新文件 `common/theme/config-serde.ts`**，
  并成为**唯一真源** ⇒ `theme-adapter.ts` 的 `SHIRONE_CONFIG_DOMAINS` 改为**从该表派生 keys**（现值必须逐字不变）。
- 反查表 `DOMAIN_BY_FILE` 亦由该表派生 ⇒ **写入器不接受任何调用方自带的文件名**。
- 另记两条上游细节：`.yaml` 与 `.yml` **都认**（同域两份文件会 `fail`）；**空文件 = 无覆盖，不是错误**。

### 16.5 **真阻塞（需 dj 裁决）**：Shirone 档需要 YAML 库，而全仓没有

实测：`apps/server` 的 24 个依赖里**没有任何 YAML 库**；根 `node_modules` 顶层 `yaml` / `js-yaml` 皆缺；
`grep -c "^  yaml@" pnpm-lock.yaml` = **0**（`yaml` 完全不在树里）。
只有 `js-yaml` 以 `.pnpm/js-yaml@{3.15.1,4.3.1,5.3.0}` 三个版本**隔离**存在（经 `gray-matter` 传入，**不可直接 import**）。

**上游用的是哪一个 —— 这是选型的决定性依据**：

| | 上游 | 依据 |
|---|---|---|
| Shirone | **`yaml ^2.9.1`**（eemeli 的 `yaml`），**不是 js-yaml** | `package.json` + `scripts/content/config-overlay.mjs:26` `import { parse as parseYaml } from "yaml"` |
| Mizuki HEAD | **无运行期 YAML 解析**（只有构建期 `@rollup/plugin-yaml`） | 覆盖文件是 `.ts` 模块 |

⇒ 结论：**发射器与解析器必须同源**。若 Kova 用 js-yaml 写、Shirone 用 `yaml` 读，引号 / 多行标量 / Unicode /
锚点的边界行为可能分叉 —— 正是本批一直在消灭的那类「劈叉」。**唯一正确选型是 `yaml@^2.9.1`（与 Shirone 同库同大版本）**。

但代价是**真·新增一个包**（lockfile 新增解析项 + 一次下载 + 一次 `pnpm install`，而 `AGENTS.md §3` 已登记
install 可能改写 node_modules 布局、致 web 段构建失败需重跑一次）。**是否新增依赖属 dj 的供应面决策，故停在此处等裁决。**

**若否决**，Shirone 档只剩两条路，均已评估为下策：
1. **手写 YAML 发射器 + 解析器** —— 上游 `config-overlay.mjs:4-9` 的文件头自己就把这条路否了：
   「校验不写第二套 schema……另立 Zod/JSON Schema 只会漂移」。手写解析器 = 为 YAML 语义**另立真源**，
   还要**重实现上游的 `assertSerializable`**（null 拒绝 / 非有限数拒绝 / 锚点循环拒绝）才能给出同款错误。
2. **Shirone 档降级为「原始 YAML 文本读写」**（不做表单）—— 零新依赖且诚实，但配置面板的价值基本落空。

### 16.6 顺带钉死：Mizuki HEAD 档的 `GET` 需要读 TS，用 **ts-morph**（已是本仓依赖）

HEAD 的覆盖文件是 `export default {...} satisfies DeepPartial<T>` 的 **TS 源码**，不能 `JSON.parse`。
落地方式：用 **ts-morph**（已是 `apps/server` 依赖，且已是 `site-config` 改写 `src/config.ts` 的工具）
`getInitializer()` 后做**字面量求值**；遇到非字面量（展开、引用、函数调用）⇒ **拒绝并说明**，不做猜测求值。
⇒ **HEAD 档零新增依赖**，YAML 决策只影响 Shirone 档。

### 16.7 T3b-2 批次重排（据此）

| 批次 | 范围 | 是否受 YAML 裁决阻塞 |
|---|---|---|
| **T3b-2a** | L0 `common/theme/config-serde.ts`：Shirone 32 行域名表（唯一真源）+ HEAD 18 行类型表 + HEAD 覆盖模块**生成/解析**（ts-morph）+ 常量化的 `../../` 基准（附引文）+ 单测 | **否**（纯 HEAD 侧 + 纯数据表） |
| **T3b-2b** | `modules/theme/config-writer.service.ts`：消费 `resolveConfigWriteTarget` → 白名单（key ∈ domains **且** key→file 命中）→ `singleSegmentName` → `safeJoin(<内容目录>, …)` → `preWriteBackup` → `atomicWriteFile`；`DELETE` 走备份 + unlink；路由 `GET /admin/config/domains`、`GET/PUT/DELETE /admin/config/domains/:domain`，`hasOverride` + `needsSync` 透传 | **否**（写入器骨架两档共用；Shirone 分支待 2c） |
| **T3b-2c** | Shirone 档 YAML 序列化/反序列化（依赖 YAML 裁决结果） | **是 —— 等 dj** |

**legacy 档不入写入器**：`theme-adapter.ts:172-173` 已裁定 legacy 的 `domains: []`，
「可写面由既有 `site-config` 契约（受控子集）持有，故 domains 留空，**避免两处真源**」。
⇒ T3b-2**禁止**为 legacy 造写入器（那会与 `site-config` 争同一个 `src/config.ts`）。
legacy 下 `GET /admin/config/domains` 返回空表 + 指向「站点配置」页的说明，`PUT`/`DELETE` 一律按白名单拒绝。

---

## 17. 追加（2026-10-29 第十回合）：T3b-2a 验收 + **一次操作事故与其永久加固** + `panelSupport` 按档裁定

### 17.1 T3b-2a 验收（架构师独立复跑，非采信执行方自述）

| 项 | 结果 |
|---|---|
| `theme-config-serde.spec.ts` | **27/27**（独立复跑） |
| 回归 `theme-adapter` + `theme-registry` | **21/21**（14 + 7） |
| `pnpm lint` | `EXIT=0` |
| `pnpm build` | `EXIT=0` |
| 两张权威表对上游 | Shirone **32 行 `(key,file,type,module,partial)` 逐行完全相等、顺序相同**；HEAD **18 行 `(name,sourceFile,typeName)` 完全相等** |

执行方自述「未回读上游交叉核对」⇒ 该列由架构师代为核对，**零差异**。其自加的加固（整数走 `BigInt` 十进制展开，
避免 `1e21` 被 `String()` 写成指数形态、而 ts-morph 读回变成 `1`）判断正确，**保留**。
一处**报告失准**（非代码问题）：称 `theme-adapter.ts` 为「已跟踪文件」，实际整个 `common/theme/` 均为 untracked。

### 17.2 **一次架构师自身的操作事故**（2026-10-29 实测，全程留痕，勿复犯）

**我做的错事**：给 `pnpm add` 加了 `--config.node-linker=hoisted`。

| 环节 | 实际发生 |
|---|---|
| 本仓真实布局 | **isolated**（实测 `node_modules/.pnpm/zod@4.4.3/node_modules/zod` 为实体目录） |
| 该 flag 的作用 | 改写 lockfile 的 settings ⇒ **触发全量重解析** |
| 被重解析到什么 | `vitest 4.1.11 → 5.0.5`（**大版本跳**）、`eslint 10.9.1 → 10.13.0`、`drizzle-kit 0.31.10 → 0.31.11` |
| 致命后果 | `zod` 在仓内变成**两份副本**（server `4.6.7` + shared/web `4.4.3`） |
| 症状 | `pnpm build` 报 **34 条 `TS2739 ... missing validate, validateAsync`**，全部集中在 `theme-registry.service.ts`，**与业务代码毫无关系** |
| 耗时对照 | 该次重装 **59 分钟**；改回默认布局后 **6.9 秒** |

**根因是「我的操作错误 × 一个潜伏地雷」的叠加**，缺一不可：
- 扳机 = 我的 flag（触发全量重解析）；
- 火药 = `apps/server/package.json` 的 **24 个 `"latest"`**（15 运行期 + 9 dev）+ 根 `package.json` 的
  `eslint` / `typescript-eslint`。**它让这个仓的构建本来就不可复现**——任何一次 install 都可能凭空改变行为。

**双份 zod 的机制**（值得记住）：`apps/server` 声明 `"zod": "latest"` ⇒ 重解析取 `4.6.7`；
`packages/shared` / `apps/web` 声明 `^4.4.3` ⇒ 复用 lockfile 里既有的 `4.4.3`。
于是 server 代码里的 `z.ZodType` 与 shared 产出的 `ZodObject` **来自不同副本** ——
结构上相似但**名义类型不互认**，报「缺 `validate` / `validateAsync`」（zod v4 的 `$ZodTypeInternals` 标志）。
⇒ **教训：仓内同一包的声明必须能被解析到同一份实例。只把 `latest` 改成 `^4.4.3` 不够**——
`^4.4.3` 仍会取 `4.6.7` 而 `^4.4.3` 在别处复用 `4.4.3`，照样分叉。**必须三处一致。**

### 17.3 dj 的两条裁定与落地（均已验收）

**裁定①：全部精确钉到 HEAD lockfile 已解析版本。** 25 处 `"latest"` →
`@nestjs/throttler 6.5.0` / `argon2 0.45.1` / `better-sqlite3 13.0.3` / `cross-spawn 7.0.6` /
`drizzle-orm 0.45.2` / `gray-matter 4.0.3` / `helmet 8.3.0` / `jose 6.2.10` / `marked 18.0.11` /
`nanoid 6.0.1` / `sanitize-html 2.17.7` / `sharp 0.35.4` / `tree-kill 1.2.2` / `ts-morph 28.0.0` /
`@swc/core 1.16.1` / `@types/cross-spawn 6.0.6` / `@types/express 5.0.6` / `@types/node 26.3.0` /
`@types/supertest 7.2.1` / `drizzle-kit 0.31.10` / `supertest 7.2.2` / `unplugin-swc 1.5.11` /
`vitest 4.1.11`，以及根 `eslint 10.9.1` / `typescript-eslint 8.68.0`。
`zod` 三处统一为**精确 `4.4.3`**（见 §17.2 末的机制说明：只有精确一致才能真正单份）。

**零漂移断言**（脚本核过，非感觉）：

```
specifier 变动 29 处 = 25 钉版 + 3 zod 统一 + 1 新增 yaml     ← 与预期逐个对应
version   变动  5 处 = yaml 本身，以及 vitest / vite / unplugin-swc / @vitejs/plugin-vue
                       的 peer 后缀新增 (yaml@2.9.1)；基础版本号一字未变
```

**裁定②：加机械防线。** 新增 **`scripts/check-dep-specs.mjs`**，挂在 **`pnpm lint` 前面**
（`"lint": "node scripts/check-dep-specs.mjs && eslint ."`）——**不新增 CI step，直接搭上既有「三连」闸门**。
拦截 `latest` / `*` / `x` / 空 / open-ended（`>=` `>` `<=` `<`/ `||`）spec；
放行 `workspace:` / `link:` / `file:` / `portal:` / `catalog:` / `patch:` / git+url。
**双向验证过**：干净仓放行；故意把 `apps/web` 的 `vue` 改成 `latest` ⇒ 精确抓出并 `EXIT=1`；还原后放行。

### 17.4 YAML 选型：**必须与上游同源**（已装 `yaml@2.9.1`）

| | 上游用什么 | 依据 |
|---|---|---|
| Shirone | **`yaml ^2.9.1`**（eemeli 的 `yaml`），**不是 js-yaml** | `package.json` + `scripts/content/config-overlay.mjs:26` `import { parse as parseYaml } from "yaml"` |
| Mizuki HEAD | **无运行期 YAML 解析**（只有构建期 `@rollup/plugin-yaml`） | 覆盖文件是 `.ts` 模块 |

装 `yaml@2.9.1` 的理由不是「方便」，是**发射器与解析器必须同源**：Kova 写、Shirone 读，
若两者方言不同则引号 / 多行标量 / Unicode / 锚点的边界行为会分叉 —— 正是本批一直在消灭的那类「劈叉」。
**手写 YAML 已被上游自己否掉**：`config-overlay.mjs:4-9` 原文「校验不写第二套 schema……
另立 Zod/JSON Schema 只会漂移」，且手写解析器还要**重实现**上游的 `assertSerializable`
（`null` 拒绝 / 非有限数拒绝 / 锚点循环拒绝）才能给出同款错误 —— 那是**为 YAML 语义另立真源**。

### 17.5 权威表是唯一真源，且 `key ≠ filename` 由它接管

`config-domains.ts` 的 32 行表同时持有 `key` / `file` / `type` / `module` / `partial`。
**写入器不得接受任何调用方自带的文件名，也不得拿 `key` 硬拼 `<key>.yaml`** ——
上游 `config-overlay.mjs:170-215` 按 **`DOMAIN_BY_FILE[去掉扩展名的文件名]`** 反查，认不出就
`fail` 并给「Did you mean ...?」。而 `key ≠ file` 的有 **5 个**：
`expressiveCode`→`expressive-code`、`postList`→`post-list`、`contextMenu`→`context-menu`、
`imageBloom`→`image-bloom`、`navBar`→`nav-bar`。
若照 key 拼文件名，`navBar.yaml` 会被上游判为「无此域」⇒ **直接把用户的构建写挂**。
另两条上游细节：`.yaml` 与 `.yml` **都认**（同域两份文件会 `fail`）；**空文件 = 无覆盖，不是错误**。

### 17.6 **`panelSupport` 必须按「主题档位 × 域」各自裁定 —— 而 HEAD 与 Shirone 的 navBar 判决相反**

这是本轮最有价值的结构性发现，也是 `T3b-2b` 的直接契约输入。

**Mizuki HEAD `navBarConfig` ⇒ `panelSupport: 'none'`。**
上游 `docs/CONTENT_SEPARATION.md:329` 逐字：「`navBarConfig.links` 里的预设项是**枚举**，
要写 `LinkPreset.Home` 并 `import { LinkPreset } from "../../types/config"`，**不能写裸数字**」。
`LinkPreset.Home` 是 `PropertyAccessExpression` —— **既不是字面量，也没有可逆的字面量编码**，
纯 JSON 载荷既无法无损发射、读回时也无法当字面量消费 ⇒ 面板**不可读写**。

**Shirone `navBar` ⇒ `panelSupport: 'literal'`（可读写）。**
`src/types/navBarConfig.ts:20-41` 的注释原文：`navBarConfig` 本身要调用 `i18n()` 并引用 `LinkPresets`，
**无法用 YAML 直接表达**，因此内容仓写的是这份「**引用 + 字面量**」的**中间形态**，
由 `resolveNavBarLinks()` 还原成 `NavBarLink`。三种写法（逐字）：
`{ preset: "Home" }`（引用预设，可带同名字段局部覆盖）/ `{ name, url, icon }`（完全自定义）/
`{ name, icon, children }`（下拉分组，递归同套写法）；`name` 支持 `"$t:home"` 引用 i18n 词条。

⇒ **Shirone 用「字符串引用」替代了「TS 枚举引用」**，纯 YAML 完全可表达 ⇒ 面板可完整读写。
**同一个概念上的域，两档判决相反** —— 这证明 **`panelSupport` 不能挂在「域」上，必须挂在「档位 × 域」上**。
本仓的实现形态是**两张各自独立的表，各带自己的标志位**（HEAD 表带 `panelSupport`，Shirone 表带 `partial`），
这正是 dj 要求的粒度，**且不需要共享一张域表**。

**三档路由契约（`T3b-2b` 照此实现）**：

| 档位 × 域 | `GET` | `PUT` | `DELETE`（恢复默认） |
|---|---|---|---|
| HEAD，17 个 `panelSupport:'literal'` | 返回解析后的值 + `hasOverride` | 允许（走白名单 + 路径监狱 + 备份 + 原子写） | 允许（备份 + unlink） |
| HEAD，`navBarConfig`（`'none'`） | 只回 `panelSupport:'none'` + **原始文本**（不解析） | **拒绝**（说明指向内容仓 `overrides/navBarConfig.ts`） | **允许** |
| Shirone，32 个（含 `navBar`） | 同 literal | 允许 | 允许 |
| legacy / unknown | 空表 + 说明 | 拒绝 | 拒绝 |

**`DELETE` 一律放行**（除 legacy/unknown）：删除**不需要解析**覆盖文件，而「删文件 = 恢复该域全部上游默认值」
（上游 `docs/CONTENT_SEPARATION.md` 回滚段逐字：「删掉内容仓库 `overrides/` 里的文件、重新 `pnpm sync-content`，
配置即回到上游默认值」）。⇒ 即使面板读不回，**恢复默认仍必须可用**，否则用户被锁死在一个改不动的覆盖上。

### 17.7 Shirone `navBar` 的 `partial: false` 语义（整域写入）

`config-overlay.mjs:337-339` 逐字：

```js
const annotation =
    entry.domain.partial === false
        ? entry.domain.type                    // 不放宽 ⇒ 必须写完整类型
        : `DeepPartial<${entry.domain.type}>`;
```

⇒ `partial:false` = **不做 `DeepPartial` 放宽**，即必须提供**完整**的 `NavBarConfigOverride`（`links` 必填）。
配合「内容仓可用 `config/nav-bar.yaml` **整体替换** `links`」（`src/config/navBarConfig.ts` 头部逐字）
⇒ 面板写 `navBar` 时必须**整域提交 `links` 数组**，不接受部分元素；
且 `links` 是数组 ⇒ 上游合并语义是**整体替换不拼接**（`CONTENT_SEPARATION.md` 合并语义表逐字：
「数组：整体替换，不拼接」）。

**⚠ 一条被实测推翻的推论（架构师自己的错，留档防复犯）**：本节初稿曾写道「`partial:false` 的域若被写成
**空对象**，上游会生成 `const navBar: NavBarConfigOverride = {}` ⇒ `links` 缺失 ⇒ 构建期 TS 报错，
故写入器必须拒绝空对象」。**这是错的。** 上游 `config-overlay.mjs:216-217` 逐字：

```js
// 只有键才有覆盖的意义；空映射与空文件一样跳过。
if (Object.keys(value).length === 0) continue;
```

该 `continue` 发生在 `assertSerializable()` **之前** ⇒ 空映射**根本不会进入生成物**，`navBar` 不会被生成，
**不会报错**。Mizuki HEAD 侧同理：`overrideLoader` 只要求有 `default` 导出，而 `deepMerge(base, {})` 是恒等，
且 `{}` 满足 `DeepPartial<T>`（全键可选）⇒ **两档写空对象都是无副作用的空操作**。

⇒ 结论订正：**「写空对象」不需要以「会弄挂构建」为由拒绝**。若 API 层仍要拒绝（建议拒绝），
理由是**语义与状态完整性**而非构建安全：`hasOverride`（文件是否存在）会变成 `true` 而实际零效果，
前端无法区分「已有覆盖但全空」与「无覆盖」，且它与 `DELETE`（真正的恢复默认）语义重叠。
**该理由较弱，属可选项，不得再写成「会报错」。**

（此条由 T3b-2c 执行方在简报之外主动核对上游源码后提出，架构师据此更正 —— 记入批次记录。）

### 17.8 顺带确认的两条上游语义（写入器的行为约束）

- **`null` 在 Mizuki HEAD 是合法的**：合并语义表逐字「标量、`null`：整体替换」
  ⇒ HEAD 档 serde 允许发射 `null`（**已如此实现**）；而 **Shirone 档必须拒绝 `null`**，
  因上游 `assertSerializable` 对 `null` 直接 `fail`（「Keys without values in YAML parse to null;
  use "" to clear text, or [] to clear lists」）。**两档在此处相反，不得统一。**
- **深合并表达不了「删除」**：上游「已知限制」逐字「覆盖只能改值或加字段，没法把上游默认里的某个键去掉」
  ⇒ 面板不提供「删字段」，只提供「改值 / 加键 / 整域恢复默认（= 删文件）」。

### 17.9 `AGENTS.md §3` 订正（移除误导源）

原文「依赖安装要 `--config.node-linker=hoisted`（符号链接权限不足）」**与本仓实际布局相反**，
正是它把我带进 §17.2 的事故。已改为实测警告：说明本仓用默认 isolated 布局、
`--config.node-linker=hoisted` 会触发全量重解析、附事故全链与 59 分钟 vs 6.9 秒对照、
并指向新增的 `check-dep-specs.mjs` 守卫。表格行同步改为「**不要**加该 flag」。
**教训**：文档说法与实测冲突时，**先信实测**——我在动手前读了该条却未核对现场布局。

### 17.10 T3b-2 批次排布（编译期依赖决定必须串行）

| 批次 | 范围 | 依赖 |
|---|---|---|
| **T3b-2c**（先） | L0 `common/theme/shirone-config-serde.ts` + spec：YAML ⟷ 值的发射/解析，镜像上游 `assertSerializable`；文件名一律由 `SHIRONE_DOMAIN_BY_FILE` 反查 | 无（`yaml` 已装） |
| **T3b-2b**（后） | `modules/theme/config-writer.service.ts` + 路由 + spec：消费 `resolveConfigWriteTarget` 与两档 serde | **编译期依赖 2c 的导出** |

⇒ **必须串行**：`T3b-2b` 要 import `T3b-2c` 的模块，2c 未落盘时 2b 无法通过 `pnpm build`。
（两者文件不重叠，但存在编译期依赖 —— 这不是排布偏好，是事实。）

---

## 18. 追加（2026-10-29 第十一回合）：T3b-2b 交付验收 + T3d 交付 + **T3c 的建议重裁**

### 18.1 T3b-2b 交付与验收（服务由执行方出，控制器/模块/e2e 由架构师收尾）

| 件 | 内容 | 验收 |
|---|---|---|
| `modules/theme/config-writer.service.ts` | 386 行，四动作（列域/读域/写域/恢复默认） | **24/24**（架构师独立复跑） |
| `modules/theme/config-write.controller.ts` | 四端点（架构师接） | 下条 e2e |
| `modules/theme/theme.module.ts` | 注册 provider + controller | — |
| `shared/src/theme-config-write.ts` | 请求体信封 schema（`.strict()`） | — |
| `test/theme-config-write.e2e-spec.ts` | **11 用例**（装配面验收） | **11/11** |

**架构师在验收时抓到并修掉一个四条闸都测不出的缺陷**：服务里写的是
`import type { BackupService }` ⇒ `emitDecoratorMetadata: true` 下构造参数的运行期元数据被擦除 ⇒
**Nest 装配期必抛「can't resolve dependencies」**。而单元 spec 用 `new ConfigWriterService({...})`
直接构造，**DI 从不被走过** ⇒ 24 用例全绿也照不出来。
全仓另有 6 个服务对本类均用**值导入**（含 `site-config.service.ts:77` 的单值导入先例），已照此修正并留「勿改回」说明。
**这条只有 e2e 能守**——故 `theme-config-write.e2e-spec.ts` 是本批不可省的装配面验收。

**e2e 迭代中撞到两件事，均记入文件注释防复犯**：
- `POST /system/init` 有**四项项目检测**闸：`package.json` 须含 `astro` 依赖、`astro.config.*` 须存在、
  `src/data/` 须含 `diary.ts` 与 `friends.ts`、`src/content/posts/` 须存在 ⇒ HEAD 形态 fixture 必须全部造出。
- **架构师又一次断言前提错**：曾断言 `GET /admin/config`（`site-config`）为 200，实测 404。
  真因是 `site-config.service.ts` 的 `configTsPath() = <root>/src/config.ts` + `NotFoundException`，
  而本 fixture 是 **HEAD 形态、没有 `src/config.ts`** ⇒ 它**合理地** 404。
  处置：先做**真正的碰撞回归**（跑既有两个大量打 `GET /admin/config` 的套件
  `p4d3-nav` 6 + `p7f-config-override` 16 = **22/22 全绿** ⇒ 既有端点完好），
  再把该断言换成在此 fixture 上成立的口径（未知子路径须路由级 404），并把「正面证据在别处」写进注释。

### 18.2 T3d 交付与验收（裁定 Q6 落地）

`TASK_WHITELIST` 由 **4 → 6**：新增 `content:sync` 与 `sync-content`。
执行器零改动（`taskArgs` 对非 install 任务恒 `['run', task]`，任务名即脚本名）。
验收：`process-manager.spec` **8/8**、`pnpm lint` `EXIT=0`、`pnpm build` `EXIT=0`。

### 18.3 **关键发现：裁定 Q6 的措辞只覆盖了一半**（实测）

Q6 原文是「加固定的无参 `content:sync`」。实测上游 `package.json`：

| 主题 | 同步脚本名 | 证据 |
|---|---|---|
| **Mizuki HEAD** | **`sync-content`** | `"sync-content": "node scripts/sync-content.js"` —— **没有** `content:sync` |
| **Shirone** | **`content:sync`** | `"content:sync": "node scripts/content/sync.mjs"` |

⇒ **同一个概念，两档脚本名完全不同。** 若只加 `content:sync`，则对「裁定 A 要迁过去的」
Mizuki HEAD 档**完全无用**（`pnpm run content:sync` 会因脚本不存在而失败）—— 那正好是 T3d 最该服务的一档。

**处置**：两个名字都进白名单。理由与边界：
- 任务名即脚本名，执行器保持「哑」（固定无参 + `shell:false` + 不接受用户传参），
  **加白名单不引入任何新的执行面**；
- 由哪个形态显示哪一个由服务端能力画像决定，**不做进白名单常量**（常量只放名字）；
- 前端按钮与形态过滤属 **T6**（按能力画像渲染），本批只交付后端能力。

Shirone 另有 `content:status` / `content:validate`（`--dry-run`）/ `content:watch` / `content:clean` /
`content:eject` / `content:export` —— 只读的 `content:status` 对面板价值高，**登记为后续可选项，本批不做**。

### 18.4 `|| true` 的确切位置（我们的立场）

`|| true` **不在**我们要调用的脚本里，而在 HEAD 的**预脚本**里：
`"predev": "node scripts/sync-content.js || true"`、`"prebuild": "…|| true"`。
⇒ 上游**把 dev/build 之前的同步失败静默吞掉**。本服务**不继承**该行为：
白名单任务的退出码由子进程原样上报（`startTask` 的 `exit` 事件 → `finalize`），同步失败在面板上必须看得见。
这也是「不复制上游的 `|| true`」这条约束的准确含义 —— 我们从未打算做，但值得记下**它在上游的位置**。

### 18.5 顺带修掉一处前端重复真源（架构师发现）

`apps/web/src/api/process.ts` 曾**手写** `type ProcessTaskName = 'install' | 'dev' | 'build' | 'preview'`，
而同文件 `TaskEnvView` 上方恰好写着本仓口径：「**直接引用 shared 单源**……前端零本地类型复制
（键名/形状漂移不可能发生）」。⇒ 该手写 union 违反本仓自己的约定，后果是**白名单加项时前端静默落后**：
后端已收 `content:sync`，前端类型仍说只有四项，**且不报错**。
已改为从 shared 推导（`import type { ProcessTaskName as SharedProcessTaskName }` + `export type`）。
`pnpm build` 含 web 的 `vue-tsc --noEmit`，该改动已过编译。

### 18.6 **T3c 的建议重裁（待 dj）**：参数化 ts-morph 这条路建议**取消**

原 T3c 定义（§14.4）：为 Shirone / HEAD 的 **local mode** 提供参数化 ts-morph，
改写 `src/config/<域>Config.ts`。核查后认为该定义的两个前提都不成立：

**（a）Mizuki HEAD 档的目标文件搞错了。** HEAD local mode 的正确落点**不是** `src/config/<域>Config.ts`
—— 那是**上游默认值文件**，改它正是裁定 A 要终结的「直接篡改上游默认源码」的历史包袱。
正确落点是 **`src/config/overrides/<name>.ts`**，而 `overrideLoader` 本来就 `import.meta.glob("./overrides/*.ts")`
读它 ⇒ **根本不需要 ts-morph，也不需要新写入器**：就是现有 `mizuki-head-override` 这个 sink，
只是 `dirAbs` 换成 `<root>/src/config/overrides`、`needsSync` 换成 `false`。

**（b）Shirone 档的目标文件是生成物。** `config-overlay.mjs` 的 `GENERATED_CONFIG_FILE = "src/user/user-config.ts"`
（注释逐字：「生成物落点」）⇒ 写生成物是错的，**Shirone local mode 应维持拒绝**。

**⇒ 建议**：T3c 从「参数化 ts-morph 写入器」**重裁为**「HEAD local mode 档：复用现有 sink，
新增一个 `ok` 形态（`dirAbs = <root>/src/config/overrides`、`needsSync: false`）」，
并**取消**参数化 ts-morph 这条路线（省掉为 18/32 个配置模块写 AST 改写器的全部工作量）。

**但有一个必须由 dj 拍板的风险**：HEAD 的 `src/config/overrides/` **会被同步脚本清除**。
`scripts/sync-content.js:100-104` 把该目录定为「复制而非软链」的落点，同文件 `:111-118` 在内容仓没有
`overrides/` 时对它 `fs.rmSync(recursive)`；上游文档亦称该目录「**不随代码仓库提交**」。
⇒ 在 local mode 写入的覆盖，**日后一旦启用内容分离，会被静默清掉**。
这与 ADR 的耐久性原则（「拒写会即将被清掉的落点」）并不直接冲突（local mode 下没有内容仓、清除并不临近），
但**「写进去的东西将来会无声消失」是否可接受**，属产品判断，**建议由 dj 裁定**：
① 允许并带显著风险提示；② 维持拒绝（现状），local mode 用户继续手改文件。

---

## 19. 追加（2026-10-29 第十二回合）：T4-1 交付 + **架构师自身的一处契约设计错误**（由执行方挡下）

### 19.1 T4-1 交付

`packages/shared/src/posts-frontmatter-compat.ts`（209 行，纯数据：类型 + 表 + `.filter().map()` 派生的 4 个集合 +
`postsFieldDisposition`）+ `apps/server/test/shared/posts-frontmatter-compat.spec.ts`（19 条）+
`shared/src/index.ts` 末尾 +2 行。四闸全绿。

### 19.2 **架构师的错误：把两个正交的轴压进了一个字段**

我给 T4-1 的三条不变量是「dropped 恰 5 / added 恰 8 / changed 恰 2」，同时要求「`field` 全表唯一」。
**这两条互斥** —— 执行方没有盲从，而是指出 `license` 被计了两次：
- `refs/theme-compat/README.md` §2.3「Shirone 新增字段（8）」的第 8 行是 `license`；
- §2.2「改型字段（2）」又把**同一个字段**登记为「版权三字段合并为 `license`」。

⇒ **8/5/2 与 field 唯一无法同时成立。** 执行方给了三条出路并要求裁决。

**根因是我的契约形状错**，不是文档错：我把两件**正交**的事塞进了同一个 `disposition` 字段：

| 轴 | 它回答的问题 | 对 `license` 的答案 |
|---|---|---|
| **存在性** | 该字段在各档**有没有**？ | Mizuki 侧**根本没有** `license` ⇒ **`added`** |
| **搬运** | 值**怎么搬**进去？ | `licenseName`/`licenseUrl`/`author`/`sourceLink` → `license.{name,url,author,source}` |

「三合一」是**搬运规则**，不是 `license` 的存在形态 ⇒ 让它去占用 `disposition` 的 `changed` 槽位，
必然与「新增 8」重复计数。

### 19.3 裁决：拆成两个轴（T4 的正式输入面）

**`disposition` 只表「存在性」**：`same` / `added` / `dropped` / `changed`（`changed` = 两档都有但形态不同）。
**另立 `POSTS_MIZUKI_TO_SHIRONE_FIELD_MAP`** 表「搬运」（`{from, to, detail}`，`to` 可含子路径）。

修正后的不变量（**行数不变，只改标签 + 加一张表**）：

| 桶 | 数量 | 内容 |
|---|---|---|
| `same` | **19** | §2.1 逐字段展开（15 个单名 + `prevTitle`/`prevSlug`/`nextTitle`/`nextSlug` 四名） |
| `added` | **8** | `publishedAt` / `updatedAt` / `series` / `seriesOrder` / `hideHomeContent` / `prevUrl` / `nextUrl` / **`license`** |
| `dropped` | **5** | `priority` / `author` / `sourceLink` / `licenseName` / `licenseUrl` |
| `changed` | **1** | `password`（Shirone 收 `string \| number` 并 `.transform(String)`，**无 default**） |
| **合计** | **33** | 与表行数一致 ✔ |

**字段映射表 4 条**：`licenseName`→`license.name`、`licenseUrl`→`license.url`、`author`→`license.author`、
`sourceLink`→`license.source`。

> **⚠ 出处订正（架构师原文写错，2026-10-29）**：初稿写「**全部转录自** `refs/theme-compat/README.md` §2.4
> 各行自带的 `detail` 文案」——**该表述不实**：§2.4 那张表**只有两列**（`字段` | `Mizuki 类型/默认`），
> **没有 `detail` 列**，无从转录。执行方核对后指出并改用了本表 dropped 行的既有文案对齐。
>
> **真实出处**：由**上游 `src/content.config.ts` 的 `license` 对象键名**推得（该对象为
> `{ enable?, name?, url?, author?: string | {name?,url?}, source? }`），再结合
> `refs/theme-compat/README.md` §2.2 的语义注记（「结构合并 + 增强：支持单篇覆写作者与转载来源」）。
> ⇒ 这是**推导**，不是转录。**T4-2 写 Shirone schema 时必须带两档 schema 并排复核这 4 条**，
> 如有出入以复核结果为准（推导需域验证，`PROCESS-RULES` R4）。

**`priority` 刻意不入映射表**：Shirone 侧**没有与之对应的字段**。`seriesOrder` 是「系列内顺序」，
与「文章优先级」是不同概念 —— **不得用 `seriesOrder` 承接 `priority`**（那会静默改变语义）。
它只在 `DROPPED` 里以「无字段级落点」陈述。此裁定已由执行方主动提出并要求确认，**确认：不入表**。

**两轴正交的可见证据**（已写成 spec 断言）：`licenseName` / `licenseUrl` / `author` / `sourceLink`
这 4 个名字**同时出现在 `DROPPED`（存在性：Mizuki 独有）与 `MAPPED`（搬运：进 `license.*`）两个集合里** ——
一个字段当然可以「在本档存在、被搬走、且在目标档以别的形态出现」。压成一轴时这件事无法表达。

### 19.4 顺带订正的第二个文档算术错误

`refs/theme-compat/README.md` §2.1 表头写「**共有字段（20）**」，但表内逐字段展开只有 **19** 个名字
（15 个单名 + 两行各合写 2 个名字 = 4 名）。已订正为 **19**。⇒ 该文档同一节里被我写错了两处数字
（表头 20、ADR §2.1 的「改型 2」），**两处都是同一类错误：凭印象写数量而没有逐行数**。

### 19.5 为什么要立这一节

`disposition` 与 `FIELD_MAP` 一旦被后人「合并回一个字段」（看起来更简洁），
**8/5/2 与 field 唯一的矛盾会立刻复发**。故在 `posts-frontmatter-compat.ts` 的文件头、
该文件的 spec、以及本节的显式措辞里都留下 **「禁止合并回一轴」**。

**本轮的过程价值**：执行方**拒绝盲从架构师给出的数字**，而是先验证不变量是否自洽、发现矛盾后
**给出三条可选路径并要求裁决** —— 这正是我们要的行为。若它照抄我的数字交差，
`field` 唯一或计数必然有一处是假的，而这类假数据会一路流到 T4-3 的转换摘要里。

---

## 20. 追加（2026-10-29 第十三回合）：**T3c 裁定 = ②（维持拒绝，零新增代码）· T3 主线封板**

### 20.1 dj 裁定

§18.6 把 T3c 的两个选项与数据风险摆出后，dj 裁定 **② 维持拒绝**：
**取消原 T3c 的 AST 改写器，且不开 `src/config/overrides/` 的 local mode 写入口。**

三条理由（dj 原文要点）：
1. **守住「零静默丢数据」的架构底线** —— T3b-1 费力拦下 git 工作副本与生成物，核心原则就是
   「**凡是会被上游脚本在未来某个时刻无声抹掉的目录，Kova 绝不往里写持久化数据**」。
   `sync-content.js:111-118` 在内容仓无 `overrides/` 时会对代码仓的 `src/config/overrides/` 执行
   `fs.rmSync(recursive)` ⇒ 允许 local mode 写入等于埋定时炸弹：用户哪天照文档开启内容分离，
   面板里配好的心血瞬间归零。**警告弹窗免除不了丢数据时的挫败感。**
2. **引导路径清晰且成本极低** —— Mizuki HEAD 与 Shirone 本来就把「内容分离（本地路径源）」当一等公民设计；
   用户想用面板管配置，只需按拒绝提示建一个本地 `content/` 目录即可切入**完全受保护**的持久侧车通道。
3. **彻底砍掉分域 ts-morph 负债** —— 原 T3c 要给 18/32 个配置模块写 AST 改写器，本就是早期前提不完整的产物；
   既然两边 local mode 都维持显式拒绝（并给出启用本地内容目录的指引），
   T3c 以「**维持 T3b-1 既有拒绝契约，零新增代码**」结案。

### 20.2 因此落定的三条口径

| 项 | 结论 |
|---|---|
| 原 T3c 的**参数化 ts-morph 写入器** | **取消**（不实现） |
| **HEAD local mode** | **维持拒绝**（`mizuki-head-no-content-dir` 等既有 reason 原样保留，其 `message` 已含「下一步：把内容仓克隆到该目录（或用 `CONTENT_DIR` 指向它）」的指引） |
| **Shirone local mode** | **维持拒绝**（`shirone-local-mode`；其目标 `src/user/user-config.ts` 是上游 `GENERATED_CONFIG_FILE`「生成物落点」，写生成物本身就是错的） |

⇒ **T3 主线（T3a / T3b / T3c / T3d）至此全部闭环**，且 T3c 是「**以不写代码的方式完成的**」——
本项目第一次以「**明确拒绝 + 清晰指路**」作为一条批次的完整交付形态。

### 20.3 一条方法论（值得留下）

**「拒绝」也可以是一个交付物，前提是拒绝必须带可执行的下一步。** 本档的三条拒绝理由都满足这一点：
`mizuki-head-no-content-dir` 告诉用户去克隆内容仓、`shirone-local-mode` 告诉他去加清单声明、
`panelSupport:'none'` 告诉他去编辑内容仓的那个具体文件。⇒ 面板上不存在「一条死路」，
每条拒绝都是**一条改道的指路牌**。若将来有人以「用户体验不好」为由想放宽这些拒绝，
先读本节 20.1 第 1 条 —— **丢数据的挫败感远大于被指路的轻微不便**。
