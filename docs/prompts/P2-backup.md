# 任务：备份与恢复（阶段 P2）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P2**，前置依赖阶段：**P1（安全基建）**。

本会话范围一句话：**实现唯一备份实现 `BackupService`（pre_write/manual/db 三种备份 + manifest + 恢复 + 保留策略）与备份 REST API 层**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。本服务是全项目唯一的备份实现，后续阶段（P3 写管线 pre_write、P5/P7 文件写入）一律调用它，不得另写备份逻辑。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§2 决策 3（统一写管线）与决策 6（pre-write 备份保持直接调用 infra/backup）、§3 `backup_record` 表、§4 分层（infra 属 L0）、§4.4 事件表 `backup.completed` 行、§5「Backup」路由清单、§7「备份」段
2. `docs/REQUIREMENTS.md`：§3 侵入式操作铁律（自动备份/可回滚）、§7 第 8 条（备份与回滚功能清单）、§9 第 9 条
3. `CHANGELOG.md`：P1 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/infra/backup/backup.service.ts`
   - `apps/server/src/modules/backup/backup.module.ts`
   - `apps/server/src/modules/backup/backup.controller.ts`
7. 已实现的前置件：`config/app-config.ts`（mizukiRoot/backupDir）、`infra/db/*`（DbModule、backup_record 表）、`common/security/safe-join.ts`（路径校验）、`packages/shared/src/events.ts`（EVENTS.BackupCompleted）

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/infra/backup/backup.service.ts`（[P2]）
- `apps/server/src/modules/backup/backup.module.ts`（[P2]）
- `apps/server/src/modules/backup/backup.controller.ts`（[P2]）

**本阶段允许新建的文件（仅限以下）**：

- `apps/server/src/infra/backup/backup.module.ts` — infra 层 @Global 模块，提供并导出 `BackupService` 供后续模块直接注入（MASTER-PLAN §2 决策 6）
- `apps/server/test/` 下本阶段测试文件

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`common/guards/jwt-auth.guard.ts`（P6）、`common/decorators/public.decorator.ts`（P6）、`common/interceptors/operation-log.interceptor.ts`（P6）、`modules/system/mizuki-detector.service.ts`（P6）、`modules/auth/*`（P6）、`modules/data-files/*`（P3）、`modules/collections/*`（P4）、`modules/posts/*`（P5）、`modules/articles/*`（P8）、`modules/albums/*`（P7）、`modules/media/*`（P7）、`modules/process/*`（P9）、`modules/settings/*`（P8）。

## 3. 详细规格

### 3.1 备份目录与 manifest（MASTER-PLAN §7 逐字）

- 备份目录：`data/backups/<时间戳-nanoid>/`（目录名形如 `20260825T120000-<nanoid>`，时间戳格式自定但须可排序）。
- 每次备份目录内含 `manifest.json`：**记录每个文件原路径 + sha256**；另含 `{ id, scope, createdAt, fileCount, sizeBytes, note? }` 元信息（与 `backup_record` 表一致）。
- 备份产物在目录内按相对路径镜像存放（恢复时按 manifest 回写原路径）。

### 3.2 三种备份类型（service 层 scope ∈ pre_write / manual / db）

1. **pre_write**：只备单个目标文件（写管线前置快照）。**每文件保留最近 10 份自动清理**——同一原路径的 pre_write 备份超过 10 份时删除最旧（含其 `backup_record` 行）。
2. **manual**：REST 触发的文件集合备份，目标集由 REST scope 参数决定（见 §3.4）；源路径必须经 `safeJoin(mizukiRoot, ...)` 校验。
3. **db**：数据库备份，用 **better-sqlite3 的 `.backup()` API**（不得直接复制正在写入的 db 文件）。

所有备份完成后写 `backup_record` 表（字段见 MASTER-PLAN §3：`id, scope(pre_write/manual/auto/db), manifest_path, file_count, size_bytes, note?, created_at`）。

> scope 口径说明（防歧义）：`backup_record.scope` 列枚举 `pre_write/manual/auto/db` 共 4 值（逐字搬自 MASTER-PLAN §3）；`auto` 为二期定时备份预留，本阶段不使用。REST 层 scope 参数与记录层 scope 的映射见 §3.4。

### 3.3 恢复

- `restore(backupId)`：
  1. **恢复前先对当前状态做一次备份**（对将被覆盖的现存文件执行一次 manual 备份，db 恢复前先做 db 备份）——保证可回滚；
  2. 校验 `manifest.json` 完整性（逐文件比对现存备份产物 sha256）；
  3. 回写：文件按 manifest 原路径覆盖（写入走临时文件+rename 原子方式）；db 恢复用 `.backup()` 逆向或等价安全方式（恢复前已备份，失败可回滚）；
  4. 恢复目标路径必须经 `safeJoin` 校验。
- REST 层恢复接口 **body 必须含 `confirm: true`**，缺失或不为真一律 400 拒绝。

### 3.4 REST API（MASTER-PLAN §5 逐字）

前缀 `/api/v1`。路由：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/backups` | 创建备份，body `{ scope, note? }`，`scope ∈ full/data/content/db` |
| GET | `/admin/backups` | 备份列表（来自 `backup_record`） |
| POST | `/admin/backups/:id/restore` | 恢复，**body 必须含 `confirm: true`** |
| DELETE | `/admin/backups/:id` | 删除备份（目录 + 记录） |

REST scope 语义与记录层映射（本阶段定型，偏差记 ADR）：

- `full`：备份整个 Mizuki 项目目录（内容数据文件 + 内容目录）→ 记录层 `scope: 'manual'`；
- `data`：仅备份 `src/data/*.ts` 数据文件 → 记录层 `scope: 'manual'`；
- `content`：仅备份 `src/content/` → 记录层 `scope: 'manual'`；
- `db`：数据库备份 → 记录层 `scope: 'db'`。

（mizukiRoot 未配置时创建备份返回 400 + 明确错误信息。）

### 3.5 事件（发射方，MASTER-PLAN §4.4 逐字）

`BackupService` 每次备份成功后发射（发射点位于备份成功出口，恰好一次、失败不发；发射前对 payload `parse`）：

- 事件：`EVENTS.BackupCompleted`（`'backup.completed'`）
- payload：`{ id, scope, fileCount }`（zod schema 已在 `packages/shared/src/events.ts` 定义，逐字使用）

订阅方（仪表盘备份状态）在 P10d 实现；本阶段只保证发射并用测试订阅者断言。

### 3.6 日志

关键写入步骤打日志（pino）：备份创建（scope/文件数）、保留策略清理、恢复开始/完成。

## 4. 接线说明

1. `infra/backup/backup.module.ts`：`@Global()`，providers + exports `BackupService`；`app.module.ts` imports 头部追加该模块（早于业务模块）。
2. `modules/backup/backup.module.ts`：controllers `BackupController`；`BackupModule` 已在 `app.module.ts` 注册（P0a 占位），本阶段只需填充。
3. `BackupService` 依赖注入：`DbModule` 提供的 drizzle 实例（写 `backup_record`）、`AppConfig`（mizukiRoot/backupDir）、`EventEmitter2`（发射事件）。
4. 所有文件路径经 `safeJoin`；禁止字符串字面量 emit/on（用 `EVENTS.BackupCompleted`）。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = §2 之外的 stub 不得接线；第 4 条 = 本阶段零新增依赖（nanoid/better-sqlite3 已在清单）。

**本阶段专属禁止**：

- 不得实现定时/自动备份（`auto` 仅预留枚举值）。
- 不得直接复制 `mizuki.db` 文件做 db 备份（必须 `.backup()`）。
- 测试不得触碰真实 Mizuki 目录；一律用临时目录构造假源文件。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行）：

1. **备份→篡改→恢复→哈希一致**：单测在临时目录——创建源文件 → `pre_write`/`manual` 备份 → 篡改源文件 → `restore` → 断言恢复后内容与原始一致（sha256 相同）。
2. **保留策略**：对同一文件连续创建 11 份 pre_write 备份，断言仅剩最近 **10 份**且最旧的目录与 `backup_record` 行均已删除。
3. **manifest 完整性**：备份后读取 `manifest.json`，断言每个条目含原路径 + sha256，且 sha256 与备份产物实际哈希一致。
4. **db 备份恢复**：临时 sqlite 库写入数据 → db 备份 → 改库 → 恢复 → 数据回到备份时刻状态；恢复前自动生成了新的当前状态备份（记录可查）。
5. **REST e2e**（supertest）：POST 创建（full/data/content/db 各一条）→ GET 列表含记录 → POST `:id/restore` 不带 `confirm: true` 返回 400、带 `confirm: true` 成功 → DELETE 删除后列表不再包含。
6. **事件断言**：测试订阅者（`@nestjs/event-emitter` 的 `@OnEvent`）断言备份成功后收到 `backup.completed`，payload 含 `id/scope/fileCount` 且通过 `BackupCompletedPayload.parse`。
7. **路径防护**：源路径尝试逃逸 mizukiRoot（`../`）时备份接口拒绝（400/403，经 safeJoin）。
8. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（上述 7 项合计 ≥12 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 偏差清单：理想为空；REST scope→记录层 scope 映射、备份目录时间戳格式等实现取舍若与规格有出入须列出并记 ADR。
4. `CHANGELOG.md` 追加 P2 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
