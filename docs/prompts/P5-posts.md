# 任务：Markdown 文章（Posts）读写与索引同步（阶段 P5）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P5**，前置依赖阶段：**P4（集合 CRUD）**。

本会话范围一句话：**实现 posts 模块——gray-matter 读写（frontmatter 往返保真）、文章目录管理、封面上传（sharp 转 JPG）、删除/恢复与 `article` 索引同步，并发射 `post.changed` / `article.published` 事件**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。**特别强调：禁止在本阶段实现富文本（那是 P8 的活）**。

> 跨阶段一致性说明：P5 的 admin 路由在 P6 之前无认证守卫属预期设计；P6 将统一挂守卫并验收。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§2 决策 2/3（article 统一索引、统一写管线）、§3 `article` 表、§5「Posts」路由清单、§4.4 事件表 `post.changed` 与 `article.published` 行、§8 路线图表 P5 行与「阶段追加」表 P5 行（事件）、§4 分层（posts 属 L2）
2. `docs/REQUIREMENTS.md`：**§6.10**（posts frontmatter 字段，逐字依据）、§6.0 通用约定、§4 文章体系（4.1/4.2/4.5）
3. `CHANGELOG.md`：P4 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/modules/posts/posts.module.ts`
   - `apps/server/src/modules/posts/posts.controller.ts`
   - `apps/server/src/modules/posts/posts.service.ts`
7. 已实现的前置件：`infra/backup`（pre_write/restore）、`common/security/safe-join.ts`、`infra/db`（article 表）、`packages/shared/src/events.ts`（EVENTS.PostChanged / EVENTS.ArticlePublished）

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/modules/posts/posts.module.ts`（[P5]）
- `apps/server/src/modules/posts/posts.controller.ts`（[P5]）
- `apps/server/src/modules/posts/posts.service.ts`（[P5]）

**本阶段允许新建的文件（仅限以下）**：

- `apps/server/src/common/markdown/` — **frontmatter 工具提升**（gray-matter 包装：读取/序列化/往返保真，供 posts 与 P8 复用）。属合法解耦手段（纯工具提升至 common/，MASTER-PLAN §4 分层规则）
- `apps/server/test/` 下本阶段测试文件

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`common/guards/jwt-auth.guard.ts`（P6）、`common/decorators/public.decorator.ts`（P6）、`common/interceptors/operation-log.interceptor.ts`（P6）、`modules/system/mizuki-detector.service.ts`（P6）、`modules/auth/*`（P6）、`modules/articles/*`（P8）、`modules/albums/*`（P7）、`modules/media/*`（P7）、`modules/process/*`（P9）、`modules/settings/*`（P8）。

## 3. 详细规格

### 3.1 目录约定与文件布局（REQUIREMENTS §6.10）

- 文章目录：`src/content/posts/<slug>/index.md`（相对 Mizuki 根）+ 同目录封面图片（如 `cover.jpg`）。
- `slug` 即目录名，是 `article` 表 `slug` 列的值（唯一）。
- 所有路径经 `safeJoin(mizukiRoot, ...)`。

### 3.2 frontmatter 字段（逐字搬自 REQUIREMENTS §6.10）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 是 | |
| published | boolean | 否 | ⚠ 类型以 Mizuki 为准（可能为日期） |
| description | string | 否 | SEO 摘要 |
| tags | string[] | 否 | |
| category | string | 否 | |
| author | string | 否 | |
| permalink | string | 否 | |
| pinned | boolean | 否 | 置顶 |
| draft | boolean | 否 | 草稿 |
| image | string | 否 | 封面引用 |
| date | string | 否 | 创建日期 |
| pubDate | string | 否 | 发布日期 |

**往返保真（硬性）**：保存后重读，字段集合与类型不丢失——不得丢弃未在表中的额外字段，不得改变原有字段顺序语义（gray-matter 序列化后字段不增不减；已知字段类型不漂移）。实现时以「解析出的全部 key 集合」为准，未知字段原样保留。

### 3.3 读写行为

- 读取：`gray-matter` 解析 `index.md` → `{ frontmatter, content }`。
- 写入：**必须走 P2 的 pre_write 备份 + 原子写**（写同目录临时文件 → `fs.rename` 覆盖），不得裸 `fs.writeFile`（MASTER-PLAN §9 守则 3）。
- 功能清单（§6.10）：列表 / 读内容 / 创建 / 修改 / 删除 / 上传 Markdown 文件 / 上传封面（转 JPG）/ frontmatter 保存（往返保真）/ 草稿管理 / 置顶管理 / 同步重建数据库索引（file_hash 用 sha256，幂等）。
- **删除与恢复**：DELETE 前先对文章目录执行备份（P2），再删除目录（可回滚）；恢复经备份机制回写（验收 §6.4）。删除操作打日志 + 记录（operation_log 表由 P6 拦截器接管，本阶段不实现日志拦截器）。

### 3.4 封面上传（`POST /admin/posts/:slug/cover`）

- 上传文件经**扩展名白名单 + 魔数嗅探**（图片类型）校验（复用/对齐 P7 上传管线的同款规则，本阶段可先实现最小版本：扩展名白名单 `jpg/jpeg/png/webp/gif` + sharp 可解码校验）。
- **用 sharp 转 JPG** 后写入 `src/content/posts/<slug>/cover.jpg`（原子写），并更新 frontmatter `image` 字段。

### 3.5 about 页（REQUIREMENTS §6.11——归属本阶段的规格补白）

- 文件：`src/content/spec/about.md`（相对 Mizuki 根）。
- 功能：**上传 / 编辑 / 保存前备份 / 支持回滚**——读写行为同 §3.4（pre_write 备份 + 原子写；删除场景不适用，about 只覆盖不删除）。
- REST（归入 posts 控制器，路径为本阶段定型）：`GET /admin/about`（返回 markdown 原文）、`PUT /admin/about`（body `{ content }`，写入前备份，可经备份回滚）。
- about 写入成功后发射 `EVENTS.ContentChanged`，`scope: 'about'`（见 §3.8）。

> 说明：事件目录 `content.changed` 的 scope 枚举含 `'about'`，其发射方即本处；此为规格补白，已列入生成会话交付报告疑问清单。

### 3.6 索引同步（`POST /admin/posts/sync`）

- 重建 `article` 表中 `source_type = 'markdown'` 的索引行：扫描 `src/content/posts/` 全部文章目录，对每篇——
  - 不存在则 insert；已存在则按 `file_hash`（sha256 of index.md）对比，内容变化才更新；
  - 文件已不在磁盘的既有行 → 标记 `deleted_at`（软删，对齐回收站语义）；
  - 字段映射：`slug`=目录名、`title`/`category`/`cover`(image)/`summary`(description)/`pinned`/`pub_date`(pubDate 或 date) 来自 frontmatter；`status`：`draft === true` 或 `published === false` → `'draft'`，否则 `'published'`；`file_path` = 相对 Mizuki 根的路径。
- **幂等**：连续执行两次，第二次不产生任何写（断言库内容一致且无 update 发生）。

### 3.7 REST API（MASTER-PLAN §5 逐字）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/posts` | 文章列表（含 frontmatter 摘要） |
| POST | `/admin/posts` | 创建文章（body 含 slug/frontmatter/content） |
| GET | `/admin/posts/:slug` | 读单篇（frontmatter + 正文） |
| PATCH | `/admin/posts/:slug` | 修改（frontmatter/正文） |
| DELETE | `/admin/posts/:slug` | 删除（先备份，可恢复） |
| POST | `/admin/posts/:slug/cover` | 上传封面（multipart，转 JPG） |
| POST | `/admin/posts/sync` | 重建 article 索引 |

（`GET /admin/about`、`PUT /admin/about` 见 §3.5，为本阶段补充规格。）

全部输入过 zod；slug 经 `safeJoin` 校验（拒绝路径穿越）。

### 3.8 事件（发射方，MASTER-PLAN §4.4 逐字）

发射点位于写管线成功出口，恰好一次、失败不发；发射前对 payload `parse`；禁止字符串字面量 emit/on。

1. **`post.changed`**（EVENTS.PostChanged）——每次文章创建/修改/删除成功后发射。
   - payload：`{ slug: string, frontmatter: Record<string, unknown>, fileHash: string, deleted: boolean }`（zod schema 在 `packages/shared/src/events.ts`，逐字使用）
   - 删除场景 `deleted: true`，`frontmatter` 为删除前的值，`fileHash` 为删除前哈希。
2. **`article.published`**（EVENTS.ArticlePublished）——文章进入已发布状态时发射（创建/修改后 `status === 'published'`）。
   - payload：`{ id: string, slug: string, sourceType: 'markdown' | 'richtext', title: string }`；posts 场景 `sourceType: 'markdown'`，`id` 为 `article` 表行 id（未入库的行先执行 upsert 再发射）。
3. **`content.changed`**（EVENTS.ContentChanged）——posts 模块是 `content.changed` 的发射方之一（§4.4 事件表）：
   - 文章创建/修改/删除成功后发射 `{ scope: 'post', filePaths: [<文章 index.md 相对路径>] }`（与 `post.changed` 并行：前者服务缓存失效/统计，后者服务文章索引）；
   - about 页写入成功后发射 `{ scope: 'about', filePaths: ['src/content/spec/about.md'] }`（§3.5；events.ts 中 `ContentChangedPayload.scope` 枚举的 `'about'` 项由此落地）。

订阅方（`post.changed` → articles 索引增量更新、`article.published` → 公开列表缓存失效）在 P8 实现；本阶段用测试订阅者断言发射。

### 3.9 日志

pino 记录：文章创建/修改/删除/恢复、封面写入、about 写入、sync 执行（扫描数/新增/更新/软删数）。

## 4. 接线说明

1. `posts.module.ts`：controllers `PostsController`，providers `PostsService`。`PostsModule` 已在 `app.module.ts` 注册（P0a 占位），本阶段填充。
2. 依赖注入：`DbModule` 的 drizzle 实例（article 表）、`BackupService`（pre_write/restore）、`AppConfig`（mizukiRoot）、`EventEmitter2`。
3. `common/markdown/` 为纯工具（L0 层），不依赖任何模块；posts 从 common 引入（L2→L0 合法）。
4. 分层自检：posts（L2）禁止 import collections/media/articles 等其他 L2 模块。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = §2 之外的 stub 不得接线；第 4 条 = 本阶段零新增依赖（gray-matter/sharp/nanoid 已在清单）。

**本阶段专属禁止**：

- **禁止在 P5 实现富文本**（富文本文章属 P8）。
- 不得实现公开文章端点（P8）、认证守卫（P6）、媒体库（P7）。
- 不得裸 `fs.writeFile` 写 Mizuki 目录（必须备份 + 原子写）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行，e2e 用 supertest，数据源为假 Mizuki 项目临时副本）：

1. **CRUD e2e**：创建文章 → 读回断言 → 修改（改 frontmatter 与正文）→ 读回断言 → 删除 → 目录不存在；`slug` 含 `../` 的请求被拒（400/403）。
2. **删除可恢复**：删除文章后，经备份恢复（调用 BackupService/REST restore）→ 断言文章目录与内容完整回来。
3. **frontmatter 往返断言**：写入含 §3.2 全部 12 个已知字段 + 1 个自定义额外字段的 frontmatter → 重读断言：字段集合一致（额外字段保留）、类型不变（boolean 不变字符串、数组仍是数组）。
4. **封面上传**：上传 PNG → 断言 `cover.jpg` 生成且为 JPEG（sharp metadata 断言 `format === 'jpeg'`），frontmatter `image` 更新；伪造扩展名（文本文件改名 .png）被拒。
5. **sync 幂等**：预置 3 篇文章 → `POST /admin/posts/sync` → 断言 article 表 3 行且 `file_hash` 为 sha256 → 再次 sync → 断言表内容逐行一致且未发生更新（可通过 updated_at 不变或写计数断言）。
6. **事件断言**：测试订阅者——创建/修改后收到 `post.changed`（payload 过 `PostChangedPayload.parse`，`deleted:false`）且同时收到 `content.changed`（`scope:'post'`）；发布文章后收到 `article.published`（`sourceType:'markdown'`）；删除后收到 `post.changed` 且 `deleted:true`；`PUT /admin/about` 后收到 `content.changed` 且 `scope:'about'`。
7. **about 往返与备份**：`PUT /admin/about` 写入新内容 → `GET /admin/about` 读回一致 → 备份目录出现该文件的 pre_write 快照 → 经备份恢复回到旧内容。
8. **回归**：P0a–P4 既有用例全绿。
9. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（合计 ≥16 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径（含 `common/markdown/` 提升的工具文件）。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 偏差清单：理想为空；`published` 字段类型与真实 Mizuki 的核对结果若有偏差记 ADR；状态推导规则（§3.6）的取舍记入报告。
4. `CHANGELOG.md` 追加 P5 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
