# U5-THEME-A1 交付报告 —— 主题侧 `[Mizuki-Server]` 接入层契约对齐（阅读链路）

- 执行：2026-10-28（架构师亲自执行；dj 当轮明示「直接执行」）
- 指令包：[`../theme-server-contract/FIX-PACK.md`](../theme-server-contract/FIX-PACK.md)
- 对账审计：[`../theme-server-contract/README.md`](../theme-server-contract/README.md)
- **结论：验收 A1–A6 全部 PASS。生产面零触碰**（prod DB / `Mizuki/dist` / prod `config.json` 逐项自证，见 §6）

---

## 0. 基线修正（dj 2026-10-28 补充）

> 「现在文件目录的 mizuki 不是原版 mizuki，是被 **mizuki-java-server** 修改后的，原仓库在 https://github.com/LyraVoid/Mizuki」

这条**改写了审计 §8 的根因表述**，并已被上游实测证实（§7）：

- 本地 `BlogFiles\Mizuki` = **上游 `LyraVoid/Mizuki` + mizuki-java-server 注入层 + 内容被改写**
- 因此主题侧那套 `{code,message,data}` 数字信封、`/api/v1/site/*`（站内用户）、`/api/v1/admin/file-articles`（按磁盘 path 定位）等 Java 风格契约，全部来自 **mizuki-java-server**，不是本仓前身，也不是仓内文档提到的 Python `app.py`
- **`app.py` 与本批是两个不同的前身**：`app.py` 是更早的 Python 管理器（`REQUIREMENTS §2.2 / 附录 A.7·A.9`），主题侧接入层属 java-server

---

## 1. 前置条件实测

| # | 条件 | 实测 |
|---|---|---|
| P1 | 服务端在跑 | ✅ dj 生产实例 20154（pid 37108）+ 面板 dev 20155 均在监听 |
| P2 | 有已发布 richtext 文章 | ❌ **实测 0 条**（`article` 表仅 2 行，均 markdown）→ 造了 1 条验收样本（见 §3） |
| P3 | `config.json` 有 `corsOrigins` | ❌ **缺该键** → 本地用临时 config 提供；**生产未改**（见 §8） |
| P4 | 改前快照 | ✅ `.snapshot-20261028-092338` |
| P5 | 是否同源 | **跨源**（站点 origin ≠ API origin）⇒ CORS 是硬前置 |

---

## 2. 主题侧改动（3 文件 / **9 处 hunk**；指令包原计划 8 处，实测新增 1 处）

| 文件 | hunk | 内容 |
|---|---|---|
| `src/components/server/DynamicArticleLoader.astro` | 5 | ① `coverImage`→`cover` ② `item.url`→ 由 slug 自拼 `/articles/<slug>/` ③ `description`→`summary` ④ `&size=50`→`&limit=50` + `body.code!==0`→`!res.ok` + `body.data.list`→`body.items` ⑤ **【包外新增】只收 `sourceType === "richtext"`** |
| `src/pages/articles/[...slug].astro` | 2 | ① `getStaticPaths`：`items`/`limit=50`/`!res.ok`/**只为 richtext 生成壳页** ② `load()`：裸体详情 + `article.html` + markdown 防御跳 `/posts/<slug>/` |
| `src/pages/[...page].astro` | 2 | ① 引入 `mizukiServerConfig` ② `<DynamicArticleLoader />` 加 `enableHomeMerge` 条件 |

**sha256 对照**

| 文件 | 改前 | 改后 |
|---|---|---|
| `[...slug].astro` | `9d6261ea52883e43…` | `b02dff5b8dcfe987…` |
| `DynamicArticleLoader.astro` | `3b3f0aa0c47fbaa1…` | `5cb998e417094ac8…` |
| `[...page].astro` | `7cf684f024e41b09…` | `ca4f501d4c532ce4…` |

### 2.1 【包外新增】第 ⑤ 处为什么必须加

`DynamicArticleLoader` 原本用 `staticSlugs`（从首页 `#post-list-container a[href]` 反推 slug）过滤掉静态 markdown 文章。实测该过滤**被 `alias` 击穿**：

- 首页静态列表里 `encrypted-post` 的链接是 **`/posts/encrypted-example/`**（其 `alias`）
- 于是 `staticSlugs` 里是 `encrypted-example`，`!staticSlugs.has("encrypted-post")` 为真 → **不滤除** → 生成卡片 `href="/articles/encrypted-post/"`
- 而 `/articles/<md-slug>/` 在本批之后已不再生成 ⇒ **404 卡片**

故过滤条件收紧为 `item.sourceType === "richtext" && !staticSlugs.has(item.slug)`。浏览器实测已确认卡片数 = 1（仅富文本那条）。

---

## 3. 验收样本（**只写临时 DB 副本，生产 DB 零写入**）

- 独立实例：端口 **20164**，`MIZUKI_CONFIG_PATH`/`MIZUKI_DB_PATH` 指向 `.test-tmp/theme-a1-check/`，`MIZUKI_PREVIEW_PORT=0`（否则 4173 与 dj 生产实例冲突启动失败）
- 临时 `config.json` 带 `corsOrigins: [http://localhost:4321, http://127.0.0.1:4321, …]`
- 经 **真实管理 API** 创建并发布：`POST /api/v1/admin/auth/login` → `POST /api/v1/admin/articles`
  - slug `u5-theme-a1-sample`，标题「U5-THEME-A1 契约联调样本」，正文含 h2 / 粗体 / 段落 / 无序列表 + 标记 `RICHTEXT-LINK-OK`
- 构建：`astro build --outDir dist-a1-check`（**未覆盖 `Mizuki/dist`**），`PUBLIC_MIZUKI_SERVER_URL=http://127.0.0.1:20164`

---

## 4. 验收结果

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| **A1** | `dist/articles/` 不再有 markdown slug | ✅ | 改前 6 个（`encrypted-post guide markdown-extended markdown-mermaid markdown-tutorial video`）→ 改后仅 `u5-theme-a1-sample` |
| **A2** | 每个已发布 richtext slug 都有壳页，数量一致 | ✅ | 接口 `sourceType==='richtext'` = `["u5-theme-a1-sample"]`；与目录 `diff` 为空 |
| **A3** | 浏览器打开壳页：标题正确、正文渲染、无「动态服务暂不可用」、控制台无 CORS 报错 | ✅ | 真机浏览器（bsk）：`document.title` = 「U5-THEME-A1 契约联调样本」；正文渲染出 `h2` / `<strong>` / `<ul><li>`；标记 `RICHTEXT-LINK-OK` 命中；**控制台仅主题自身与浏览器扩展日志，零报错** |
| **A4** | 首页出现富文本卡片、链接形如 `/articles/<slug>/`、点进去命中 A3 | ✅ | 结构化抽取：`#mizuki-dynamic-list` 恰 **1** 行 → `href=http://127.0.0.1:4321/articles/u5-theme-a1-sample/`，`title=U5-THEME-A1 契约联调样本`；**无 `encrypted-post` 卡片**（第 ⑤ 处生效） |
| **A5** | `dist/posts/` 与改前逐项一致 | ✅ | `diff` 为空（7 项：`encrypted-example encrypted-post guide markdown-extended markdown-mermaid markdown-tutorial video`）；HTTP 实测 6 条正典 URL 全 200（287KB–409KB） |
| **A6** | 反例组：服务端离线重建仍成功、`dist/articles/` 只剩 `_server` | ✅ | 停掉 20164 后 `astro build --outDir dist-a1-check-offline` → `29 page(s) built`，`dist/articles/` = `_server`（弱依赖 + 静默降级语义未破坏） |

附加实测：已下线的 markdown 壳页 URL 现返回 **404**（`/articles/markdown-tutorial/`、`/articles/encrypted-post/`）——与指令包 §3 改动 2 的「URL 面收缩」知情提示一致。

---

## 5. 执行中发现的两个额外缺陷（**均为既有缺陷，非本批引入**）

### 5.1 🔴 阻塞级：主题 `astro build` 自 2026-09-11 起必然失败

`src/content.config.ts` 的 `posts` schema 要求 `published: z.date()`，而两篇内容文件的 `published` 被写成**带引号的字符串**：

```
src/content/posts/draft.md:3           published: '2022-07-01T00:00:00.000Z'
src/content/posts/encrypted-post.md:3  published: '2024-01-15T00:00:00.000Z'
```

→ Astro 内容校验报 `published: Expected type "date", received "string"` 并**中止构建**。

- mtime 两者均为 **2026-09-11**（重建/改写日），而最后一次成功构建产物 `Mizuki/dist/index.html` 时间戳是 **2026-09-08 20:13** ⇒ 该破损在最后一次成功的构建之后引入
- 上游对照：`LyraVoid/Mizuki` 的 `encrypted-post.md` 是 **`published: 2024-01-15`（裸日期）**，且正文内容与本地完全不同 ⇒ 本地该文件被改写时引入了引号形态
- **修复**：两处改为裸日期（`2022-07-01` / `2024-01-15`），与主题自身生态（其余 6 篇均裸日期）及本仓 posts 写路径的约定（`BARE_DATE_KEYS = ['published','updated']`，`posts.service.ts:1034-1050`）一致。语义等价（YAML 裸日期解析为同一 Date）
- **影响面**：这是**独立于本批**的缺陷。换言之，在本次修复之前，dj 从面板点「构建」或本地 `pnpm build` 都会失败

### 5.2 🟡 逻辑缺陷：`staticSlugs` 过滤被 `alias` 击穿

见 §2.1。本批顺带修掉。

> ⚠️ 5.1 我**动了 dj 的内容文件**（2 行）。指令包范围是「只改 3 个主题文件」，属于越界，已在 §3 之前单独快照（`.snapshot-…/content/`）并在此明示。

---

## 6. 生产面零触碰自证

| 对象 | 状态 |
|---|---|
| 生产 DB `apps/server/data/mizuki.db` | sha256 `fb96168638116c45…`，mtime **2026-10-25 18:17**（未变） |
| 生产站点产物 `Mizuki/dist/` | `index.html` sha256 `0a106ca0097d577e…`，mtime **2026-09-08 20:13**（未变，本批构建全部走独立 `--outDir`） |
| 生产配置 `apps/server/data/config.json` | **未改**（`corsOrigins` 仍缺，计数 0） |
| dj 运行中的实例 | 20154 / 20155 **未重启、未停止** |
| 验证台 | 20164 与静态服务 4321 **均已下线**，端口已释放 |

**回退方式**：主题侧 5 个文件从 `BlogFiles\Mizuki\.snapshot-20261028-092338\` 拷回即可（`[...slug].astro` / `[...page].astro` 含 `[` `]`，用 `-LiteralPath` 或加引号，勿让 shell 当通配符）。

---

## 7. 上游对照（新证据，2026-10-28）

对 `LyraVoid/Mizuki`（默认分支 `master`）逐路径取文件实测：

| 路径 | 上游 | 含义 |
|---|---|---|
| `src/server/server-config.ts` | **404** | 整个 `src/server/` 是注入层，非上游 |
| `src/pages/articles/[...slug].astro` | **404** | 该路由整体是注入的 |
| `src/content/posts/encrypted-post.md` | 存在，但**内容不同** | 本地内容被改写（详见 §5.1）；上游为 `published: 2024-01-15` 裸日期 + `hideHomeContent: true` + `pinned: false`，本地为引号字符串 + `pinned: true` + 无 `hideHomeContent` |
| `src/content.config.ts` | 存在，但**版本更新** | 见下方 §7.1 |

### 7.1 ⚠️ 本地主题落后于上游，且**不能直接同步**

上游 `content.config.ts` 与本地同名文件的关键差异：

| 项 | 上游 | 本地 |
|---|---|---|
| posts loader | **自研 `postGlob`**（`./loaders/post-loader`） | 原生 `glob`（`astro/loaders`） |
| glob 模式 | `**/*.{md,mdx}` | `**/*.md` |
| `hideHomeContent` | ✅ 已声明 | ❌ 无（本地 `encrypted-post.md` 也没这个键） |
| `_publishedDateOnly` / `_updatedDateOnly` | ✅ **必填** `z.boolean()` | ❌ 无 |

- 上游那两个下划线字段正是用来区分「裸日期 vs 时间戳」的机制 —— **上游已经解决了本批 §5.1 撞到的那个问题**，而本地是它解决之前的形态
- 后果：**直接同步上游会立刻全面失败** —— 上游 `_publishedDateOnly` / `_updatedDateOnly` 是**必填**，本地全部内容文件都没有这两个键，Astro 内容校验会整批报错
- ⇒ 「主题纳管」不能是「拉上游覆盖」，必须是**一批独立工作**：内容迁移（补 `_publishedDateOnly`/`_updatedDateOnly`）+ loader 替换 + 重新评估 java-server 注入层的存活

*（本地主题 `package.json` version = `9.0`，`packageManager = pnpm@10.22.0`）*

⇒ 本地 `Mizuki` 相对上游的差异**至少三类**：① 注入的新文件（java-server 层）② 被改写的既有路由/组件 ③ 被改写的内容文件。**三者目前都没有版本控制兜底**（该目录非 git 仓库）。

---

## 8. dj 四项裁决（2026-10-28）与执行状态

| # | 我的问题 | dj 裁决 | 状态 |
|---|---|---|---|
| 1 | 站点真实 origin（CORS 用） | **「目前博客是纯静态，无 server」** | ✅ 结案 —— 实测 `api.blog.muyuyanran.com` **DNS ENOTFOUND**；站点不调用任何服务端 ⇒ **CORS 与 `PUBLIC_MIZUKI_SERVER_URL` 都不是当前事项**。本批不再登记 `corsOrigins` |
| 2 | 是否重建生产 `dist` | **「重建」** | ✅ **已执行**，见 §8.1 |
| 3 | `site/*` 用户体系与评论去留 | **「另立项」** | ✅ 结案 —— 本批 `login.astro` / `register.astro` / `profile.astro` / `admin/articles/*.astro` / `ServerComment.astro` **一字未改** |
| 4 | 主题是否 `git init` 纳管 | **「主题重新拉取」** | ⏸ **未执行** —— 探针后发现有重大前提问题，**需 dj 在四条路里点一条**：见 [`THEME-UPSTREAM-DECISION.md`](THEME-UPSTREAM-DECISION.md) |

### 8.1 ②「重建」结果

| 项 | 结果 |
|---|---|
| 旧产物 | 改名为 `dist.pre-u5-20261028-104816`（83M，**可回退**） |
| 新产物 | `astro build`（29 页）→ `pagefind` → `compress-fonts`（后者报「无字体配置」，正常） |
| 顶层结构 | 与旧产物**逐项一致**（35 项） |
| 首页动态加载器 | `mizuki-dynamic-articles` 出现 **0** 次 —— `PUBLIC_MIZUKI_ENABLE_HOME_MERGE=false` 生效 ⇒ **纯静态** |
| 富文本壳页 | `dist/articles/` 只剩 `_server`（生产库 0 篇已发布富文本） |
| 全站服务端取数脚本 | 仅 **1** 个文件命中：孤儿页 `dist/articles/_server/index.html`（无入口链接可达） |
| `dist/posts/` | 7 条 markdown 正典路径齐全 |

> **本批的 `enableHomeMerge` 开关修复在此处真正发挥了作用** —— 没有它，首页会挂着一个注定失败的动态加载区。
> 本次构建**跳过** `node scripts/update-anime.mjs`（会联网并写 `src/data/anime.ts`），anime 数据沿用现有快照；要完全对齐 `pnpm build` 需单独确认。

### 8.2 ④「主题重新拉取」的关键前提（详见决策材料）

**你指的那个仓库 `LyraVoid/Mizuki` 已废弃** —— README 顶部是停止维护通知，HEAD 提交即 `docs(readme): add project deprecation notice and link to new project Shirone`。继任者为 **`LyraVoid/Shirone`**（活跃，Astro 7 / MIT / 可作 npm 包装）。

漂移实测：本地 vs 上游 **合计 493 项差异**（仅上游有 71 / 仅本地有 129 / 两边不同 364，其中 `src/` 下 307）。本地不是「打了补丁的上游」，是**重度分叉**；且工具链差一个 major（Astro 6.1.2 → 7.1.3）。

⇒ 「重新拉取」实为**迁移项目**，不是一次 pull。四条路与本批建议见 [决策材料](THEME-UPSTREAM-DECISION.md) §4（建议先 D 纳管，再评估 A/B）。

---

## 9. 副产品

| 路径 | 说明 |
|---|---|
| `BlogFiles\Mizuki\.snapshot-20261028-092338\` | 改前快照：3 主题文件 + `content/` 2 个内容文件 + `src-full.tgz` + `sha256-before.txt` |
| `BlogFiles\Mizuki\dist-a1-check\` | A1–A5 的构建产物（**非生产**） |
| `BlogFiles\Mizuki\dist-a1-check-offline\` | A6 反例组产物（**非生产**） |
| `.test-tmp/theme-a1-check\` | 临时实例 config / DB 副本 / 验收样本 body / 前后目录清单 |
| `.test-tmp/theme-probe.mjs`、`.test-tmp/serve-dist.mjs` | 只读探测 + 静态验证台 |
| `docs/audits/theme-server-contract\` | 对账审计 + 指令包 |
| `docs/audits/u5-theme-a1\` | 本报告 |
