# 任务：富文本文章与公开 API（阶段 P8）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P8**，前置依赖阶段：**P7（媒体 + 相册）**。

本会话范围一句话：**实现 articles 模块（富文本存储 + 统一索引 + 订阅 `post.changed` 增量更新）、settings 模块（key-value 站点设置），落地混合列表分页的公开 API（markdown+richtext 按 pub_date 降序）与公开缓存（订阅 `article.published`），并完成 articles 对媒体引用注册表的注册**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。本阶段是人工关卡（**公开 API 路径定型，此后不再变更**——面板与博客前端依赖它）。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：**§2 决策 2/3**（article 统一索引、混合列表策略）、§3（article/article_content/site_setting 表）、§5「Articles」「公开 API」清单（逐字）、§4.4 事件表 `post.changed` 与 `article.published` 行（订阅方：articles 索引 / 公开缓存）与同步通道表（articles 注册）、§7 XSS 条款、§9 守则 8（公开 API 路径定型）
2. `docs/REQUIREMENTS.md`：§4 文章体系（4.1–4.5）、§5（Mizuki 设置接管范围）、§7 第 3/4/6 条（文章管理/富文本编辑器/设置管理）、§9 第 6/7 条（XSS/SSRF）、§11、§15 第 14 条
3. `CHANGELOG.md`：P7 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/modules/articles/articles.module.ts`、`articles.controller.ts`、`articles.service.ts`（[P8]）
   - `apps/server/src/modules/settings/settings.module.ts`、`settings.controller.ts`、`settings.service.ts`（[P8]）
7. 已实现的前置件：`infra/db`（article/article_content/site_setting 表）、P5 posts（post.changed 发射方、`common/markdown/`）、P7 `MediaReferenceRegistry` 与 `MediaReferenceContributor` 接口、P1 全局限流

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/modules/articles/articles.module.ts`（[P8]）
- `apps/server/src/modules/articles/articles.controller.ts`（[P8]）
- `apps/server/src/modules/articles/articles.service.ts`（[P8]）
- `apps/server/src/modules/settings/settings.module.ts`（[P8]）
- `apps/server/src/modules/settings/settings.controller.ts`（[P8]）
- `apps/server/src/modules/settings/settings.service.ts`（[P8]）

**本阶段允许新建的文件（仅限以下）**：

- `apps/server/src/common/render/` — 渲染工具（marked 渲染 + sanitize-html 过滤的统一出口，公开 HTML 一律经它；Markdown 渲染 HTML 同样过 sanitize-html）
- `apps/server/src/modules/articles/media-reference.ts` — articles 的媒体引用贡献者（注册 `article.cover`）
- `apps/server/src/modules/collections/public-collections.controller.ts` — 公开集合只读路由（`GET /public/collections/:type`，`:type` 白名单校验同 P4，读取经 `DataFileService` value-cache，`@Public`）
- `apps/server/src/modules/albums/public-albums.controller.ts` — 公开相册只读路由（`GET /public/albums`，返回相册元信息 + 图片文件名列表，`@Public`）
- `apps/server/test/` 下本阶段测试文件

**本阶段允许修改的既有实现文件（仅限以下——为公开路由归位各领域模块）**：

- `apps/server/src/modules/collections/collections.module.ts`（controllers 追加 `PublicCollectionsController`）
- `apps/server/src/modules/albums/albums.module.ts`（controllers 追加 `PublicAlbumsController`）

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`modules/process/*`（P9）。（common/guards 等跨切面已在 P6 完成；infra/modules 其余均已实现。）

## 3. 详细规格

### 3.1 article 表与双源设计（MASTER-PLAN §2 决策 2 + §3）

- `article` 是**统一索引**：`source_type/file_path/file_hash` 设计——markdown 文章记录 `file_path`（相对 Mizuki 根）+ `file_hash`（sha256，同步扫描用）；richtext 文章以 `article_content` 表为主存储。
- `article_content`：`article_id` PK+FK（ON DELETE CASCADE）、`doc_json`（TipTap 文档 JSON，**信任源**）、`html_cache`（**sanitize 后的 HTML 缓存**）、`updated_at`。

### 3.2 富文本 CRUD（MASTER-PLAN §5 逐字，全部需认证）

| 方法 | 路径 |
|---|---|
| GET | `/admin/articles` |
| POST | `/admin/articles` |
| GET | `/admin/articles/:id` |
| PATCH | `/admin/articles/:id` |
| DELETE | `/admin/articles/:id` |

行为规则：

- POST/PATCH 收 `doc_json`（TipTap JSON）→ zod 校验为合法 JSON 结构（对象且含 `type` 字段，深层结构按“信任源”不再过度约束——取舍记报告）；
- 保存时服务端由 `doc_json` 生成 `html_cache`（经 sanitize-html）；
- `status ∈ draft/published`、`pub_date`、`pinned`、`category_id`、`cover`、`summary`、`slug`（richtext 的 slug 由 title 生成或服务端指定，唯一性约束冲突 → 409）；
- DELETE：软删（`deleted_at`），对齐回收站语义。
- **事件发射（发射方，§4.4 逐字）**：发布动作（创建/修改使 `status` 变为 `'published'`）在入库成功出口发射 `EVENTS.ArticlePublished`，payload `{ id, slug, sourceType: 'richtext', title }`（发射前 `ArticlePublishedPayload.parse`；恰好一次、失败不发；禁止字符串字面量）。与 P5 的 markdown 侧发射共同覆盖该事件的全部发射方。

### 3.3 订阅 `post.changed` 做索引增量更新（事件订阅方，MASTER-PLAN §4.4 逐字）

- `ArticlesService` 注册订阅者监听 `EVENTS.PostChanged`（禁止字符串字面量）：
  - `deleted: false` → 按 `slug` 对 `source_type='markdown'` 行执行 **upsert**（title/category/cover/summary/pinned/pub_date/status/file_path/file_hash）；
  - `deleted: true` → 该行置 `deleted_at`（软删）。
- 订阅者纪律：**幂等**（重复投递结果一致）；**异常内部捕获并记日志（pino），绝不冒泡到发起请求**。
- 与 P5 的 `POST /admin/posts/sync` 互补：sync 是全量重建，本订阅是增量维护。

### 3.4 混合列表公开端点（核心验收点）

`GET /public/articles`——**markdown+richtext 按 `pub_date` 降序聚合分页**：

- 数据源：`article` 表统一索引（`status='published'` 且 `deleted_at IS NULL`），两来源交错；
- 分页：`?page=&limit=`（默认 `page=1, limit=10`；limit 上限 50，超限 400），响应含 `{ items, total, page, limit }`；
- 列表项字段：`id, slug, title, sourceType, cover, summary, category, pinned, pubDate`；
- 详情 `GET /public/articles/:slug`：markdown 返回渲染后 **sanitized HTML**（marked + sanitize-html）+ frontmatter；richtext 返回 `html_cache`（已是安全 HTML）。
- **首屏静态、后续分页 API**（MASTER-PLAN §2 决策 3）：本端点服务“更多文章”分页，静态首屏由 Astro 构建，不在本阶段范围。

### 3.5 公开路由整体规则（@Public + 限流）

- 全部公开路由标 `@Public()`（豁免 JWT 守卫，P6 已支持）；
- 限流：沿用 P1 全局 throttler（60 次/分/IP）；公开端点不得无限制。
- 公开端点清单（本阶段落地，逐字搬自 MASTER-PLAN §5，**路径自此定型不再变更**）：
  - `GET /public/articles`
  - `GET /public/articles/:slug`
  - `GET /public/collections/:type`（数据源 = P3 value-cache → collections 注册表 `public: true` 的类型；`:type` 白名单校验同 P4）
  - `GET /public/albums`（相册列表：info.json 元信息 + 图片文件名列表）
  - （二期）`GET/POST /public/comments/...` —— 本阶段**不实现**，仅确认表已建（P0b）。

### 3.6 订阅 `article.published` 做公开缓存（事件订阅方）

- 公开列表维护进程内缓存（`GET /public/articles` 首页热数据）；
- 订阅 `EVENTS.ArticlePublished` → **公开列表缓存失效**（下次请求重建）；
- 订阅者纪律同 §3.3（幂等、异常内部捕获、不冒泡）；缓存实现取最简（内存变量 + 失效标记），取舍记报告。

### 3.7 settings 模块（key-value JSON 表）

- `site_setting` 表：`key text PK, value text(JSON)`；**仅存运行态配置**（启动配置在 `data/config.json`，不得混用）。
- admin REST（全部需认证，全部输入过 zod）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/settings` | 全量键值 |
| PUT | `/admin/settings/:key` | 设置单键（body `{ value }`，value 序列化为 JSON 文本） |
| DELETE | `/admin/settings/:key` | 删除单键 |

> 说明：MASTER-PLAN §5 未列 settings 具体路径（结构文档列出 SettingsModule），以上路径为本阶段定型的最小规格，纳入交付报告疑问清单。

- 写入成功后发射 `EVENTS.ContentChanged`，payload `{ scope: 'settings', filePaths: [] }`（发射方：settings，MASTER-PLAN §4.4 `content.changed` 行含 settings）；发射前 parse。

### 3.8 XSS 与安全（MASTER-PLAN §7 + REQUIREMENTS §9）

- **公开输出任何未经 sanitize 的 HTML 一律禁止**：富文本公开输出走 `html_cache`（存储时已过滤）；markdown 渲染输出经 `common/render/`（marked → sanitize-html）。
- sanitize 配置：剥离 `script` 标签、事件处理器属性（`on*`）、`javascript:` 协议；允许常见排版标签（取舍记报告）。
- SSRF：本阶段服务端不主动请求用户提供的 URL（REQUIREMENTS §9 第 7 条）。

### 3.9 注册 `MediaReferenceContributor`（P7 注册表的第四个注册方）

- `articles/media-reference.ts`：`name: 'articles'`；`collectReferences()` 返回全部 `article.cover` 非空行的引用（`refType: 'article-cover'`、`targetLabel: slug`、`mediaPath: cover`）。
- 在 `ArticlesModule` 装配时注册到 `MediaReferenceRegistry`。至此 P7 表格四个注册方全部就位。

## 4. 接线说明

1. **公开路由归属各自领域模块**（保持 L2 互不 import）：`/public/articles` 与 `/public/articles/:slug` 在 **articles 模块**（公开控制器可与 `ArticlesController` 同文件双控制器或单独文件，取简者）；`/public/collections/:type` 在 **collections 模块**内新增 `public-collections.controller.ts`（读取经本模块已有的 `DataFileService` 注入，L2→L1 合法）；`/public/albums` 在 **albums 模块**内新增 `public-albums.controller.ts`（读取本模块相册目录扫描能力）。articles 模块不得 import collections/albums 实现该端点，反之亦然。
2. `articles.module.ts`：controllers `ArticlesController` + 公开路由控制器；providers `ArticlesService` + `post.changed` 订阅者 + `article.published` 订阅者 + articles 媒体贡献者。已注册于 `app.module.ts`（P0a 占位）。
3. `settings.module.ts`：controllers `SettingsController`，providers `SettingsService`。已注册。
4. 依赖注入：`DbModule`（article/article_content/site_setting）、`EventEmitter2`、`MediaReferenceRegistry`、P5 的 `common/markdown/`（读 markdown 原文用）、`common/render/`。
5. 分层自检：articles/settings（L2）只依赖 L1（data-files，如需）与 L0；公开缓存为 articles 内部实现，不新增跨模块依赖。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他一律保持原状；第 3 条 = 本阶段接线仅限 §2/§4 明列；第 4 条 = 本阶段零新增依赖（marked/sanitize-html 已在清单）。

**本阶段专属禁止**：

- **公开输出任何未经 sanitize 的 HTML**（硬性安全红线，§3.8）。
- 不得变更本阶段定型的公开路由路径（MASTER-PLAN §9 守则 8）。
- 不得实现评论端点（二期）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行，e2e 用 supertest，数据源为假 Mizuki 项目临时副本 + init/login token）：

1. **两源数据交错的分页正确性**：预置 markdown 与 richtext 文章各 ≥3 篇、发布时间交错 → `GET /public/articles?page=1&limit=4` 断言：全部 `status=published`、按 `pub_date` 严格降序、两来源交错出现（响应中 `sourceType` 混合）、`total` 正确；翻页（page=2）不重不漏。
2. **`<script>` 注入被清除**：创建富文本文章，`doc_json` 序列化内容中含 `<script>alert(1)</script>` 与 `onerror`/`javascript:` 变体 → 保存后 `html_cache` 与公开详情响应中**不含** `script` 标签、事件属性、`javascript:` 协议。
3. **未发布文章不出现在公开 API**：draft 状态（两种 source）与软删文章在公开列表/详情均不可见（详情 404）。
4. **`post.changed` 触发索引增量更新断言**：经 posts API 新建/修改/删除 markdown 文章（触发事件）→ 断言 `article` 表对应行被增量 upsert/软删，无需调用 sync。
5. **`article.published` 触发缓存更新断言**：公开列表请求一次（缓存建立）→ 发布新富文本文章 → 再次请求断言新文章出现（缓存已失效重建）。
6. **公开路由免认证 + 限流**：`/public/articles` 无 token 200；`/admin/articles` 无 token 401（守卫仍在）。
7. **公开集合与相册端点**：`/public/collections/diary` 返回文件缓存数据；未知 `:type` 4xx；`/public/albums` 返回相册元信息。
8. **混合详情渲染**：markdown 详情返回 sanitized HTML（含渲染标记）；richtext 详情返回 `html_cache`。
9. **settings CRUD**：PUT/GET/DELETE 往返一致；value 以 JSON 文本存储；写入后收到 `content.changed`（`scope:'settings'`）。
10. **articles 媒体引用注册**：`collectAll()` 贡献者名集合含 `articles`；带 `cover` 引用的文章存在时删除对应媒体 → 409。
11. **回归**：P0a–P7 既有用例全绿。
12. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（合计 ≥18 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. **公开 API 定型清单**：本阶段全部公开路径与参数（自此冻结）。
4. 疑问清单：settings REST 路径（§3.7 补白）、doc_json 校验深度、缓存实现策略、sanitize 白名单细节。
5. `CHANGELOG.md` 追加 P8 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
