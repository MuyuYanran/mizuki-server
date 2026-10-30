# 阶段指令包 —— 主题侧 `[Mizuki-Server]` 接入层契约对齐（甲方案 · 只打通阅读链路）

> ✅ **本包已于 2026-10-28 执行完毕**，验收 A1–A6 全 PASS。
> 实际交付（含包外新增的第 5 处 hunk、两个执行中发现的既有缺陷）见交付报告
> [`../u5-theme-a1/README.md`](../u5-theme-a1/README.md)。
> 本文件保留为**执行前的原始设计**（含被否决的替代与未决项），勿据其现状改代码。
>
> ⚠️ 基线修正：本地 `BlogFiles\Mizuki` **不是上游原版**，而是上游
> `https://github.com/LyraVoid/Mizuki` + **mizuki-java-server** 注入层 + 内容被改写（2026-10-28 dj 补充，已上游实测证实）。

- 出台：2026-10-28
- 前置裁决（dj，2026-10-28）：「**线上跑的是本仓**，另一套因为丢失 git 历史已经归档了」
  → **本仓是契约正确方，需要改的是主题侧**。审计结论见同目录 [`README.md`](README.md)
- 批次代号：**U5-THEME-A1**（建议按此立 ADR-028）
- 交付物：主题目录 **3 个文件**（4 处编辑）+ 服务端 **1 处配置**（`config.json` 的 `corsOrigins`）
- **本仓零代码改动**（除上面那一条配置）；不碰 `apps/server/src/**`

---

## 0. 预算与纪律（执行方必读）

| 项 | 上限 |
|---|---|
| 总步数 | ≤ 14 |
| 报告行数 | ≤ 80 |
| 日志回贴 | 禁贴大段命令输出，只给结论 + 文件路径 |
| 测试 | 只跑 §6 验收；**不要**跑本仓 `pnpm test`（与本批无关） |
| 依赖变更 | **零**（不装任何新包） |
| 越界 | 只改 §3 列出的 3 个文件；**不改任何其他主题文件**；遇不确定立即停并报告 |

每个改动点改完立刻落盘，最后再统一验收。连续 2 步无盘上文件改动 → 停。

---

## 1. 前置条件（缺一不可；先全部确认再动手）

| # | 条件 | 确认方式 |
|---|---|---|
| P1 | 服务端在跑，且公开列表可读 | `curl -s "http://127.0.0.1:20154/api/v1/public/articles?page=1&limit=5"` → 200 + 顶层 `items` 数组 |
| P2 | 该响应里**至少有一条 `sourceType === "richtext"`** 的已发布文章 | 同上响应；没有就先去面板发一篇富文本并发布 |
| P3 | `apps/server/data/config.json` 已登记站点 origin（见 §4） | 读文件 |
| P4 | 主题目录**已打改动前快照**（见 §2） | §2 的产物存在 |
| P5 | 站点与服务端**不同源**（否则 §4 可跳过，但要确认反向代理） | 问 dj / 看部署 |

> P2 不满足时，A2/A3/A4 三项验收无法判定。**先造数据，别硬着头皮改。**

---

## 2. 第 0 步（不可跳过）：主题改动前快照

主题目录**不是 git 仓库**（`git rev-parse` → `fatal: not a git repository`），改动**没有回滚能力**。

```powershell
$theme = "<本机主题目录>"
$ts    = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak   = Join-Path $theme ".snapshot-$ts"
New-Item -ItemType Directory -Force $bak | Out-Null

# 注意：文件名含 [ ]，PowerShell 会当通配符 → 必须 -LiteralPath
Copy-Item -LiteralPath (Join-Path $theme "src\pages\articles\[...slug].astro")            $bak
Copy-Item -LiteralPath (Join-Path $theme "src\components\server\DynamicArticleLoader.astro") $bak
Copy-Item -LiteralPath (Join-Path $theme "src\pages\[...page].astro")                     $bak

# 全量兜底
Compress-Archive -Path (Join-Path $theme "src") -DestinationPath (Join-Path $bak "src-full.zip") -Force
```

回退方式 = 从 `.snapshot-<ts>\` 用 `-LiteralPath` 拷回。

---

## 3. 改动点（3 文件 / 4 处）

统一说明：本仓 mizuki-server 的公开面是

- **成功** = 裸业务对象（**无** `{code,message,data}` 信封）
- **失败** = `{ code: "<异常类名>", message, detail }`（HTTP 状态码照常）
- 列表 = 顶层 `items`，分页参数是 **`limit`**（默认 1/10，**>50 → 400**）
- 列表项字段 = `{id, slug, title, sourceType, cover, summary, category, pinned, pubDate}` —— **没有 `url` / `tags` / `coverImage` / `description`**；`category` 实为 `categoryId`
- 详情 = `{ slug, title, sourceType, frontmatter?, html }` —— **没有 `article` / `htmlContent` / `staticUrl`**；`sourceType ∈ { "markdown", "richtext" }`（小写）

**关键事实：阅读链路不经过 `src/server/server-client.ts` 的 `api()`。** 两处都是 `.astro` 里 `<script is:inline>` 的**裸 `fetch`**（inline 脚本无法 ESM import）。所以**不要**去改 `server-client.ts` 做信封归一 —— 对本批零收益（留给第二步 site 体系）。

---

### 改动 1 —— `src/components/server/DynamicArticleLoader.astro`

#### 1a. `renderCard()` 里的封面与链接（当前约 49-109 行）

**原**
```js
    const cover = item.coverImage ? resolveServerUrl(item.coverImage) : "";
```
**改**
```js
    // [契约归一 2026-10-28] 本仓列表项字段名是 cover（非 coverImage）
    const cover = item.cover ? resolveServerUrl(item.cover) : "";
```

**原**
```js
      '<a class="card-base flex flex-col md:flex-row w-full rounded-[var(--radius-large)] overflow-hidden relative transition group" href="' +
      escapeHtml(withTrailingSlash(item.url)) +
      '">' +
```
**改**
```js
      // [契约归一] 本仓列表项无 url 字段 → 由 slug 派生详情页地址（壳页命名空间 /articles/）
      '<a class="card-base flex flex-col md:flex-row w-full rounded-[var(--radius-large)] overflow-hidden relative transition group" href="' +
      escapeHtml(withTrailingSlash("/articles/" + encodeURIComponent(item.slug || ""))) +
      '">' +
```

**原**
```js
      escapeHtml(item.description || "") +
```
**改**
```js
      escapeHtml(item.summary || "") +
```

> `item.tags` 缺失时**无需改动**：既有 `Array.isArray(item.tags) && item.tags.length` 分支会自动落到「暂无标签」。
> `item.pubDate` 本仓返回 ISO 字符串，`formatDate()` 可直接用，无需改。

#### 1b. `loadDynamicArticles()` 取列表（当前约 122-134 行）

**原**
```js
      const res = await fetch(
        mizukiServerConfig.serverUrl + "/api/v1/public/articles?page=" + page + "&size=50"
      );
      const body = await res.json();
      if (body.code !== 0) {
        throw new Error(body.message || "加载失败");
      }
      const rawItems = body.data?.list || [];
```
**改**
```js
      // [契约归一] 参数 limit（非 size）；成功为裸体；列表在顶层 items；错误体 code 是异常类名
      const res = await fetch(
        mizukiServerConfig.serverUrl + "/api/v1/public/articles?page=" + page + "&limit=50"
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error((body && body.message) || "加载失败");
      }
      const rawItems = Array.isArray(body?.items) ? body.items : [];
```

> 后面 `hasMore = rawItems.length >= 50;` 与「暂无更多动态文章」分支**保持不变**（50 仍是本仓上限）。

---

### 改动 2 —— `src/pages/articles/[...slug].astro` 的 `getStaticPaths`（当前约 8-47 行）

**原**
```ts
export async function getStaticPaths() {
  const posts = await getSortedPosts();
  const slugs = new Set<string>();
  for (const post of posts) {
    slugs.add(removeFileExtension(post.id));
  }
  const paths = Array.from(slugs).map((slug) => ({ params: { slug } }));

  try {
    let serverPage = 1;
    while (serverPage <= 10) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(
        mizukiServerConfig.serverUrl + "/api/v1/public/articles?page=" + serverPage + "&size=100",
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      const body = await res.json();
      const list = body?.data?.list;
      if (body?.code !== 0 || !Array.isArray(list)) break;
      for (const item of list) {
        const slug = item?.slug;
        if (typeof slug === "string" && slug && !slugs.has(slug)) {
          slugs.add(slug);
          paths.push({ params: { slug } });
        }
      }
      if (list.length < 100) break;
      serverPage += 1;
    }
  } catch {
    // 后端不可用时仍以静态 Markdown 文章构建
  }
```

**改**
```ts
export async function getStaticPaths() {
  const posts = await getSortedPosts();
  // slugs 仅作去重集，**不再为 markdown 生成壳页**：
  // markdown 文章的正典页面是主题自己的 /posts/<slug>/，
  // 此前给它们生成的 /articles/<slug>/ 壳页必然渲染失败（实测「动态服务暂不可用」）。
  const slugs = new Set<string>();
  for (const post of posts) {
    slugs.add(removeFileExtension(post.id));
  }
  const paths: Array<{ params: { slug: string } }> = [];

  // [契约归一 2026-10-28] 本仓 mizuki-server：裸体响应、列表在顶层 items、
  // 分页参数 limit（上限 50）。**只为 richtext 生成壳页。**
  const SERVER_PAGE_SIZE = 50;
  try {
    let serverPage = 1;
    while (serverPage <= 10) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(
        mizukiServerConfig.serverUrl +
          "/api/v1/public/articles?page=" +
          serverPage +
          "&limit=" +
          SERVER_PAGE_SIZE,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!res.ok) break;
      const body = await res.json();
      const list = body?.items;
      if (!Array.isArray(list)) break;
      for (const item of list) {
        if (item?.sourceType !== "richtext") continue;
        const slug = item?.slug;
        if (typeof slug === "string" && slug && !slugs.has(slug)) {
          slugs.add(slug);
          paths.push({ params: { slug } });
        }
      }
      if (list.length < SERVER_PAGE_SIZE) break;
      serverPage += 1;
    }
  } catch {
    // 后端不可用时仍以静态 Markdown 文章构建
  }
```

> `if (paths.length === 0) { paths.push({ params: { slug: "_server" } }); }` **保持不动**（零富文本时保住路由）。

> ⚠️ **本改动会收缩 URL 面（请先知情）**：改后 `/articles/<markdown-slug>/` 不再生成，原有 6 个目录（`encrypted-post` `guide` `markdown-extended` `markdown-mermaid` `markdown-tutorial` `video`）会消失。
> 依据：① 这些页**当前就是坏的**（必显「动态服务暂不可用」）；② 主题内部所有文章链接都指向正典 `/posts/<slug>/`，从没有链接指向 `/articles/<md-slug>/`；③ `/posts/<slug>/` 不受影响（验收 A5 会核）。
> 若 dj 要求保留这些 URL，改用「保守变体」：`paths` 初始仍填 markdown slug，读取时对 `sourceType === "markdown"` 走改动 3 里的 `/posts/` 跳转分支。

---

### 改动 3 —— 同文件 inline `<script>` 的 `load()`（当前约 165-203 行）

**原**
```js
      const res = await fetch(
        mizukiServerConfig.serverUrl + "/api/v1/public/articles/" + slug
      );
      const body = await res.json();
      if (body.code !== 0 || !body.data?.article) {
        throw new Error(body.message || "文章不存在");
      }
      const article = body.data.article;
      if (article.sourceType === "STATIC_MARKDOWN" && body.data.staticUrl) {
        window.location.href = withTrailingSlash(body.data.staticUrl);
        return;
      }
      if (titleEl) titleEl.textContent = article.title || "";
      document.title = article.title || "动态文章";
      renderMeta(article);
      const cover = article.coverImage
        ? resolveServerUrl(article.coverImage)
        : "";
```

**改**
```js
      // [契约归一 2026-10-28] 本仓详情是裸体 { slug, title, sourceType, frontmatter?, html }；
      // 无 article / htmlContent / staticUrl；sourceType 取值为小写 markdown|richtext。
      const res = await fetch(
        mizukiServerConfig.serverUrl + "/api/v1/public/articles/" + slug
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error((err && err.message) || "文章不存在");
      }
      const article = await res.json();
      if (!article || typeof article !== "object") {
        throw new Error("文章不存在");
      }
      // 防御：文章在最近一次构建后被改回 markdown（壳页滞留）→ 送回正典静态页
      if (article.sourceType === "markdown") {
        window.location.replace(withTrailingSlash("/posts/" + encodeURIComponent(slug)));
        return;
      }
      if (titleEl) titleEl.textContent = article.title || "";
      document.title = article.title || "动态文章";
      renderMeta(article);
      // 本仓详情不返回封面字段 → 常规走「无封面」分支
      const cover = article.cover ? resolveServerUrl(article.cover) : "";
```

**原（同函数末行）**
```js
      container.innerHTML = body.data.htmlContent || "<p>该文章暂无可渲染内容</p>";
```
**改**
```js
      container.innerHTML = article.html || "<p>该文章暂无可渲染内容</p>";
```

> `withTrailingSlash` / `resolveServerUrl` / `escapeHtml` / `renderMeta` 都**保留**（前者仍被 markdown 防御分支使用，别删）。
> 加密文章：服务端对 `encrypted === true` 的 markdown 返回 `html: ''` → 落到「暂无可渲染内容」占位。**本批不处理**（主题自己的加密在静态页生效，正典路径是 `/posts/`）。

---

### 改动 4 —— `src/pages/[...page].astro`：给死开关 `enableHomeMerge` 补上消费点

现状：`enableHomeMerge` 在 `src/server/server-config.ts` 声明（默认 `true`）但**全主题零消费** → 设 `false` 关不掉首页合并。

**frontmatter（当前 1-14 行区）追加一行**
```ts
import { mizukiServerConfig } from "../server/server-config";
```

**模板（当前 34-36 行）**
```astro
	<!-- [Mizuki-Server] home-body begin -->
	<DynamicArticleLoader />
	<!-- [Mizuki-Server] home-body end -->
```
**改为**
```astro
	<!-- [Mizuki-Server] home-body begin -->
	{mizukiServerConfig.enableHomeMerge && <DynamicArticleLoader />}
	<!-- [Mizuki-Server] home-body end -->
```

> 行为无变化（默认 `true`），但从此该开关**真的能关**。

---

## 4. 服务端配置：登记 CORS 白名单（**必须先确认 P5**）

本仓 CORS 白名单 = `http://localhost:<MIZUKI_SERVER_PORT>` + `config.json` 的 `corsOrigins`（`apps/server/src/app.setup.ts:19-27`）。

**当前 `apps/server/data/config.json` 没有 `corsOrigins` 键 → 站点域名下浏览器跨源 fetch 会被拒**（表现为控制台 CORS 报错 + 页面显示「动态服务暂不可用」）。

`apps/server/data/config.json` 追加（origin 用**站点真实来源**，不要照抄示例）：
```json
{
  "jwtSecret": "…原值不动…",
  "mizukiRoot": "…原值不动…",
  "mode": "manage",
  "corsOrigins": [
    "https://blog.muyuyanran.com",
    "https://muyuyanran.top"
  ]
}
```

两条纪律：
1. **`origin` 不含路径、不含尾斜杠**（是 `https://host`，不是 `https://host/`）。
2. 该白名单在 `configureApp()` **启动时读一次** → **改完必须重启服务端**（不是每请求活取）。
3. 若站点与服务端**同源**（同一域名反代 `/api` 到 20154），跳过本步。
4. `config.json` 已 gitignore，此处改动**不入库**；请在报告里列出实际登记值，供部署 checklist 记录。

---

## 5. 构建与部署要点（做错这三条，改完也不生效）

1. **`PUBLIC_MIZUKI_SERVER_URL` 是构建期烘入的。** 它经 `<script is:inline define:vars={{ mizukiServerConfig }}>` 直接写进静态 HTML（现成 dist 里烘的是 `http://127.0.0.1:20154`）。
   → 必须设为**访客浏览器可达的地址**（例如 `https://api.blog.muyuyanran.com`）；**改 env 不重建 = 不生效**。
2. **构建时服务端必须在线。** `getStaticPaths` 靠它枚举富文本 slug；服务端不可用时异常被 `catch {}` **静默吞掉**，构建**照常成功但零富文本壳页** → 上线后全部 404，且没有任何报错提示。
   → 构建后必须走 §6 的 A2 断言。
3. `PUBLIC_MIZUKI_ADMIN_URL` 的代码默认值含占位符 `https://<机器名>.<tailnet>.ts.net`。本批不消费它（除非 `profile.astro`），但建议构建时一并显式设置，避免站点上出现脏地址。

---

## 6. 验收标准（机械可判定，逐条给结论）

| # | 判据 | 判定方式 |
|---|---|---|
| **A1** | `dist/articles/` 下**不再有** markdown slug 目录 | 原 6 个：`encrypted-post` `guide` `markdown-extended` `markdown-mermaid` `markdown-tutorial` `video` → 改后应全部消失 |
| **A2** | 每个**已发布 richtext** slug 都有 `dist/articles/<slug>/index.html` | 取 P1 接口 `items` 里 `sourceType === "richtext"` 的 slug 列表，逐个 `Test-Path`；**数量必须一致** |
| **A3** | 浏览器打开 `/articles/<richtext-slug>/`：标题为文章标题、正文渲染出来、页面**无**「动态服务暂不可用」、控制台**无** CORS 报错 | 浏览器手验 |
| **A4** | 浏览器打开首页：静态 markdown 卡片之后出现富文本卡片；卡片链接形如 `/articles/<slug>/`；点进去命中 A3 | 浏览器手验 |
| **A5** | `dist/posts/` 内容与改前**逐项一致**（markdown 正典路径未受影响） | 改前先 `ls dist/posts` 存一份对照 |
| **A6** | 反例组：服务端**停掉**后重新 `astro build` → 构建**成功**、`dist/articles/` 只剩 `_server`（或为空） | 验证「弱依赖 + 静默降级」语义未被破坏 |

**三连口径**：本批不触发本仓 `test/build/lint`（本仓零代码改动，仅 `config.json` 非入库配置）。A1–A6 全部通过 + 改前快照在位于 = 本批交付。

---

## 7. 已否决的替代（勿在实施中回退到这些）

| 替代 | 否决理由 |
|---|---|
| 服务端加兼容层（加 `code/data` 信封拦截器 + `/api/v1/auth/*` 别名） | 解决不了 `site/*` 用户体系与评论（那是新建子系统）；让同一 `code` 字段在本仓同时承载「异常类名」与「数字码」两种语义；与 P8 已冻结的公开 API 口径相抵；长期负债 |
| 改 `src/server/server-client.ts` 做信封归一 | 阅读链路**不经过** `api()`（两处都是 inline 裸 `fetch`）→ 本批零收益。留给第二步 site 体系 |
| 保留 markdown 壳页并渲染服务端 HTML | 同一文章出现 `/posts/<slug>/` 与 `/articles/<slug>/` 双 URL；壳页带 `data-pagefind-body` → pagefind 二次索引；且主题自己的加密/评论逻辑在这些壳页上不生效 |
| 在服务端给公开列表补 `url` / `tags` / `coverImage` 字段 | 公开 API 已冻结（P8 后路径与响应形状不再变更）；主题侧只消费 4 个字段，改主题侧成本更低 |

---

## 8. 未决项（**交 dj 裁决，不要自行决定**）

1. **`site/*` 用户体系与评论**（`/site/auth/*` 注册登录、`/public/comments`、`/site/comments`、博客端 `/admin/articles/*` 编辑器）：**永久砍掉**，还是**另立项新建子系统**？
   —— 建议砍掉：本仓 ADR-016 已裁定评论休眠；博客端编辑器与本仓面板 `/posts` `/articles` 功能重复。
   本批只做阅读链路，**这两个页面文件一个字都不改**（`login.astro` / `register.astro` / `profile.astro` / `admin/articles/*.astro` / `ServerComment.astro` 保持现状）。
2. **主题目录纳管**：`Mizuki` 目录不是 git 仓库 → 是否 `git init` 并首次提交？本批只做离线快照（§2）。
3. **站点 origin 的准确清单**（§4 用）—— 需 dj 给真实域名/端口，不得猜。

---

## 9. 报告格式（执行方回执）

```
# U5-THEME-A1 回执
- P1–P5 前置确认：逐条 PASS/FAIL（含实际 origin 值与 richtext 条数）
- 改动：3 文件 4 处，逐处给「改后行号区间 + 一行说明」
- A1–A6：逐条 PASS/FAIL + 一行证据（路径或截图文件名）
- 快照路径：
- 未决/异常：
- 已知残留：分类显示为 categoryId；加密 markdown 壳页占位（本批不处理）
```