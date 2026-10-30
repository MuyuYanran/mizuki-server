# Mizuki 配置面两种布局权威表（legacy 6.1.2 / HEAD 7.1.3）→ Shirone 映射

> **用途**：T3（配置三档）的寻址依据。Mizuki 上游**自己改过配置布局**，两种布局的
> 「可写域名单」**不一样**，且 HEAD 的覆盖文件名**不等于**源文件名。靠推导必错。

## 0. 复现命令

```bash
# 工作目录：上游 Mizuki 源码仓（本机存档于 .test-tmp/upstream-Mizuki-20261028，depth-1）
git ls-tree -r HEAD --name-only | grep -E "^src/config"     # 21 个文件，无 src/config.ts
node -e "const s=require('./package.json').scripts;console.log(s['sync-content'],'|',s.predev)"
sed -n '/OVERRIDABLE_CONFIGS/,/] as const/p' src/config/overrideLoader.ts
```

---

## 1. 两种布局与判别子（实测唯一性）

| | **mizuki-legacy**（本地生产快照） | **mizuki HEAD**（`c06f000`） |
|---|---|---|
| astro | 6.1.2 | 7.1.3 |
| 配置形态 | **单文件** `src/config.ts`（17321 B，**18** 个顶层导出） | **`src/config/` 21 个文件**（`git ls-tree` 实测 `src/config.ts` **0** 个） |
| 覆盖机制 | 无（由 mizuki-java-server 注入 `src/server/`） | **一等公民侧车** `src/config/overrides/<导出名>.ts` |
| 判别子（固定叶子，statSync） | `src/config.ts` **是文件** | `src/config/overrideLoader.ts` **是文件** |

> **为何必须用这两个叶子判别**：`src/config/` 目录 + `src/config/siteConfig.ts` 这条既有 Shirone 判据
> **对 Mizuki HEAD 同样成立**——两档 `src/config/*.ts` 有 **12 个文件名完全重合**
> （含 `siteConfig.ts` 与 `index.ts`）。靠「有没有 `src/config/`」区分一定会误判。

---

## 2. HEAD 可变覆盖的 **18** 个名（`overrideLoader.ts` 的 `OVERRIDABLE_CONFIGS`）

### 2.1 覆盖文件名 = **导出常量名**，不是源文件名

上游 `overrideLoader.ts` 的约定（注释逐字）：「覆盖文件名 = 被覆盖的导出常量名。例如
`overrides/sakuraConfig.ts` 覆盖 `sakuraConfig`（**注意上游文件名是 `effectsConfig.ts`**）。
文件名拼错会在**构建期报错**，而不是静默失效。」
未知覆盖名 → `throw new Error('Unknown config override … The file name must match one of the exported config names')`。

⇒ **Kova 写入的是 `overrides/<覆盖名>.ts`**，**不是** `overrides/<源文件名>.ts`。

| # | 覆盖名（= 要写的文件名） | 上游源文件 | 文件名是否不同 |
|---|---|---|---|
| 1 | `siteConfig` | `siteConfig.ts` | |
| 2 | `fullscreenWallpaperConfig` | `backgroundWallpaper.ts` | **⚠ 不同** |
| 3 | `navBarConfig` | `navBarConfig.ts` | |
| 4 | `profileConfig` | `profileConfig.ts` | |
| 5 | `licenseConfig` | `licenseConfig.ts` | |
| 6 | `permalinkConfig` | `permalinkConfig.ts` | |
| 7 | `expressiveCodeConfig` | `expressiveCodeConfig.ts` | |
| 8 | `commentConfig` | `commentConfig.ts` | |
| 9 | `shareConfig` | `shareConfig.ts` | |
| 10 | `announcementConfig` | `announcementConfig.ts` | |
| 11 | `musicPlayerConfig` | `musicConfig.ts` | **⚠ 不同** |
| 12 | `footerConfig` | `footerConfig.ts` | |
| 13 | `sidebarLayoutConfig` | `sidebarConfig.ts` | **⚠ 不同** |
| 14 | `sakuraConfig` | `effectsConfig.ts` | **⚠ 不同** |
| 15 | `pioConfig` | `pioConfig.ts` | |
| 16 | `relatedPostsConfig` | `relatedPostsConfig.ts` | |
| 17 | `randomPostsConfig` | `randomPostsConfig.ts` | |
| 18 | `markdownConfig` | `markdownConfig.ts` | |

**同一目录里还有 3 个文件不可覆盖**：`index.ts`（合并入口）、`overrideLoader.ts`、`deepMerge.ts`。
另有一项 `widgetConfigs` 是**聚合导出**（`index.ts` 里把 profile/announcement/music/layout/sakura/
fullscreenWallpaper/pio/share/relatedPosts/randomPosts 拼成一个对象），**不在** `OVERRIDABLE_CONFIGS` 里。

### 2.2 覆盖文件的物理形态

```ts
// overrides/siteConfig.ts —— 文件名 = 导出名；default 导出；类型相对路径按「同步后」的位置写
import type { SiteConfig } from "../../types/config";
export default { /* DeepPartial<SiteConfig> */ } satisfies DeepPartial<SiteConfig>;
```
- 内容仓 `<内容仓>/overrides/*.ts` ──`node scripts/sync-content.js`──> 代码仓 `src/config/overrides/`
- `src/config/overrides/` 已 gitignore（`.gitignore:27 /src/config/overrides/`）
- 合并：`最终配置 = deepMerge(上游默认, overrides/<名>.ts 的 default)`
- **回滚**：删掉内容仓 `overrides/` 里的文件 + 重跑 sync ⇒ 回到上游默认值（上游文档明写的语义）

---

## 3. HEAD 的 18 个覆盖名 → Shirone 32 个域

分类口径（dj 2026-10-29 裁定）：**直接对应**走同名域；**归并**在适配层做字段级拆装；
**孤儿**在接口层按 capabilities 报 `unsupported`、前端置灰，**绝不硬造假配置**。

| 覆盖名 | Shirone 落点 | 类别 |
|---|---|---|
| `siteConfig` | `site` | 直接 |
| `permalinkConfig` | `permalink` | 直接 |
| `profileConfig` | `profile` | 直接 |
| `licenseConfig` | `license` | 直接 |
| `expressiveCodeConfig` | `expressiveCode` | 直接 |
| `announcementConfig` | `announcement` | 直接 |
| `commentConfig` | `comment` | 直接 |
| `footerConfig` | `footer` | 直接 |
| `musicPlayerConfig` | `music` | 直接 |
| `navBarConfig` | `navBar` | 直接（**注意两边都是整体替换**：Mizuki `overrideLoader` 走 `deepMerge` 但 `navBarConfig` 是数组结构；Shirone 侧 `partial:false`） |
| `sidebarLayoutConfig` | `sidebar` | 直接 |
| `fullscreenWallpaperConfig` | `site`（`wallpaperMode` / `texture` / `banner` / `layoutMode` / `reduceMotion`） | **归并** |
| `shareConfig` | `article.share` | **归并** |
| `relatedPostsConfig` | `article.relatedCount` | **归并** |
| `randomPostsConfig` | `article.randomCount` | **归并** |
| `sakuraConfig` | — | **孤儿**：Shirone 里 `sakura` 只是纹理预设取值（`texture.defaultPreset` / `constants.ts`），**语义不同**（Mizuki 是飘落特效开关）⇒ `unsupported` |
| `pioConfig` | — | **孤儿**：Shirone 内无 `live2d`/`pio`（已 grep 全 `src/`）⇒ `unsupported` |
| `markdownConfig` | — | **孤儿（待核）**：Shirone 32 域里**无** `markdown` 域。是否部分字段有归属（如代码块相关落 `expressiveCode`、渲染相关落 `article`）**未经逐字段核实**，T3b 必须核完再定性；核不出即 `unsupported`，**不得猜** |

---

## 4. 两个布局的「18」不是同一组（**易错点**）

| | legacy `src/config.ts` 的 18 个顶层导出 | HEAD 的 18 个覆盖名 |
|---|---|---|
| 有 | `widgetConfigs`（聚合） | — |
| 有 | — | `markdownConfig` |
| 其余 17 个 | 相同 | 相同 |

⇒ T3 的三档表**不能共用一份「18」**。legacy 侧沿用 `docs/refs/theme-compat/README.md` §3.1 的
18 行导出表；HEAD 侧用本文件第 2 节；Shirone 侧用 `shirone-config-domains.md` 的 32 行表。

---

## 5. 生效时机（两档 Mizuki 也不同）

| 档 | 触发 | sync 是否自动跑 |
|---|---|---|
| legacy 6.1.2 | `pnpm build` / `pnpm dev` | **无 sync 概念**（内容与代码同仓） |
| HEAD 7.1.3 | `sync-content` = `node scripts/sync-content.js`；`predev` / `prebuild` = `node scripts/sync-content.js \|\| true` | ✅ npm lifecycle **自动前置** |
| Shirone | `node scripts/content/sync.mjs`（`dev`/`start`/`build` 脚本显式前缀） | ✅ 显式前缀 |

**两条共同的硬约束**：
1. **配置覆盖必须在挂载之后**（Shirone `sync.mjs:450` 注释明写；Mizuki 的 `sync-content` 同理——
   它先物化 mounts 再写 overrides）。
2. **dev server 不监听内容仓**（Mizuki `docs/CONTENT_SEPARATION.md:365` 逐字；Shirone 的
   dev watcher 也只覆盖主题 `src/config/`）⇒ 写完侧车要么由 Kova 触发一次 sync，
   要么在面板标注「下次 dev 启动/构建生效」。

**一处上游的雷（勿复制）**：Mizuki HEAD 的 `predev`/`prebuild` 带 `|| true`
⇒ sync 失败被**静默吞掉**，构建照跑但覆盖层是旧的/空的。
⇒ Kova 自己的 `sync` 动作**必须回传真实退出码**。

---

## 6. 覆盖文件的生成口径（T3b-2 直接照此生成）

上游要求覆盖文件是**手写 TS 模块**（`docs/CONTENT_SEPARATION.md` §写法，示例逐字）：

```ts
// overrides/siteConfig.ts
import type { DeepPartial, SiteConfig } from "../../types/config";

export default {
  title: "我的站点",
  /* 只写想改的字段 */
} satisfies DeepPartial<SiteConfig>;
```

硬约束（上游「要点」逐字）：

- 必须是 **`export default`**；命名导出**不被识别**（构建期报错）
- 用 **`DeepPartial<T>`** 而不是 `Partial<T>`：后者只让顶层键可选，写 `carousel: { interval: 8 }`
  会因为缺 `enable`/`switchable` 而报错
- 相对路径 **`../../types/config`** 是**同步到 `src/config/overrides/` 之后**的位置
  （内容仓本身没有 TS 环境；类型检查在代码仓跑 `pnpm type-check` 时才做）

### 6.1 18 行的类型表（**这是 T3b-2 生成文件所必需的那张表**）

来源：`<theme>/src/config/index.ts` 的导入表 + `<theme>/src/types/config.ts` 的导出接口清单。
覆盖名 ≠ 源文件名的 4 处见 §2.1；**下表的「类型模块」列一律相对 `src/config/overrides/`**。

| # | 覆盖名（= 写入的文件名） | 上游源文件 | TS 类型名 | 类型模块 |
|---|---|---|---|---|
| 1 | `siteConfig` | `siteConfig.ts` | `SiteConfig` | `../../types/config` |
| 2 | `fullscreenWallpaperConfig` | `backgroundWallpaper.ts` | `FullscreenWallpaperConfig` | `../../types/config` |
| 3 | `navBarConfig` | `navBarConfig.ts` | `NavBarConfig` | `../../types/config` |
| 4 | `profileConfig` | `profileConfig.ts` | `ProfileConfig` | `../../types/config` |
| 5 | `licenseConfig` | `licenseConfig.ts` | `LicenseConfig` | `../../types/config` |
| 6 | `permalinkConfig` | `permalinkConfig.ts` | `PermalinkConfig` | `../../types/config` |
| 7 | `expressiveCodeConfig` | `expressiveCodeConfig.ts` | `ExpressiveCodeConfig` | `../../types/config` |
| 8 | `commentConfig` | `commentConfig.ts` | `CommentConfig` | `../../types/config` |
| 9 | `shareConfig` | `shareConfig.ts` | `ShareConfig` | `../../types/config` |
| 10 | `announcementConfig` | `announcementConfig.ts` | `AnnouncementConfig` | `../../types/config` |
| 11 | `musicPlayerConfig` | `musicConfig.ts` | `MusicPlayerConfig` | `../../types/config` |
| 12 | `footerConfig` | `footerConfig.ts` | `FooterConfig` | `../../types/config` |
| 13 | `sidebarLayoutConfig` | `sidebarConfig.ts` | `SidebarLayoutConfig` | `../../types/config` |
| 14 | `sakuraConfig` | `effectsConfig.ts` | `SakuraConfig` | `../../types/config` |
| 15 | `pioConfig` | `pioConfig.ts` | `PioConfig` | `../../types/config` |
| 16 | `relatedPostsConfig` | `relatedPostsConfig.ts` | `RelatedPostsConfig` | `../../types/config` |
| 17 | `randomPostsConfig` | `randomPostsConfig.ts` | `RandomPostsConfig` | `../../types/config` |
| 18 | `markdownConfig` | `markdownConfig.ts` | **`MarkdownEnhancementConfig`** ⚠ | **`../../config/markdownConfig`** ⚠ |

`DeepPartial<T>` 也从 `../../types/config` 导出（`src/types/config.ts:602`）。

⚠ **第 18 行是唯一例外**：`markdownConfig` 的接口**不在** `types/config.ts` 里，而是
**声明在它自己的配置文件中**（`src/config/markdownConfig.ts` 导出 `interface MarkdownEnhancementConfig`），
且类型名与配置名**不同名**。⇒ 它的类型模块是 `../../config/markdownConfig`。
（type-only 导入在编译期被擦除，不构成运行期循环。）

**若某行拿不到类型**：可以不写 `satisfies`，退化为 `export default { … };`。
上游 `overrideLoader` 只检查「有没有 `default` 导出」，不校验类型标注 ⇒ **不会因此构建失败**，
只是该文件失去类型检查。**但禁止**编造类型名——写错类型名会**真的**把构建弄挂。

### 6.2 上表的源证记录（2026-10-29，逐文件核实，**不是推断**）

本表的 `typeName` 列曾由架构师对照 `types/config.ts` 的导出清单推得。**已改为逐文件源证**，形态 18/18 一致：

```
export const <覆盖名>: <类型名> = {          ← 就在它自己的专属文件里
```

| 行 | 证据（`<theme>/src/config/`） |
|---|---|
| 1 `siteConfig` | `siteConfig.ts:6` `export const siteConfig: SiteConfig = {` |
| 2 `fullscreenWallpaperConfig` | `backgroundWallpaper.ts:3` |
| 3 `navBarConfig` | `navBarConfig.ts:129` |
| 4 `profileConfig` | `profileConfig.ts:4` |
| 5 `licenseConfig` | `licenseConfig.ts:4` |
| 6 `permalinkConfig` | `permalinkConfig.ts:4` |
| 7 `expressiveCodeConfig` | `expressiveCodeConfig.ts:4` |
| 8 `commentConfig` | `commentConfig.ts:5` |
| 9 `shareConfig` | `shareConfig.ts:4` |
| 10 `announcementConfig` | `announcementConfig.ts:4` |
| 11 `musicPlayerConfig` | `musicConfig.ts:4` |
| 12 `footerConfig` | `footerConfig.ts:4` |
| 13 `sidebarLayoutConfig` | `sidebarConfig.ts:8` |
| 14 `sakuraConfig` | `effectsConfig.ts:3` |
| 15 `pioConfig` | `pioConfig.ts:4` |
| 16 `relatedPostsConfig` | `relatedPostsConfig.ts:4` |
| 17 `randomPostsConfig` | `randomPostsConfig.ts:4` |
| 18 `markdownConfig` | `markdownConfig.ts:24` `export const markdownConfig: MarkdownEnhancementConfig = {` |

**「类型模块」列的端到端证明**：上表 17 个源文件写的都是 `import type { <T> } from "../types/config"`
（从 `src/config/` 回退一级 = `src/types/`）。而覆盖文件在 **`src/config/overrides/`** ⇒ 回退**两级** = `../../types/config`。
**这正是 dj 指出的那一点，至此获得源码级闭环：基准是同步后的目标目录，不是落盘目录。**

**第 18 行例外的二次确认**：`markdownConfig.ts` **没有任何类型 import**，且 `MarkdownEnhancementConfig`
在 `types/config.ts` 里 `grep -c` = **0** ⇒ 该接口确实声明在它自己文件的第一行（`markdownConfig.ts:1`
`export interface MarkdownEnhancementConfig {`），类型模块只能是 `../../config/markdownConfig`。

**另两条附带事实**（同批顺手核到，T3b-2/T4 可用）：
- `DeepPartial<T>` 定义在 `src/types/config.ts:602`。
- 18 行里 **`name ≠ sourceFile`（去扩展名）的恰好 4 行**：`fullscreenWallpaperConfig/backgroundWallpaper`、
  `musicPlayerConfig/musicConfig`、`sidebarLayoutConfig/sidebarConfig`、`sakuraConfig/effectsConfig`。
  与 §2.1 一致；`index.ts:12-30` 的头部导出表是这四处的第三个独立印证。

## 7. 覆盖层的合并语义（决定 Kova 该写什么、不该写什么）

上游 `docs/CONTENT_SEPARATION.md` §合并语义逐字：

| 情况 | 行为 |
|---|---|
| 双方都是普通对象 | **深合并**，覆盖值只影响写到的字段 |
| **数组** | **整体替换**，不拼接 |
| 标量、`null` | 整体替换 |
| 覆盖值里**显式写 `undefined`** 的键 | **跳过**，保留默认值 |
| 没有对应覆盖文件 | 原样使用上游默认值 |

⇒ 对 T3b-2 的三条直接推论：
1. **不要写 `undefined`**，要**省略该键**（否则语义上「跳过」，但留下噪音）
2. 删掉一个覆盖文件 = 恢复该域的**全部**上游默认值（不是「只恢复某个字段」）
3. 「清空某字段」只能通过写 `null`（标量位）或空数组（数组位）实现，**不能**靠写 `undefined`
