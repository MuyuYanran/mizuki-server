# 主题侧 `[Mizuki-Server]` 接入层 — 与本仓 API 契约对账

- 日期：2026-10-28
- 类型：只读审计（**零代码改动**，未触碰任何仓内文件）
- 侦查对象：① 主题目录 `<本机主题目录>`（本机 Mizuki 主题实例，**非 git 仓库**）；② 本仓 `apps/server/**`
- 触发：dj 问「富文本文章是怎么被 mizuki 解读的，依赖 mizuki-server 吗」

---

## 0. 一句话结论

**主题里那套 `[Mizuki-Server]` 接入层不是为本仓写的。** 它是为**前身 Python `app.py` 版服务端**写的（落盘 2026-08-09/10，早于本仓 `-recovery-20260911`），本仓的 TypeScript/NestJS 重写版从未与它对过账。

三层同时不符 —— **响应信封 / 认证与用户体系 / 端点与字段名**。净结果：

> **富文本文章在站点上目前完全不可读**：静态外壳页 URL 404，即便有壳也填不进内容；首页列表也合并不出来。

> **dj 裁决（2026-10-28）**：「**线上跑的是本仓**，另一套因为丢失 git 历史已经归档了」
> → **本仓是契约正确方，需要改的是主题侧**。修法**甲**已出指令包：
> [`FIX-PACK.md`](FIX-PACK.md)（批次代号 **U5-THEME-A1**，建议立 ADR-028）。
> 本文档保留为决策前的原始对账记录，结论与证据**不随修法实施而改动**。

---

## 1. 机制复核（回答「怎么被解读的」）

Mizuki 是纯静态 Astro 站点（`dist/_astro/server-client.HQqHTLsf.js` 内 `SSR:!1`、`MODE:"production"`）。富文本正文只存在于 `mizuki.db`（`article` 索引行 + `article_content.doc_json` → sanitize 后 `html_cache`），`src/content/` 里没有任何对应物。所以构建期 Astro 无物可渲，整套是**「静态壳 + 访客浏览器运行时填充」**。

| 环节 | 文件 | 机制 |
|---|---|---|
| 生成外壳页 | `src/pages/articles/[...slug].astro:8-47` | `getStaticPaths` 先收静态 markdown slug，再**构建期**拉 `/public/articles` 把服务端 slug 补进去；服务端不可用时 `catch {}` 静默降级 |
| 渲染详情 | 同文件 `:165-202` | 浏览器 `fetch(.../public/articles/<slug>)` → `container.innerHTML = body.data.htmlContent` |
| 合并首页 | `src/components/server/DynamicArticleLoader.astro`（挂在 `src/pages/[...page].astro:35`） | 分页拉列表，滤掉 DOM 里已有的静态 slug，`insertAdjacentHTML` 追加卡片 |
| 全局客户端 | `src/server/client-runtime.ts` + `src/layouts/MainGridLayout.astro:296` | 装 `window.mizukiServerClient`（api / 4 个 token 存取 / swup 脚本重放） |

**两层依赖强度不同**：

| 阶段 | 依赖 | 断了会怎样 |
|---|---|---|
| `astro build` | **弱**（≤10 页、每页 3s 超时，异常被吞） | 照常构建，只是富文本无外壳页 → URL 404 |
| 访客浏览器 | **强** | 外壳页显示「动态服务暂不可用」；首页只剩静态 markdown |

---

## 2. 主题侧接入层清单（**17** 文件，全部 `[Mizuki-Server]` 标记）

清点命令：`grep -rl "Mizuki-Server" src --include=*.astro --include=*.ts` → 17 条。

| mtime | 文件 | 职责 |
|---|---|---|
| 08-09 21:59 | `src/components/server/MarkdownEditor.astro` | 博客端 markdown 编辑器（textarea + marked 预览，**无任何服务端调用**） |
| 08-09 22:00 | `src/components/server/ServerComment.astro` | 服务端评论组件（读 `/public/comments`、写 `/site/comments`） |
| 08-09 22:21 | `src/components/server/RichTextEditor.astro` | 博客端 TipTap 富文本编辑器 + 图片直传 `/admin/articles/rich-text-image` |
| 08-09 23:08 | `src/server/server-config.ts` | 6 个配置项（`import.meta.env` 读） |
| 08-10 00:02 | `src/components/server/DynamicArticleLoader.astro` | 首页动态文章合并 |
| 08-10 00:54 | `src/server/server-client.ts` | `api()` 封装（信封/令牌/401 刷新） |
| 08-10 00:59 | `src/server/client-runtime.ts` | `window.mizukiServerClient` + swup 脚本重放 |
| — | `src/layouts/MainGridLayout.astro:296` | 全局装载 client runtime |
| — | `src/pages/[...page].astro:35` | 挂 `DynamicArticleLoader` |
| — | `src/pages/articles/[...slug].astro` | 详情外壳 + 运行时填充 |
| — | `src/pages/login.astro` | 管理员/访客双模登录（含 `code===40000` 自动回退） |
| — | `src/pages/register.astro` | 访客注册 |
| — | `src/pages/profile.astro` | 个人中心（读写两侧 me/logout、投稿入口） |
| — | `src/pages/admin/articles/new.astro` | 博客端发文（markdown / 富文本二选一） |
| — | `src/pages/admin/articles/edit.astro` | 博客端改文（含 `?id=` / `?path=` 双模式） |
| — | `src/components/comment/index.astro` | 评论组件切换（ServerComment ↔ Twikoo/Giscus） |
| — | `src/components/organisms/navigation/Navbar.astro:120-123` | 导航侧只加了两个链接：`/login/`、`/profile/` |

> 目录本身 `src/components/server/` 与 `src/server/` 的 mtime 分别是 08-09 21:50 / 08-10 00:28，是目录项而非文件，勿混入。

---

## 3. 第一层差异：响应信封

**主题要求**（`src/server/server-client.ts`）：

```ts
// :85  刷新成功判据
if (!body || body.code !== 0 || !body.data) return false;
// :122 401 判据（数字码）
const isUnauthorized = (body && body.code === 40100) || response.status === 401;
// :141-153 成功判据 + 取业务体
if (!body || body.code !== 0) { /* ...40100/40300/42300 → 抛错... */ }
return body.data as T;
```

即：`{ code: <number>, message: <string>, data: <业务体> }`，`0` = 成功，`40100/40300/42300` 有专门文案分支。

**本仓实际**：

- 成功 = **裸业务对象**，无信封（`test/p8-articles-public.e2e-spec.ts:138` 断言 `page1.body.items.length`；`:352-363` 断言 `md.body.sourceType === 'markdown'`）；
- 失败 = `{ code: '<HttpException 类名>', message, detail }`（`src/common/filters/all-exceptions.filter.ts:33`）；
- 无信封拦截器：`app.module.ts:81` 只注册 `APP_INTERCEPTOR = OperationLogInterceptor`（写审计表，不动响应体）。

**判定：致命。** 同一个 `code` 字段两种语义（数字码 vs 异常类名字符串），结构上不可能同时满足。主题侧 `api()` 对任何本仓成功响应都会落到 `body.code !== 0` 分支 → 抛 `请求失败`。

---

## 4. 第二层差异：认证与用户体系

| | 主题侧 | 本仓 |
|---|---|---|
| 管理员令牌头 | `Authorization: Bearer`（`server-client.ts:109`） | ✅ 同 |
| 访客令牌头 | `X-Site-Token`（`server-client.ts:107`） | ❌ 无此机制 |
| 管理员路由 | `/api/v1/auth/*` | `/api/v1/admin/auth/*` |
| 访客路由 | `/api/v1/site/auth/*` | ❌ 整个前缀不存在 |
| 站点用户表 | 假定存在（注册/登录/资料） | ❌ 无 |
| 评论 | `/public/comments`、`/site/comments` | ❌ 无（`comment` 表**休眠**，ADR-016） |
| 令牌存储 | `sessionStorage`（`mizuki_site_token` / `mizuki_admin_token`） | — |

**判定：`site/*` 不是「路径改一改」，是缺一整个子系统**（用户表 + 注册 + 会话 + 评论读写 + 权限）。

---

## 5. 第三层差异：端点与字段逐条对照（20 处调用）

### 5.1 认证类

| # | 主题调用 | 本仓实际 | 差异 |
|---|---|---|---|
| 1 | `POST /api/v1/auth/login` | `POST /api/v1/admin/auth/login` | 路径 |
| 2 | `POST /api/v1/auth/refresh` | `POST /api/v1/admin/auth/refresh` | 路径 |
| 3 | `GET /api/v1/auth/me` | `GET /api/v1/admin/auth/me` | 路径 |
| 4 | `POST /api/v1/auth/logout` | `POST /api/v1/admin/auth/logout` | 路径 |
| 5 | `POST /api/v1/site/auth/login` | — | 缺失 |
| 6 | `POST /api/v1/site/auth/refresh` | — | 缺失 |
| 7 | `GET /api/v1/site/auth/me` | — | 缺失 |
| 8 | `POST /api/v1/site/auth/logout` | — | 缺失 |
| 9 | `POST /api/v1/site/auth/register` | — | 缺失 |

> 主题还依赖 `code === 40000` 做「管理员↔访客」自动回退（`login.astro:75`）——本仓无此码。

### 5.2 文章阅读（**dj 最关心的链路**）

| # | 主题调用 | 本仓实际 | 差异 |
|---|---|---|---|
| 10 | `GET /public/articles?page=&**size**=` | `GET /public/articles?page=&**limit**=`（默认 1/10，>50 → 400） | 参数名；`size` 被忽略 → 永远回落 10 条/页 |
| 11 | 读 `body.data.list[].{slug,url,title,description,coverImage,pubDate,category,tags}` | 裸 `body.items[].{id,slug,title,sourceType,cover,summary,category,pinned,pubDate}` | 信封 + **无 `url`、无 `tags`**；`coverImage`→`cover`、`description`→`summary`、`category` 实为 `categoryId` |
| 12 | `GET /public/articles/:slug` → `body.data.{article, htmlContent}` | 裸 `{slug,title,sourceType,frontmatter?,html}` | 信封 + 字段名 `htmlContent`→`html` |
| 13 | 判 `article.sourceType === "STATIC_MARKDOWN"` 后跳 `body.data.staticUrl` | `sourceType` 取值为 `'markdown'` / `'richtext'`（小写），**无 `staticUrl`** | 判据字符串不符 → 跳静态页那条路永不触发 |

服务端真实实现：`src/modules/articles/articles.service.ts:300-333`（`publicList`）、`:336-381`（`publicDetail`）。

### 5.3 博客端写文章（可选链路）

| # | 主题调用 | 本仓实际 | 差异 |
|---|---|---|---|
| 14 | `GET  /admin/articles/:id` | ✅ 存在，返回 `{id,slug,title,…,docJson,htmlCache}` | 主题只读 `meta.title` —— 勉强兼容 |
| 15 | `GET  /admin/articles/:id/content` | — | 缺失（本仓 `:id` 已含 `htmlCache`） |
| 16 | `PATCH` 才是本仓的改文动作 | 主题用 `PUT /admin/articles/:id` | 方法不符 |
| 17 | `POST /admin/articles/rich-text` body `{slug,title,format:"HTML",htmlContent,jsonContent}` | `POST /admin/articles` body `{title, docJson, slug?, status?, …}`（`CreateArticleBodySchema`） | 路径 + body 契约全不符（本仓**不接收**受限 HTML 输入，`docJson` 是唯一信任源） |
| 18 | `POST /admin/articles/rich-text-image`（multipart，字段 `file`），响应要 `body.data.url` | — ；等价能力是 `POST /admin/media`（上传五件套 + 随机名 + sharp 重编码） | 缺失 + 响应形状不符 |
| 19 | `POST /admin/file-articles` body `{slug,title,content}` | `POST /admin/posts` | 路径不符（本仓把 markdown 叫 posts，不叫 file-articles） |
| 20 | `GET/PUT /admin/file-articles/content?path=` | `GET/PATCH /admin/posts/:slug` | 路径 + 方法不符（本仓按 slug 定位，不按磁盘 path —— 刻意的路径监狱设计） |

### 5.4 评论

| # | 主题调用 | 本仓实际 |
|---|---|---|
| 21 | `GET /api/v1/public/comments?articleSlug=` | — 缺失 |
| 22 | `POST /api/v1/site/comments` | — 缺失 |

---

## 6. 运行期后果（按功能分组）

| 功能 | 牵连文件 | 现状 |
|---|---|---|
| 富文本文章可读 | `[...slug].astro`、`DynamicArticleLoader.astro` | **全断**（403/404 + 「动态服务暂不可用」） |
| 首页两类文章合并 | `DynamicArticleLoader.astro` | **全断** |
| 站内账号（登录/注册/资料） | `login/register/profile.astro` | **全断**（路由不存在） |
| 博客端发/改文章 | `admin/articles/*.astro`、`RichTextEditor` | **全断** |
| 服务端评论 | `ServerComment.astro`、`comment/index.astro` | **全断**；且本仓已裁定评论**休眠**（ADR-016），方向本身相反 |

---

## 7. 附带发现：两个开关是死的

`src/server/server-config.ts` 声明 4 个开关，全主题消费情况：

| 开关 | 消费点 | 状态 |
|---|---|---|
| `enableServerComments` | `components/comment/index.astro:36,44` | ✅ 生效 |
| `enableSubmissions` | `pages/profile.astro:36,47` | ✅ 生效 |
| **`enableHomeMerge`** | — | ❌ **声明后零消费** → 设 `false` 也关不掉首页合并 |
| **`enableBlogEditors`** | — | ❌ **声明后零消费**（只有 `admin/articles/*` 页面本身，没有入口开关判断） |

---

## 8. 根因

### 8.0 修正（2026-10-28：dj 补充 + 上游实测）

> dj：「现在文件目录的 mizuki 不是原版 mizuki，是被 **mizuki-java-server** 修改后的，原仓库在 https://github.com/LyraVoid/Mizuki」

对上游 `LyraVoid/Mizuki`（默认分支 `master`）逐路径实测，证实该表述：

| 路径 | 上游 | 含义 |
|---|---|---|
| `src/server/server-config.ts` | **404** | 整个 `src/server/` 是注入层，非上游 |
| `src/pages/articles/[...slug].astro` | **404** | 该路由整体是注入的 |
| `src/content/posts/encrypted-post.md` | 存在但**内容不同** | 内容被改写（详见 [`../u5-theme-a1/README.md`](../u5-theme-a1/README.md) §5.1） |

⇒ 主题侧那套契约来自 **mizuki-java-server**（Java 风格特征吻合：`{code,message,data}` **数字**信封、`/api/v1/site/*` 站内用户体系、`/api/v1/admin/file-articles` 按**磁盘 path** 定位）。

**因此：本地 `BlogFiles\Mizuki` = 上游 `LyraVoid/Mizuki` + mizuki-java-server 注入层 + 内容被改写。**

> ⚠️ **本文件 §8 最初写的「主题接入层是为前身 Python `app.py` 版写的」是错的。**
> `app.py` 是**更早的**另一个 Python 管理器（与本主题接入层无关）。下表作为「仓内还记着别的历史前身」的旁证保留，**不作为本批根因**：

| 出处 | 原文（节选） |
|---|---|
| `docs/REQUIREMENTS.md:38` | 「不引入 Java、Python 等第二运行时；原 Python 管理器 **app.py** 仅作为功能行为参考，不作为运行依赖」 |
| `docs/REQUIREMENTS.md:154` | 「禁止括号计数 / 正则 / JSON5 文本 hack（旧 **app.py** 方案已废弃）」 |
| `docs/REQUIREMENTS.md:465/467` | 附录 A.7 / A.9 —— app.py 方案与 Python 长期依赖**均标记废弃** |
| `docs/MASTER-PLAN.md:247,281` | 「**app.py** 用括号平衡 + JSON5 做文本 hack，本引擎用 AST」 |
| `docs/prompts/P3-data-files-engine.md:11` | 「旧 Python 管理器 **app.py** …」 |

主题侧那套 `code/data` 数字信封、`/api/v1/site/*`、`file-articles`（按磁盘 path 定位）命名风格，与 Flask 式老服务端一致；本仓则按自身规格重新设计了信封（异常类名 code）、路径（`admin/posts` 按 slug）、以及 API 面。

**⚠️ 无法从本仓判断的一点**：若本机/线上 `api.blog.muyuyanran.com` 跑的是**另一套**实现（例如仍是 app.py 版），那主题这套契约就是对的，断的只是本仓这个 NestJS 版 —— 这需要 dj 确认。

---

## 9. 两条修法

### 甲、改主题侧适配本仓 ——「阅读链路」最小切口

**只改 3 个文件，且只碰阅读链路**：

1. `src/server/server-client.ts` —— 加一层**响应归一**（`unwrap()`）：本仓成功响应裸体时补 envelope 为 `{code:0, data:body}`；失败体 `code` 是字符串时按 `response.status` 映射到 `401/403/423` 分支。
2. `src/components/server/DynamicArticleLoader.astro` —— `body.data?.list` 改读 `items`；字段名 `coverImage`→`cover`、`description`→`summary`、`tags` 缺失时降级为「暂无标签」、`url` 缺失时用 `serverUrl + "/articles/" + slug + "/"` 拼；`?size=` → `?limit=50`。
3. `src/pages/articles/[...slug].astro` —— `body.data.article`/`htmlContent` → 裸体 `body`/`html`；`build-time` 探测里 `size=` → `limit=`；`sourceType === "STATIC_MARKDOWN"` 判据改为「`sourceType === 'markdown'` 且当前壳页无静态来源」或直接删除该分支。

- ✅ 改动面小、可只做阅读链路、不碰本仓任何红线（本仓零 diff）
- ✅ 立即恢复 dj 最在意的「富文本能读 + 首页能合并」
- ❌ 主题侧不在本仓 CI/测试覆盖内，改完没有测试网，只能浏览器手验
- ❌ 本仓的路由/字段若再变，主题侧还要再跟一次（无契约约束）
- ❌ **不解决** `site/*` 用户体系、评论、博客端编辑器

### 乙、服务端加兼容层

- 别名路由：`/api/v1/auth/*` 内部转发到 `admin/auth/*`（4 条，additive）
- 响应信封拦截器：仅对白名单路径生效，把裸体包成 `{code:0,message:'',data}`
- ❌ 与本仓已冻结的公开 API 口径冲突（P8 后 `/public/**` 路径与响应形状不再变更）—— 新增别名属 additive，**可以**，但会让同一个 `code` 字段在本仓同时承载「异常类名」与「数字码」两种语义
- ❌ `site/*` + 评论仍无法靠兼容层解决（本仓无站点用户表、评论休眠）→ 必须**新建子系统**，那是独立批次
- ❌ 会让本仓从此背上「兼容死亡契约」的长期负债

### 推荐路线：分两步，**刻意回避 site 用户体系**

**第一步（本轮该做的，小且可验收）**：走**甲**的 3 个文件 —— 只打通阅读链路。
同时把 `PUBLIC_MIZUKI_ENABLE_SERVER_COMMENTS` 与博客端编辑器**明确关掉**（前者本仓无此能力，后者与本仓面板功能重叠），`enableHomeMerge` 保留但需**先在主题侧补消费点**（当前是死开关）。

**第二步（另立项立 ADR）**：评论区 + 站内用户（登录/注册/资料）—— 要么永久砍掉，要么在服务端新立「站点用户」子系统。**默认建议砍掉**：本仓 ADR-016 已裁定评论休眠，博客端编辑器与本仓 `/posts` `/articles` 面板重复。

> 无论走哪条，**先决条件是 dj 确认**：线上 `api.blog.muyuyanran.com` 到底跑的是本仓还是别的东西。这决定「主题侧的契约是对的还是错的」。
> → **已于 2026-10-28 确认：线上是本仓** ⇒ 走甲。指令包见 [`FIX-PACK.md`](FIX-PACK.md)。

---

## 10. 需要 dj 定的三件事

| # | 问题 | 状态 |
|---|---|---|
| 1 | 本机/线上跑的是本仓，还是另一套？ | ✅ **已裁决 2026-10-28：本仓**（另一套因丢失 git 历史已归档） |
| 2 | `site/*` 用户体系与评论：永久砍掉，还是另立项新建？ | ⏳ 待定（默认建议砍掉） |
| 3 | 主题侧改动要不要纳入版本管理？（`Mizuki` 不是 git 仓库） | ⏳ 待定（指令包先做离线快照兜底） |

---

## 附：证据文件清单

**主题侧（只读）**
- `src/server/server-client.ts`（信封 / 令牌 / 401 刷新）
- `src/server/server-config.ts`（6 配置项）
- `src/server/client-runtime.ts`（`window.mizukiServerClient` / swup 重放）
- `src/components/server/DynamicArticleLoader.astro`
- `src/components/server/ServerComment.astro`
- `src/components/server/RichTextEditor.astro`
- `src/pages/articles/[...slug].astro`
- `src/pages/[...page].astro`
- `src/pages/login.astro` / `register.astro` / `profile.astro`
- `src/pages/admin/articles/new.astro` / `edit.astro`
- `src/components/comment/index.astro`
- `dist/articles/*/index.html`（构建期烘入的 `mizukiServerConfig` 实参）

**本仓**
- `apps/server/src/common/filters/all-exceptions.filter.ts:33`
- `apps/server/src/app.module.ts:81`
- `apps/server/src/app.setup.ts:45`
- `apps/server/src/modules/articles/articles.service.ts:52-63, 66-70, 300-333, 336-381`
- `apps/server/src/modules/articles/articles.controller.ts:88-108`
- `apps/server/src/modules/auth/auth.controller.ts:34-92`
- `apps/server/test/p8-articles-public.e2e-spec.ts:136-166, 349-364`
- 全路由清单：`grep -rn '@Controller(' apps/server/src --include=*.controller.ts`

**根因佐证**
- `docs/REQUIREMENTS.md:38, 154, 425, 465, 467`
- `docs/MASTER-PLAN.md:247, 281`
- `docs/prompts/P3-data-files-engine.md:11, 178`