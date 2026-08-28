# Mizuki-Server 技术规划书（Node/TS 版）
> **本文档的用法**：这是一份“主控规划文档”，为 AI 独立开发而写。使用方式：
> 1. 将本文档存为仓库内 `docs/MASTER-PLAN.md`；
> 2. 每次开发会话，向 AI 注入「第 11 节守则 + 第 10 节当前阶段 + 相关模块章节」；
> 3. 每阶段结束必须通过验收标准才能进入下一阶段。
> 4. 所有模糊之处 AI 必须选择更简单的实现，并在 `docs/decisions/ADR-xxx.md` 记录决策。
---
## 1. 全局技术约束（锁定，不允许 AI 更换）
| 项          | 选型                                                         |
| ----------- | ------------------------------------------------------------ |
| 运行时      | Node.js ≥ 22 LTS，TypeScript ≥ 5.5，`strict: true`           |
| 框架        | NestJS 11（默认 Express 适配器）                             |
| ORM / DB    | Drizzle ORM + better-sqlite3，数据库文件 `apps/server/data/mizuki.db` |
| TS 数据文件 | ts-morph                                                     |
| Markdown    | gray-matter（frontmatter）+ marked（公开 API 渲染）          |
| 校验        | zod（所有输入边界，含 DTO、配置、数据文件内容）              |
| 认证        | jose（JWT HS256）+ argon2（密码哈希）                        |
| 子进程      | cross-spawn（`shell: false`）+ tree-kill                     |
| 图片        | sharp                                                        |
| 实时日志    | SSE（Nest 原生 `@Sse()` 装饰器）                             |
| 测试        | Vitest + supertest                                           |
| 仓库        | pnpm monorepo：`apps/server`、`apps/web`（面板，后期）、`packages/shared`（zod schema 与类型共享） |
| 事件总线 | @nestjs/event-emitter + 事件目录（packages/shared/src/events.ts） | 跨模块异步交互唯一通道 |

| 默认端口    | 20154，管理面板与 API 同源                                   |
---
## 2. 核心架构决策（与旧规划的关键差异）
1. **文件即数据库**：diary / friends / projects / timeline / skills / devices 的数据源永远是 Mizuki 的 `src/data/*.ts`，**不为它们建数据库表**。公开 API 直接从文件缓存读取。这消除了双数据源同步问题（旧 Java 规划为它们建了 19 张表，是错误的）。
2. `article` 表是**统一索引**：Markdown 文章以“文件哈希镜像”形式入库（供混合列表/搜索），富文本文章以它为主存储。
3. 所有对 Mizuki 目录的写入，**必须**经过统一管线：`safeJoin 路径校验 → zod 校验 → 语法校验 → 备份 → 原子写入`。这条管线是全项目唯一写文件的通道。
4. **领域模块互不解耦**：modules/ 下各模块禁止互相 import（eslint-plugin-boundaries
   error 级强制）。跨模块交互仅限三通道：事件目录（异步）、贡献者注册表（同步反查）、
   纯工具提升至 common/shared/。
5. **异步交互走事件目录**：内容变更后由写入管线成功出口发射过去式领域事件；订阅者
   （缓存失效、索引更新、统计、未来插件）自行响应。订阅者必须幂等、异常内部捕获并
   记日志，绝不冒泡到发起请求。
6. **同步反查走注册表**：媒体引用检查用 MediaReferenceContributor 注册表——media 模块
   不认识引用方，各内容模块自注册检查器。pre-write 备份保持直接调用 infra/backup
   （共享底层，非模块耦合，套 Port 属过度设计）。
---
## 3. 数据库表设计
共 11 张表。时间戳统一用 `integer({ mode: 'timestamp' })`，主键用 nanoid 文本。
### 3.1 表清单
**admin_user** — 管理员
| 列                                                           | 类型                                  | 说明                                |
| ------------------------------------------------------------ | ------------------------------------- | ----------------------------------- |
| id                                                           | text PK                               |                                     |
| username                                                     | text UNIQUE                           |                                     |
| password_hash                                                | text                                  | argon2id 编码串                     |
| created_at / last_login_at                                   | ts                                    |                                     |
| failed_login_count                                           | int                                   | 连续失败计数                        |
| locked_until                                                 | ts?                                   | 锁定到期时间                        |
| **article** — 统一文章索引（核心表）                         |                                       |                                     |
| 列                                                           | 类型                                  | 说明                                |
| ---                                                          | ---                                   | ---                                 |
| id                                                           | text PK                               |                                     |
| slug                                                         | text UNIQUE                           | Markdown 文章取目录名               |
| title                                                        | text                                  |                                     |
| source_type                                                  | text                                  | `'markdown'` \| `'richtext'`        |
| status                                                       | text                                  | `'draft'` \| `'published'`          |
| file_path                                                    | text?                                 | markdown 时记录相对 Mizuki 根的路径 |
| file_hash                                                    | text?                                 | 同步扫描用（sha256）                |
| category_id                                                  | text? FK                              | 单分类，对齐 frontmatter            |
| cover / summary                                              | text?                                 |                                     |
| pinned                                                       | bool                                  |                                     |
| pub_date                                                     | ts?                                   |                                     |
| deleted_at                                                   | ts?                                   | 回收站软删                          |
| created_at / updated_at                                      | ts                                    |                                     |
| 索引：`(status, pub_date)`、`(source_type)`。                |                                       |                                     |
| **article_content** — 富文本正文                             |                                       |                                     |
| 列                                                           | 类型                                  | 说明                                |
| ---                                                          | ---                                   | ---                                 |
| article_id                                                   | text PK, FK→article ON DELETE CASCADE |                                     |
| doc_json                                                     | text                                  | TipTap 文档 JSON（信任源）          |
| html_cache                                                   | text?                                 | sanitize 后的 HTML 缓存             |
| updated_at                                                   | ts                                    |                                     |
| **category**：id, name UNIQUE, slug UNIQUE                   |                                       |                                     |
| **tag**：id, name UNIQUE, slug UNIQUE                        |                                       |                                     |
| **article_tag**：article_id + tag_id 复合主键                |                                       |                                     |
| **comment**（建表，二期启用）                                |                                       |                                     |
| id, article_id FK, parent_id?（自引用）, author_name, author_email?, author_url?, content, status(`pending/approved/spam`), ip_hash, created_at |                                       |                                     |
| **operation_log** — 审计                                     |                                       |                                     |
| id, user_id?, method, path, action, target, detail(脱敏 JSON 文本), ip, created_at |                                       |                                     |
| **backup_record**                                            |                                       |                                     |
| id, scope(`pre_write/manual/auto/db`), manifest_path, file_count, size_bytes, note?, created_at |                                       |                                     |
| **media_file** — 媒体索引                                    |                                       |                                     |
| id, path UNIQUE（相对 Mizuki 根）, original_name, mime, size, width?, height?, sha256, created_at |                                       |                                     |
| **site_setting**：key text PK, value text(JSON)。仅存运行态配置；启动配置存 `data/config.json`（DB 可用之前就需要）。 |                                       |                                     |
### 3.2 Drizzle 示例（article 表，其余照此模式）
```ts
export const article = sqliteTable('article', {
id: text('id').primaryKey(),
slug: text('slug').notNull().unique(),
title: text('title').notNull(),
sourceType: text('source_type').notNull(), // 'markdown' | 'richtext'
status: text('status').notNull().default('draft'),
filePath: text('file_path'),
fileHash: text('file_hash'),
cover: text('cover'),
summary: text('summary'),
pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
pubDate: integer('pub_date', { mode: 'timestamp' }),
deletedAt: integer('deleted_at', { mode: 'timestamp' }),
createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [
index('idx_article_status_date').on(t.status, t.pubDate),
]);
```
迁移用 drizzle-kit 生成，`data/mizuki.db` 不进 git。
---
## 4. 项目结构与 NestJS 模块拆分
```
apps/server/src/
├── main.ts / app.module.ts
├── common/
│   ├── security/safe-join.ts          # 路径监狱（含单测）
│   ├── pipes/zod-validation.pipe.ts   # 全局 zod 校验管道
│   ├── guards/jwt-auth.guard.ts       # 全局默认开启
│   ├── decorators/public.decorator.ts # @Public() 标记豁免
│   ├── interceptors/operation-log.interceptor.ts
│   └── filters/all-exceptions.filter.ts  # 统一 {code, message, detail}
├── config/app-config.ts               # 读 data/config.json + 环境变量
├── infra/
│   ├── db/ (schema.ts, migrate.ts)
│   └── backup/ (backup.service.ts)    # 唯一备份实现
└── modules/
├── system/        # 初始化向导、Mizuki 检测、健康检查
├── auth/          # 登录、JWT、管理员
├── data-files/    # ★ ts-morph 引擎（见第 6 节）
├── collections/   # ★ 通用集合 CRUD（见 4.2）
├── posts/         # Markdown 文章（gray-matter + 文件系统）
├── articles/      # 富文本文章 + 统一索引 + 同步
├── albums/        # 相册（文件系统 + info.json）
├── media/         # 上传、sharp 处理、媒体索引
├── process/       # npm 子进程 + SSE 日志
├── backup/        # 备份 API 层（调 infra/backup）
└── settings/      # Mizuki-Server 设置 + Mizuki config.ts 接管
```
依赖分层（eslint-plugin-boundaries 机械化强制，P0b 配置）：
L0 共享层：packages/shared、common/、infra/（不依赖任何模块）
L1 引擎：data-files
L2 领域模块：collections / posts / albums / media / articles / settings
L3 编排传输：auth / system / process / backup(API)
规则：允许 L2→L1→L0、L3→L0；禁止 L2 之间互 import；
纯工具（如 gray-matter 包装）提升到 common/ 属合法解耦手段。

### 4.1 全局守卫策略
- `JwtAuthGuard` 全局注册，除 `@Public()` 路由外全部需要 Token；
- 公开路由（`/api/v1/public/**`、`/api/v1/system/**` 的检测/健康部分）挂全局 throttler（如 60 次/分钟/IP）；
- 登录接口单独限流（5 次/分钟），配合 `failed_login_count` 锁定。
### 4.2 通用集合引擎（本项目最重要的抽象）
六类内容（diary/friends/projects/timeline/skills/devices）操作模式完全一致，做成**注册表驱动的单一控制器**，新增一种内容类型 = 增加一个配置对象：
```ts
// modules/collections/registry.ts
export interface CollectionDef {
type: string;                 // 'diary'
file: string;                 // 'src/data/diary.ts'（相对 Mizuki 根）
varName: string;              // 'diaryData'
shape: 'array' | 'grouped';   // devices 是 grouped（分类→数组 的对象）
itemSchema: z.ZodTypeAny;     // 与 Mizuki interface 对齐的 zod schema
idField: string;              // 'id'
imageDir?: string;            // 'public/images/diary'
public: boolean;              // 是否暴露公开 API
}
export const REGISTRY: CollectionDef[] = [
{ type: 'diary', file: 'src/data/diary.ts', varName: 'diaryData',
shape: 'array', idField: 'id', imageDir: 'public/images/diary',
public: true, itemSchema: DiaryItemSchema },
// friends / projects / timeline / skills 同构……
{ type: 'devices', file: 'src/data/devices.ts', varName: 'devicesData',
shape: 'grouped', idField: 'name', imageDir: 'public/images/device',
public: true, itemSchema: DeviceItemSchema },
];
```
`CollectionsController` 单一动态路由，`:type` 先对注册表白名单校验（防路径注入）。
### 4.3 Mizuki 项目检测规则（system 模块）
给定路径 P，判定为 Mizuki 项目需同时满足：
1. `P/package.json` 存在且 `dependencies/devDependencies` 含 `astro`；
2. `P/astro.config.{mjs,ts,js}` 存在；
3. `P/src/data/` 存在且至少含 `diary.ts / friends.ts` 之一；
4. `P/src/content/posts/` 存在。
    返回 `{ valid, checks: [...每项明细], packageManager: 'pnpm|yarn|npm'（按 lockfile 探测） }`。

### 4.4 事件目录与跨模块交互矩阵（模块互动的唯一规格）

事件名、payload zod schema、常量统一定义于 `packages/shared/src/events.ts`；
禁止任何字符串字面量形式的 emit/on。

| 事件 | payload（zod 摘要） | 发射方 | MVP 订阅方 | 未来订阅方 |
|---|---|---|---|---|
| content.changed | {scope, type?, filePaths[]} | data-files(集合/settings)、posts、albums | value-cache 失效、仪表盘统计 | webhook、搜索索引 |
| post.changed | {slug, frontmatter, fileHash, deleted} | posts | articles 索引增量 upsert/移除 | RSS、sitemap |
| article.published | {id, slug, sourceType, title} | posts、articles | 公开列表缓存失效 | 通知、RSS |
| media.changed | {path, op:'save'\|'delete'} | media、albums | 媒体索引、统计 | — |
| backup.completed | {id, scope, fileCount} | infra/backup | 仪表盘备份状态 | 保留策略 |
| process.finished | {task, exitCode, durationMs} | process | 仪表盘 | 构建通知 |

同步通道（注册表）：

| 注册表 | 注册方 | 消费方 | 用途 |
|---|---|---|---|
| MediaReferenceContributor | posts / collections / albums / articles | media | 删除前引用聚合检查；有引用→409+引用明细 |

事件骨架（P0b 创建）：

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

纪律：发射点位于各写入管线成功出口，恰好一次、失败不发；订阅者幂等、
异常内部捕获记日志；未来插件系统 = 新模块订阅事件 + 注册贡献者，核心模块零改动。

---
## 5. REST API 清单
前缀 `/api/v1`。**System**（部分公开）：`GET /system/health`、`GET /system/status`、`POST /system/detect`、`POST /system/init`（仅未初始化时可用一次）。
**Auth**（公开）：`POST /admin/auth/login` → `{accessToken, refreshToken}`；`POST /admin/auth/refresh`；`POST /admin/auth/logout`；`GET /admin/auth/me`。
**集合**（全部需认证；`:type` ∈ 注册表白名单）：
| 方法                                                         | 路径                               | 说明                                    |
| ------------------------------------------------------------ | ---------------------------------- | --------------------------------------- |
| GET                                                          | `/admin/collections/:type`         | 全量列表（含分组结构）                  |
| POST                                                         | `/admin/collections/:type`         | 新增（grouped 时 body 含 `group` 字段） |
| PATCH                                                        | `/admin/collections/:type/:id`     | 修改                                    |
| DELETE                                                       | `/admin/collections/:type/:id`     | 删除（grouped 时自动清理空分组）        |
| POST                                                         | `/admin/collections/:type/reorder` | 按 id 数组重排（可选，后期）            |
| **Posts**：`GET/POST /admin/posts`、`GET/PATCH/DELETE /admin/posts/:slug`、`POST /admin/posts/:slug/cover`、`POST /admin/posts/sync`（重建 article 索引）。 |                                    |                                         |
| **Articles（富文本）**：`GET/POST /admin/articles`、`GET/PATCH/DELETE /admin/articles/:id`。 |                                    |                                         |
| **Albums**：`GET/POST /admin/albums`、`PATCH/DELETE /admin/albums/:id`、`POST /admin/albums/:id/images`、`DELETE /admin/albums/:id/images/:name`。 |                                    |                                         |
| **Media**：`POST /admin/media`（multipart）、`GET /admin/media`、`DELETE /admin/media/:id`（删除前做引用检查）。 |                                    |                                         |
| **Backup**：`POST /admin/backups`（scope: full/data/content/db）、`GET /admin/backups`、`POST /admin/backups/:id/restore`（body 须含 `confirm: true`）、`DELETE /admin/backups/:id`。 |                                    |                                         |
| **Process**：`POST /admin/process/tasks`（task ∈ `install/dev/build/preview` 白名单）、`GET /admin/process/tasks/:id`、`DELETE /admin/process/tasks/:id`（停止）、`GET /admin/process/tasks/:id/logs`（SSE）、`GET /admin/process/ports/:port`。 |                                    |                                         |
| **公开 API**（`@Public()` + 限流）：`GET /public/articles`（Markdown+富文本混合分页，按 pub_date 降序）、`GET /public/articles/:slug`、`GET /public/collections/:type`、`GET /public/albums`、（二期）`GET/POST /public/comments/...` 🔒 三期 C0 关闭（ADR-016），永久不实现。 |                                    |                                         |
---
## 6. ts-morph 数据文件引擎（核心模块详设）
> 位置：`modules/data-files/`。app.py 用“括号平衡 + JSON5”做文本 hack，本引擎用 AST，**从根本上解决可靠性问题**。
### 6.1 模块组成
```
data-files/
├── data-file.service.ts   # 对外门面：readCollection / mutateCollection
├── evaluator.ts           # AST → JS 值
├── serializer.ts          # JS 值 → TS 字面量文本
├── syntax-check.ts        # 写前语法校验
├── file-lock.ts           # 每文件异步互斥
└── value-cache.ts         # mtime+size 键的读缓存（公开 API 用）
```
### 6.2 读取：AST 求值器（完整规格）
每次操作从磁盘重读文件、新建一次性 `Project`（文件小、解析成本可忽略，**彻底规避陈旧 AST**）：
```ts
import { Project } from 'ts-morph';
function loadSource(absPath: string) {
const project = new Project({ skipAddingFilesFromTsConfig: true });
return project.createSourceFile(absPath, fs.readFileSync(absPath, 'utf8'), { overwrite: true });
}
const decl = sf.getVariableDeclaration(varName)
?? throw new NotFoundError(`未找到导出 ${varName}`);
const value = astToValue(decl.getInitializer()!);
```
`astToValue` 递归求值，只接受**自包含字面量**，遇到无法静态求值的节点抛 `UnsupportedLiteralError`（含文件名+行号）：
| AST 节点                                                     | 行为                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| ArrayLiteralExpression                                       | 递归 elements                                                |
| ObjectLiteralExpression                                      | 遍历 PropertyAssignment（key 支持标识符/字符串）；Shorthand/Spread/Getter → **抛错** |
| StringLiteral / NoSubstitutionTemplateLiteral                | `getLiteralText()`（自动处理单引号、转义）                   |
| NumericLiteral                                               | `Number(...)`                                                |
| True/False/Null                                              | 对应值                                                       |
| AsExpression / SatisfiesExpression / Parenthesized           | 解包后递归（兼容 `as const`、`satisfies Xxx`）               |
| PrefixUnary `-'42'`                                          | 取负                                                         |
| TemplateExpression（含 `${}`）/ Identifier / PropertyAccess  | **抛错**（数据文件必须自包含）                               |
| 注释天然被 AST 跳过；单引号、尾随逗号在求值时天然兼容——app.py 的三大难题消失。 |                                                              |
### 6.3 写入：值 → TS 文本
JSON 即合法 TS 字面量，直接：
```ts
export function valueToTsLiteral(value: unknown): string {
const json = JSON.stringify(value, null, 2) ?? 'null';
return json.replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:'); // 纯美化：去键引号
}
```
回写只替换初始化表达式区域，**interface、type、import、文件尾代码、数据块外的注释一字不动**：
```ts
decl.setInitializer(valueToTsLiteral(next));
const text = sf.getFullText();
```
> 若 `setInitializer` 对多行文本缩进处理不符合预期（以 golden 测试为准），备选方案：`initializer.replaceWithText(...)` 并按声明语句所在列手动补缩进。
### 6.4 完整写入管线（顺序不可变）
```ts
async mutateCollection(relFile, varName, mutate: (v) => v) {
return this.lock.withLock(absFile, async () => {
// 1. 读盘 + 记录原文哈希
const { sourceFile, originalHash } = this.loadWithHash(absFile);
// 2. AST 求值 → 深拷贝 → 用户变更
const next = mutate(structuredClone(astToValue(getInitializer(sourceFile, varName))));
// 3. zod 整体校验（schema.array().parse / grouped 用 recordSchema）
def.itemSchema.array().parse(next);
// 4. 生成新文本 + 语法校验（ts.transpileModule reportDiagnostics，syntax error 必须为 0）
decl.setInitializer(valueToTsLiteral(next));
const text = sourceFile.getFullText();
assertSyntaxValid(text);
// 5. 陈旧检测：重读磁盘哈希 ≠ originalHash → 整体重试 1 次，仍冲突返回 409
// 6. 备份原文件（BackupService.preWrite，type='pre_write'）
// 7. 原子写入：写同目录临时文件 `.tmp-<nanoid>` → fs.rename 覆盖
// 8. 失效 value-cache，返回新值
});
}
```
**并发控制**：`file-lock.ts` 维护 `Map<path, Promise>` 链，同一文件串行；不同文件并行。
**device（grouped）**：求值结果是 `{分类: item[]}` 对象，mutate 时对目标分组数组增删改，写回整体对象；删除后数组为空的分组键直接移除。
### 6.5 golden-file 测试（本模块的验收核心）
仓库内置**假 Mizuki 项目** `test/fixtures/mizuki/`（含全部 6 个数据文件，刻意覆盖：块注释/行注释、单引号、尾随逗号、`as const`、`satisfies`、嵌套对象、字符串含引号和换行）。
测试断言：
1. 读 → 改 → 写 → 再读，值正确；
2. **写后文件中，初始化表达式以外的所有字节与原文件完全一致**（用文本 diff 断言）；
3. 所有“不支持节点”用例抛出带行号的明确错误；
4. （可选集成测试）写后对 fixture 执行 `tsc --noEmit` 通过。
---
## 7. 备份 / 进程 / 安全要点
**备份**（`infra/backup`）：目录 `data/backups/<时间戳-nanoid>/` + `manifest.json`（记录每个文件原路径 + sha256）。`pre_write` 只备单个目标文件，每文件保留最近 10 份自动清理；`db` 用 better-sqlite3 的 `.backup()` API；`restore` 前先对当前状态做一次备份，且要求 `confirm: true`。
**进程**：任务白名单硬编码（install/dev/build/preview），包管理器按 lockfile 探测；`cross-spawn` 且 **`shell: false`**（命令注入的根防线，Windows 下 npm.cmd 由 cross-spawn 解析）；env 只透传 `PATH/HOME/APPDATA`；POSIX 用 detached 进程组，停止用 tree-kill；日志保留内存环形缓冲（最近 2000 行）+ SSE 推送。
**路径监狱**（`safe-join`，全项目唯一合法路径入口）：
```ts
function safeJoin(root: string, untrusted: string): string {
const p = path.resolve(root, untrusted);
if (p !== root && !p.startsWith(root + path.sep)) throw new ForbiddenPathError();
return p; // 上层再对已存在祖先做 realpath 校验防符号链接逃逸
}
```
必须附单测：`../`、绝对路径、`..\\`、URL 编码、空字节、符号链接逃逸。
**上传**：扩展名白名单 + file-type 魔数嗅探 + 10MB 限制 + 随机文件名 + sharp 重编码（顺带去除 EXIF 与图片内嵌 payload）。**XSS**：富文本存 TipTap JSON（信任源），公开输出 HTML 时过 sanitize-html；Markdown 渲染 HTML 同样过 sanitize-html。**SQL**：Drizzle 全参数化，禁止字符串拼接 SQL。
---
## 8. 分阶段路线图（每阶段 = 一次 AI 会话）
| 阶段                     | 内容                                                         | 验收标准                                                     |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **P0 脚手架**            | monorepo、Nest 启动、config.json 读取、Drizzle+迁移、Vitest、ESLint、统一异常格式 | `pnpm dev` 起服务，`/system/health` 200；`pnpm test` 空      |
| **P1 安全基建**          | safe-join（+攻击用例单测）、zod 管道、helmet/CORS/throttler、操作日志拦截器 | 路径穿越/非法输入测试全绿                                    |
| **P2 备份模块**          | BackupService 全套 + manifest + 恢复 + 保留策略              | 临时目录单测：备份→改→恢复→哈希一致                          |
| **P3 数据文件引擎**      | 第 6 节全部                                                  | golden-file 测试全绿（含“外部字节不变”断言）                 |
| **P4 集合 CRUD**         | 注册表 + 动态控制器 + 六类 zod schema + admin 路由           | supertest e2e：对 fixture 项目增删改查六类数据，写后文件可编译 |
| **P5 Posts**             | gray-matter 读写、扫描、封面上传、article 索引同步           | e2e：创建/修改/删除文章（自动备份可回滚）                    |
| **P6 Auth + 初始化**     | argon2、JWT 双 Token、全局守卫、init 向导 API                | 无 Token 访问 admin 路由全 401；init 仅可执行一次            |
| **P7 媒体 + 相册**       | 上传管线、媒体索引、相册 CRUD、引用检查删除                  | 恶意文件（伪造扩展名）被拒；被引用图片删除被拒               |
| **P8 富文本 + 公开 API** | article/content 表、混合列表、公开端点、限流                 | e2e：混合分页正确；`<script>` 注入被清除                     |
| **P9 进程管理**          | 白名单 spawn、SSE、停止、端口检测                            | 对 fixture 项目启停 `npm run dev`，日志实时推送              |
| **P10 管理面板**         | Vue3 + Element Plus + TipTap + CodeMirror：登录/仪表盘/集合表单（由 zod schema 自动生成）/文章/备份/构建控制台 | 手动场景清单走通                                             |
| **P11 收尾**             | Swagger 分组、README、`bin/mizuki-server` 启动脚本、安全清单复查 | 全量测试绿                                                   |

| 阶段 | 追加内容                                                     |
| ---- | ------------------------------------------------------------ |
| P0b  | 依赖 @nestjs/event-emitter；根 eslint 加 boundaries 分层规则；建 shared/src/events.ts 目录骨架。验收：故意写一条跨模块 import 被 lint 报 error |
| P4   | collections 每次写入发射 content.changed；e2e 用测试订阅者断言事件收到 |
| P5   | posts 发射 post.changed / article.published；gray-matter 包装提升 common/markdown/ |
| P7   | MediaReferenceContributor 注册表，四模块各自注册；带引用删除→409+明细 |
| P8   | articles 订阅 post.changed 做索引增量更新；公开列表缓存订阅 article.published |
| P9   | process 发射 process.finished                                |

---
## 9. AI 编码守则（每会话注入）
1. 只做当前阶段的事，**禁止顺手重构其他模块**；
2. 禁止 `any`/`as any`（确需时标 `// TODO(type)` 并记录）；
3. 禁止在 data-files/backup/media 之外使用 `fs.writeFile`（守则可被 grep 审查）；
4. 所有外部输入必须过 zod，所有文件路径必须过 `safeJoin`；
5. 测试与实现同 PR，fixture 项目是唯一测试数据源，**绝不触碰真实 Mizuki 目录**；
6. 每阶段结束：`pnpm test && pnpm build` 全绿 + 追加 `CHANGELOG.md` 条目；
7. 规格有歧义 → 选更简单方案 + 写 ADR；
8. 公开 API 路径一经 P8 定型不再变更（面板与博客前端依赖它）。
9. 跨模块交互仅限三通道（事件目录/贡献者注册表/共享层提升），模块互 import 会被
   lint error 拦截，禁止绕过；
12. 事件订阅者必须幂等、异常内部捕获并记日志，不得冒泡到发起请求；
13. 事件名与 payload 必须定义在 shared/events.ts，禁止字面量 emit/on。
