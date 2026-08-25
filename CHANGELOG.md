# 变更日志

## P4 — 注册表驱动六类集合 CRUD

- `packages/shared/src/collections/`：六个 zod schema 转正（`DiaryItemSchema` / `FriendsItemSchema` / `ProjectsItemSchema` / `TimelineItemSchema`（含 `TimelineTypeSchema`）/ `SkillsItemSchema` / `DeviceItemSchema` + `DeviceGroupedSchema`），字段逐字对齐 REQUIREMENTS §6.3–6.8；**放 shared 的动机：P10 管理面板将由这些 schema 驱动生成表单，前后端复用同一份字段规格**；`src/index.ts` 追加导出
- `collections/registry.ts`（新建）：`CollectionDef` 接口 + `REGISTRY` 六类配置（MASTER-PLAN §4.2 逐字：diary/friends/projects/timeline/skills 为 array+idField=id；devices 为 grouped+idField=name+imageDir=public/images/device；全部 public:true）——新增内容类型 = 加一个配置对象
- `collections.service.ts`：CRUD 编排，全部读写经 DataFileService（P3 引擎唯一通道）——POST 无 id（devices 无 name）自动 nanoid、id 冲突 409、PATCH/DELETE 不存在 404；grouped：POST body 含 `group`（flat 结构）、PATCH 跨分组定位（stripGroup）、DELETE 后空分组键自动清理；timeline POST 未给 icon/color 按 type 填默认映射（**ADR-004 暂定值**，待真实 Mizuki 主题源码核对）；每次写入成功出口恰好一次发射 `content.changed`（scope='collection'、type、filePaths，payload 先过 zod parse）
- `collections.controller.ts`：单一控制器 + `:type` 动态路由（GET/POST/PATCH/DELETE `/admin/collections/:type[/:id]`）；路由第一步注册表白名单校验，未知 type → 400 且零文件读写
- `collections.module.ts`：imports DataFilesModule，providers CollectionsService，controllers CollectionsController
- 微调：`data-file.service.ts` 的 schema 参数放宽为 `z.ZodType`（P4 传入的 array/record schema 输出类型不定，引擎只用 parse 校验）
- 未建任何数据库表（文件即数据库，MASTER-PLAN §2 决策 1）
- 测试新增 2 文件 19 用例：e2e 13（五类全循环、devices 分组+空分组清理、未知 type 四方法 400、事件 payload 断言、非法 body 400+文件未改、id 生成+409、timeline 默认映射、写后 6 文件 tsc --noEmit、404）+ schema 单测 6（fixture 全条目过 schema、必填/类型拒绝、未知字段剥离）。全仓 120/120 绿

## P3 — ts-morph 数据文件引擎（关卡：引擎定型）

- `modules/data-files/` 7 个 stub 全部转正：
  - `evaluator.ts`：AST → JS 值——节点分派表逐字实现（Array/Object 递归、字符串/无插值模板取字面值、数字/布尔/null、as const / satisfies / 括号解包、前缀负号取负；模板插值/标识符/属性访问/Shorthand/Spread/Getter 抛 `UnsupportedLiteralError` **含文件名+行号**）；每次操作新建一次性 Project，彻底规避陈旧 AST
  - `serializer.ts`：`valueToTsLiteral`（JSON 即合法 TS + 键去引号纯美化）
  - `syntax-check.ts`：`assertSyntaxValid`（ts.transpileModule reportDiagnostics，syntax error 必须为 0，错误含行号）
  - `file-lock.ts`：`Map<path, Promise>` 链——同一文件串行、不同文件并行
  - `value-cache.ts`：mtime+size 键读缓存；写管线第 8 步失效
  - `data-file.service.ts`：8 步写管线（顺序不可变）——读盘记哈希 → AST 求值 → 深拷贝变更（支持 async mutate）→ zod 整体校验（schema 由调用方传入，未传跳过）→ 序列化+语法校验 → 陈旧检测（整体重试 1 次，仍冲突 409）→ `BackupService.preWrite` 备份 → `.tmp-<nanoid>` + rename 原子写 → 缓存失效返回新值；所有路径过 safeJoin
  - `data-files.module.ts`：providers（FileLock/ValueCache/DataFileService）+ exports DataFileService（P4 注入）
- 初始化表达式替换采用 `initializer.replaceWithText()`（规格备选方案）：实测 `setInitializer` 对多行文本追加 10 空格缩进（合法但难看）；replaceWithText 精确替换节点区域，golden 字节断言前缀/后缀逐字节一致
- fixture：`test/fixtures/mizuki/` 假 Mizuki 项目定型（package.json 含 astro、astro.config.mjs、src/content/posts、src/types.ts 集中类型定义）；6 个数据文件覆盖块/行注释、单引号、尾随逗号、as const、satisfies、嵌套对象、字符串含引号换行、无插值模板、前缀负号、grouped 中文字符串键
- 修复：InfraBackupModule 补导出 `BACKUP_OPTIONS`（P3 新消费者 DataFileService 注入需要）
- 测试新增 2 文件 30 用例：golden 7（六文件往返 + 外部字节不变 + tsc --noEmit 可选集成）+ engine 23（5 类不支持节点含行号、支持语法不误伤、语法校验、陈旧 409×2、文件锁串行/并行、value-cache 命中/失效/写失效、pre_write 快照、原子写无残留、新文件首写、zod 失败不落盘、路径逃逸 403、getter 抛错）。全仓 101/101 绿

## P2 — 备份与恢复：唯一备份实现与 REST API

- `infra/backup/backup.service.ts`：全项目唯一备份实现转正——`preWriteBackup`（单文件前置快照，每文件保留最近 10 份自动清理）、`manualBackup`（full/data/content 集合备份，full = data ∪ content 见 ADR-003）、`dbBackup`（better-sqlite3 `.backup()` API）；manifest.json 记录每个文件原路径 + sha256 及元信息；`restore` 恢复前先做当前状态快照（可回滚）→ manifest 完整性逐文件 sha256 校验 → 文件原子回写（临时文件 + rename）/ db 用 `.backup()` 逆向写回；所有 Mizuki 根路径解析经 safeJoin（越界 403）；备份成功出口恰好一次发射 `backup.completed`
- `infra/backup/backup.module.ts`（新建）：`@Global() InfraBackupModule`，提供 `BACKUP_OPTIONS` 注入（mizukiRoot/backupDir/dbPath）并导出 BackupService 供后续阶段直接调用
- `modules/backup/backup.controller.ts` + `backup.module.ts`：REST 四路由转正——`POST /admin/backups`（scope ∈ full/data/content/db，文件类 scope → 记录层 manual；mizukiRoot 未配置 400）、`GET /admin/backups`（列表）、`POST /admin/backups/:id/restore`（必须 `confirm: true`，否则 400）、`DELETE /admin/backups/:id`（目录 + 记录同删）；body 一律过 ZodValidationPipe
- `app.module.ts`：imports 头部追加 InfraBackupModule（早于业务模块）
- db 恢复的记录重登记：db 文件整体回滚会丢失备份时刻之后写入的记录行（恢复前快照记录、被恢复备份自身记录），恢复完成后自动补录（磁盘产物未动）
- 测试新增 2 文件 27 用例：单测 14（备份→篡改→恢复→哈希一致 ×2、保留策略 11→10、manifest 完整性 ×2、db 备份恢复 + 快照可查、事件、路径逃逸 ×2、mizukiRoot 未配置、0 文件空备份、删除）+ e2e 13（四 scope 创建、列表、restore 400/200/404、DELETE、事件订阅者、未配置 400）。全仓 71/71 绿
- 新增 ADR-003（full scope 备份集合 = src/data/*.ts + src/content/**）

## P1 — 安全基建：路径监狱、zod 管道与全局防护

- `common/security/safe-join.ts`：路径监狱转正——`safeJoin`（resolve + 前缀校验，越界抛 `ForbiddenPathError`；空字节入口直接拒绝，URL 编码与 Windows 风格反斜杠做防御性复查）；`safeRealJoin` 在其上对已存在祖先链做 realpath 校验，防止 root 内符号链接把路径引到 root 之外（内部互指 symlink 放行）。全项目唯一合法路径入口（MASTER-PLAN §9 守则 4）
- `common/pipes/zod-validation.pipe.ts`：`ZodValidationPipe(schema)` 转正——`safeParse` 失败抛 `BadRequestException`，经统一过滤器输出 `{ code, message, detail }`，detail 携带 zod issues（字段路径 + 错误信息）；用法为路由级 `@UsePipes` 显式声明
- `app.setup.ts`：追加 helmet 默认安全头、CORS 白名单（默认仅 `http://localhost:20154`，端口沿用 `MIZUKI_SERVER_PORT` 环境变量逻辑；AppConfig 若声明 `corsOrigins` 字段将自动并入——当前 schema 无该字段，见 SESSIONS P1 偏差说明）、全局 zod 管道挂载点注释
- `app.module.ts`：`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])` + `APP_GUARD` 全局 `ThrottlerGuard`（60 次/分钟/IP；登录 5 次/分独立限流留待 P6）
- 测试新增 2 文件 27 用例：safe-join 攻击 9 条（`../`、绝对路径、多层穿越、`..\`、`%2e%2e%2f`、`..%5C`、混合编码、空字节×2）+ 正常 4 条 + realpath 防护 6 条；e2e 8 条（zod pipe 合法/非法、helmet 头、CORS 白名单/非白名单/预检、61 次限流 429）。全仓 44/44 绿
- 无新增依赖（helmet 8.3.0、@nestjs/throttler 6.5.0、zod 4.4.3 均在 P0a 清单内）

## P0b — 配置加载、数据库 11 表与统一异常

- `config/app-config.ts`：`data/config.json` zod 校验加载（非法即启动失败、错误含字段路径；缺省返回默认值），进程内单例 + pino 日志
- `infra/db/schema.ts`：Drizzle 定义全部 11 张表（逐字对齐 MASTER-PLAN §3）；`drizzle/0000_*.sql` 首个迁移由 drizzle-kit 生成
- `infra/db/migrate.ts` + `db.module.ts`：`runMigrations()` 幂等迁移（migrator 记账表处理见 ADR-002）；`@Global` DbModule 提供 better-sqlite3 / drizzle 双实例，启动自动迁移
- `common/filters/all-exceptions.filter.ts`：全局统一异常格式 `{ code, message, detail }`，未知异常对外固定「内部服务器错误」，堆栈仅入日志
- `packages/shared/src/events.ts`：事件目录骨架——6 个事件常量 + 各 payload zod schema（MASTER-PLAN §4.4 逐字）
- `common/logger.ts`：pino 共享日志实例（`MIZUKI_LOG_LEVEL` 控制级别）
- 根 `eslint.config.mjs`：eslint-plugin-boundaries 四层依赖规则（L0/L1/L2/L3），L2 互导禁止、L3 互通允许，error 级；配 `eslint-import-resolver-typescript` 解析 TS import
- 接线：`app.setup.ts` 挂全局过滤器；`app.module.ts` 注册 `EventEmitterModule.forRoot()` 与 DbModule
- 新增依赖：`@nestjs/event-emitter` 3.1.0、`pino` 10.3.1、`@types/better-sqlite3` 9.6.0、`eslint-plugin-boundaries` 7.2.0、`eslint-import-resolver-typescript` 4.4.5、shared 声明 `zod`（见 ADR-001 追加记录、ADR-002）
- 测试：5 个文件 17 用例全绿（迁移建表/幂等、config 三态、过滤器双单测、事件目录、health 回归 + 启动迁移断言）；分层拦截人工验证两轮（违规 import → lint error → 移除 → 恢复绿）

## P0a — 仓库骨架与可启动 NestJS 服务

- 初始化 pnpm monorepo（apps/server、apps/web、packages/shared）
- 建立 NestJS 服务端骨架，默认端口 `20154`，全局 API 前缀 `/api/v1`
- 实现 health 健康检查端点（`GET /api/v1/system/health`）
- 建立 stub 文件体系，按阶段 P0a–P11 标注（见各文件头注释）
- 文档占位：MASTER-PLAN / STRUCTURE / ADR / prompts 归档目录
