# 任务：配置加载、数据库 11 表与统一异常（阶段 P0b）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是第 2 次会话（阶段 **P0b**），前置依赖阶段：**P0a（仓库骨架，已完成）**。

本会话范围一句话：**实现 `data/config.json` 的 zod 校验加载、Drizzle 11 张表定义与启动自动迁移、全局统一异常过滤器，并铺设事件总线依赖、分层 lint 规则、事件目录骨架与 pino 日志基建**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样，不实现任何业务模块逻辑。本阶段是人工关卡（数据库定型），完成后等待人工确认。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§1（技术栈）、**§3 全部**（数据库表设计，11 张表逐字依据）、§4 开头的「依赖分层」段（boundaries 规则依据）、**§4.4**（事件目录与交互矩阵）、§9（编码守则）
2. `docs/REQUIREMENTS.md`：§6.1（config.json）、§10（数据持久化）、§15（硬性约束）第 1 条
3. `CHANGELOG.md`：P0a 条目
4. `docs/decisions/` 全部 ADR（ADR-000 模板、ADR-001 依赖版本）。**注意 P0a 勘误：`@types/tree-kill` 已移除（tree-kill@1.2.2 自带类型），本阶段及后续不得再引用该包**
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/config/app-config.ts`
   - `apps/server/src/infra/db/schema.ts`
   - `apps/server/src/infra/db/migrate.ts`
   - `apps/server/src/common/filters/all-exceptions.filter.ts`
   - `apps/server/drizzle.config.ts`

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/config/app-config.ts`（[P0b]）
- `apps/server/src/infra/db/schema.ts`（[P0b]）
- `apps/server/src/infra/db/migrate.ts`（[P0b]）
- `apps/server/src/common/filters/all-exceptions.filter.ts`（[P0b]）
- `apps/server/drizzle.config.ts`（[P0b]）

**本阶段允许修改的既有实现文件**：

- `apps/server/src/app.setup.ts`（追加全局过滤器）
- `apps/server/src/app.module.ts`（注册 DB 模块与事件总线，见 §4）

**本阶段允许新建的文件（仅限以下，其他一律禁止）**：

- `packages/shared/src/events.ts` — 事件目录骨架（常量 + zod payload schema，见 §3.5）
- `apps/server/src/common/logger.ts` — pino 日志实例
- `apps/server/src/infra/db/db.module.ts` — 数据库 @Global 模块（提供 better-sqlite3/drizzle 实例并执行启动迁移）
- `apps/server/test/` 下本阶段测试文件
- `apps/server/drizzle/` — drizzle-kit 生成的迁移产物目录

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`common/security/safe-join.ts`（P1）、`common/pipes/zod-validation.pipe.ts`（P1）、`common/guards/jwt-auth.guard.ts`（P6）、`common/decorators/public.decorator.ts`（P6）、`common/interceptors/operation-log.interceptor.ts`（P6）、`infra/backup/backup.service.ts`（P2）、`modules/system/mizuki-detector.service.ts`（P6）、`modules/auth/*`（P6）、`modules/data-files/*`（P3）、`modules/collections/*`（P4）、`modules/posts/*`（P5）、`modules/articles/*`（P8）、`modules/albums/*`（P7）、`modules/media/*`（P7）、`modules/process/*`（P9）、`modules/backup/*`（P2）、`modules/settings/*`（P8）。

## 3. 详细规格

### 3.1 `config/app-config.ts` — 配置加载（REQUIREMENTS §6.1）

- 位置约定：`apps/server/data/config.json`，**数据库可用之前即需读取**（同步读取，`fs.readFileSync` + `JSON.parse`）。
- 定义 zod schema `AppConfigSchema`，字段基线（可扩展，扩展记 ADR）：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mizukiRoot` | string | `""` | Mizuki 项目根路径，未初始化时为空串 |
| `mode` | `'manage' \| 'additive' \| 'overwrite'` | `'manage'` | 对应 REQUIREMENTS §3 三模式（仅管理/新增文件/覆盖文件） |
| `backupDir` | string | `"data/backups"` | 备份目录（相对 apps/server） |
| `uploadLimitMb` | number | `10` | 上传上限，与 MASTER-PLAN §7 的 10MB 一致 |

- `loadAppConfig()`：文件存在 → 必须通过 `AppConfigSchema.parse`，非法即抛错（错误信息含字段路径），**启动即失败**；文件不存在 → 返回默认值（不阻塞启动，P0a 的 health 冒烟测试必须仍然通过）。
- 提供进程内单例获取方式；关键步骤（加载成功/使用默认值/校验失败）用 pino 打日志。

### 3.2 `infra/db/schema.ts` — 11 张表（逐字搬自 MASTER-PLAN §3）

通用约定：共 11 张表；时间戳统一 `integer({ mode: 'timestamp' })`；主键用 nanoid 文本（`text('id').primaryKey()`）。

1. **admin_user**（管理员）：`id` text PK；`username` text UNIQUE；`password_hash` text（argon2id 编码串）；`created_at` / `last_login_at` ts；`failed_login_count` int（连续失败计数）；`locked_until` ts?（锁定到期时间）。
2. **article**（统一文章索引，核心表）：`id` text PK；`slug` text UNIQUE（Markdown 文章取目录名）；`title` text；`source_type` text（`'markdown' | 'richtext'`）；`status` text（`'draft' | 'published'`）；`file_path` text?（markdown 时记录相对 Mizuki 根的路径）；`file_hash` text?（同步扫描用，sha256）；`category_id` text? FK（单分类，对齐 frontmatter）；`cover` / `summary` text?；`pinned` bool；`pub_date` ts?；`deleted_at` ts?（回收站软删）；`created_at` / `updated_at` ts。索引：`(status, pub_date)`、`(source_type)`。
3. **article_content**（富文本正文）：`article_id` text PK，FK→article ON DELETE CASCADE；`doc_json` text（TipTap 文档 JSON，信任源）；`html_cache` text?（sanitize 后的 HTML 缓存）；`updated_at` ts。
4. **category**：`id`、`name` UNIQUE、`slug` UNIQUE。
5. **tag**：`id`、`name` UNIQUE、`slug` UNIQUE。
6. **article_tag**：`article_id` + `tag_id` 复合主键。
7. **comment**（建表，二期启用）：`id`、`article_id` FK、`parent_id`?（自引用）、`author_name`、`author_email`?、`author_url`?、`content`、`status`（`pending/approved/spam`）、`ip_hash`、`created_at`。
8. **operation_log**（审计）：`id`、`user_id`?、`method`、`path`、`action`、`target`、`detail`（脱敏 JSON 文本）、`ip`、`created_at`。
9. **backup_record**：`id`、`scope`（`pre_write/manual/auto/db`）、`manifest_path`、`file_count`、`size_bytes`、`note`?、`created_at`。
10. **media_file**（媒体索引）：`id`、`path` UNIQUE（相对 Mizuki 根）、`original_name`、`mime`、`size`、`width`?、`height`?、`sha256`、`created_at`。
11. **site_setting**：`key` text PK、`value` text（JSON）。仅存运行态配置；启动配置存 `data/config.json`（DB 可用之前就需要）。

Drizzle 写法参照 MASTER-PLAN §3.2 的 article 示例（`$defaultFn(() => new Date())` 等）。迁移用 drizzle-kit 生成，`data/mizuki.db` 不进 git（P0a 的 .gitignore 已覆盖）。

### 3.3 `infra/db/migrate.ts` + `db.module.ts` — 启动自动迁移

- `drizzle.config.ts` 转正：schema 指向 `infra/db/schema.ts`，out 指向 `apps/server/drizzle/`，dialect sqlite，db 文件 `apps/server/data/mizuki.db`。
- 用 `drizzle-kit generate` 生成首个迁移（包含全部 11 表）。
- `runMigrations(dbPath)`：使用 `drizzle-orm/better-sqlite3/migrator` 的 `migrate()` 对目标库执行迁移；幂等（重复执行不报错）。
- `db.module.ts`：`@Global()` 模块，提供 better-sqlite3 实例与 drizzle 实例（DI token 自定），应用启动时（模块初始化）自动执行迁移。
- 迁移执行用 pino 打日志（开始/完成/失败）。

### 3.4 `common/filters/all-exceptions.filter.ts` — 统一异常格式

- `@Catch()` 全局过滤器，所有异常响应统一为 `{ code, message, detail }`：
  - `HttpException`：HTTP 状态码照旧；`code` 取异常类型名（如 `NotFoundException` → `'NotFoundException'`），`message` 取异常 message，`detail` 放可选细节（如 zod issues）。
  - 未知异常（非 `HttpException`）：500，`code: 'InternalError'`，`message` 对外固定为「内部服务器错误」，`detail` 仅日志保留（不泄露堆栈给客户端）。
- 所有异常经 pino 记录（未知异常记 error 级含堆栈）。

### 3.5 `packages/shared/src/events.ts` — 事件目录骨架（MASTER-PLAN §4.4 逐字）

事件名、payload zod schema、常量统一定义于本文件；**禁止任何字符串字面量形式的 emit/on**。

常量与 `ContentChangedPayload` 逐字搬自 MASTER-PLAN §4.4：

```ts
export const EVENTS = {
  ContentChanged: 'content.changed', PostChanged: 'post.changed',
  ArticlePublished: 'article.published', MediaChanged: 'media.changed',
  BackupCompleted: 'backup.completed', ProcessFinished: 'process.finished',
} as const;

export const ContentChangedPayload = z.object({
  scope: z.enum(['collection','post','album','about','settings']),
  type: z.string().optional(), filePaths: z.array(z.string()) });
// 每事件一个 zod schema，发射前 parse
```

其余 5 个 payload schema 按 §4.4 事件表的 payload 摘要逐一补齐（每事件一个，发射前 parse）：

| 事件 | payload 字段（据 §4.4 表） |
|---|---|
| `post.changed` | `{ slug: string, frontmatter: Record<string, unknown>, fileHash: string, deleted: boolean }` |
| `article.published` | `{ id: string, slug: string, sourceType: 'markdown' \| 'richtext', title: string }` |
| `media.changed` | `{ path: string, op: 'save' \| 'delete' }` |
| `backup.completed` | `{ id: string, scope: string, fileCount: number }` |
| `process.finished` | `{ task: string, exitCode: number, durationMs: number }` |

本文件只允许常量与 zod schema，禁止任何业务逻辑（生成规则 10：shared 包只放类型和常量）。

### 3.6 分层 lint（MASTER-PLAN §4「依赖分层」段，P0b 配置）

- 根 devDependencies 引入 `eslint-plugin-boundaries`，在根 `eslint.config.mjs` 配置 element types 与依赖规则：
  - L0 共享层：`packages/shared`、`apps/server/src/common`、`apps/server/src/infra`、`apps/server/src/config`（不依赖任何模块）
  - L1 引擎：`apps/server/src/modules/data-files`
  - L2 领域模块：`modules/{collections, posts, albums, media, articles, settings}`
  - L3 编排传输：`modules/{auth, system, process, backup}`
- 规则：允许 L2→L1→L0、L3→L0，以及 **L3 之间相互依赖**（编排层内部协作，如 auth 与 system 共用 `MizukiDetectorService`）；**禁止 L2 之间互 import**；L0/L1/L2 不得依赖 L3；error 级。
- 测试入口目录（`apps/server/test`）不受 boundaries 约束（配置中排除）。

### 3.7 pino 日志基建

- `apps/server` dependencies 新增 `pino`（版本取最新稳定版，记入 ADR-001）。
- `common/logger.ts` 导出共享 pino 实例（日志级别可由环境变量 `MIZUKI_LOG_LEVEL` 控制，默认 `info`）。
- 本阶段起，关键写入步骤（配置加载、迁移执行、异常处理）必须打日志；后续阶段的写入管线沿用该实例。

## 4. 接线说明

1. `app.setup.ts`：追加 `app.useGlobalFilters(new AllExceptionsFilter())`（保留已有 `setGlobalPrefix('api/v1')`，更新头注释中 P1 预留说明）。
2. `app.module.ts`：imports 头部注册 `DbModule`（@Global）与 `EventEmitterModule.forRoot()`（依赖 `@nestjs/event-emitter`，见下）。模块注册顺序与注释风格延续 P0a。
3. 新增依赖（记入 ADR-001 表格）：
   - `apps/server` dependencies：`@nestjs/event-emitter`
   - 根 devDependencies：`eslint-plugin-boundaries`
   - `apps/server` dependencies：`pino`
4. `packages/shared/src/index.ts`：追加导出 `./events`（保留占位导出）。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = §2 之外的 stub 不得接线；第 4 条 = 仅允许 §4.3 列出的新增依赖。

**本阶段专属禁止**：

- 不得创建任何业务 service（collections/posts/media 等一律不碰）。
- 不得读写真实 Mizuki 目录任何文件（测试一律用临时目录）。
- `events.ts` 不得包含业务逻辑；任何代码不得使用字符串字面量 emit/on 事件。
- 不得为六类集合内容建任何数据库表（11 表之外一律不加表）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行）：

1. **迁移建表**：单测在临时目录新建 SQLite 文件并执行 `runMigrations`，查询 `sqlite_master`，断言 11 个表名集合恰好为 `{ admin_user, article, article_content, category, tag, article_tag, comment, operation_log, backup_record, media_file, site_setting }`；重复执行一次不报错（幂等）。
2. **config 校验**：单测——临时 `config.json` 写入非法值（如 `uploadLimitMb: "abc"`）时 `loadAppConfig` 抛出含字段路径的错误；文件不存在时返回默认值；合法文件返回解析值。
3. **异常过滤器**：两条单测——(a) `NotFoundException` 经过滤器输出 404 且 body 含 `code/message/detail` 三键；(b) 未知 `Error` 输出 500 且 `message` 不含堆栈/内部细节。
4. **分层拦截**：在 `apps/server/src/modules/collections/collections.service.ts` 临时追加一行 `import` 指向 `../posts/posts.service`，运行 `pnpm lint` 必须报 boundaries error；随后删除该行，`pnpm lint` 恢复全绿。此过程在交付报告中附两次 lint 输出摘要。
5. **事件目录**：单测断言 `EVENTS` 恰好含 6 个事件常量且值与 §3.5 一致；每个 payload schema 各一条合法样本 `parse` 通过、一条非法样本抛错。
6. **回归**：P0a 冒烟测试（`GET /api/v1/system/health` → 200 `status: "ok"`）仍然通过；启动时迁移自动执行（e2e 启动后 `data/mizuki.db` 存在且含 11 表，或单测等价断言）。
7. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（11 表 + config + 过滤器 + boundaries + events，合计 ≥12 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 新增依赖实际版本表（追加进 `docs/decisions/ADR-001-dependency-versions.md`）。
4. 偏差清单：理想为空；任何偏差（含对 config 字段基线的扩展、ADR 决策）必须显式列出原因。
5. `CHANGELOG.md` 追加 P0b 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
