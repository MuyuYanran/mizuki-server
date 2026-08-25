# 任务：进程管理 — 白名单子进程与 SSE 日志（阶段 P9）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P9**，前置依赖阶段：**P8（富文本 + 公开 API）**。

本会话范围一句话：**实现 process 模块——任务白名单（install/dev/build/preview）、cross-spawn `shell:false` 子进程、进程组停止、内存环形缓冲日志 + SSE 实时推送、端口占用检测，并发射 `process.finished` 事件**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：**§7「进程」段（逐字依据）**、§5「Process」路由清单、§4.4 事件表 `process.finished` 行、§4 分层（process 属 L3）
2. `docs/REQUIREMENTS.md`：§2.3（构建、预览、进程管理）、§7 第 9 条（构建与预览功能清单）、§9 第 4 条（命令安全）
3. `CHANGELOG.md`：P8 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：**`@types/tree-kill` 已移除——tree-kill@1.2.2 自带类型，不得引用也不得新增该包**
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/modules/process/process.module.ts`
   - `apps/server/src/modules/process/process.controller.ts`
   - `apps/server/src/modules/process/process-manager.service.ts`
7. 已实现的前置件：`config/app-config.ts`（mizukiRoot）、P6 守卫（本模块路由需认证）、`packages/shared/src/events.ts`（EVENTS.ProcessFinished）

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/modules/process/process.module.ts`（[P9]）
- `apps/server/src/modules/process/process.controller.ts`（[P9]）
- `apps/server/src/modules/process/process-manager.service.ts`（[P9]）

**本阶段允许新建的文件（仅限以下）**：

- `apps/server/test/` 下本阶段测试文件
- 如需一个可运行的最小子项目用于测试（含 `package.json` 与极简脚本），放 `apps/server/test/fixtures/mini-project/`（不得复用假 Mizuki 项目执行真实构建——避免拖慢测试；若复用，须给出理由）

**本阶段允许修改的既有实现文件（仅限以下）**：

- `apps/server/src/main.ts` —— **仅追加 `app.enableShutdownHooks()`**（在 `configureApp(app)` 之后、`listen` 之前），为 §3.4b 优雅停机提供信号入口；不得改动其他内容。

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

无剩余后端 stub——`modules/settings/*` 已在 P8 实现。除 §2 明列外不得修改任何既有业务文件。

## 3. 详细规格

### 3.1 任务白名单（逐字，硬编码）

任务白名单硬编码：`install / dev / build / preview` 四项。**禁止任何形式的命令字符串拼接**；`task` 不在白名单 → 400。

每个任务的执行参数映射（基于检测到的包管理器 PM ∈ pnpm/yarn/npm，逐字固定，不得接受用户附加参数）：

| task | 命令 | args |
|---|---|---|
| install | PM | `install`（yarn 为无参 `yarn`——按包管理器习惯，取舍记报告） |
| dev | PM | `run dev` |
| build | PM | `run build` |
| preview | PM | `run preview` |

### 3.2 spawn 规格（MASTER-PLAN §7 逐字）

- 包管理器按 **lockfile 探测**（沿用 P6 detector 逻辑：`pnpm-lock.yaml`/`yarn.lock`/`package-lock.json`；工作目录即 mizukiRoot）。
- **cross-spawn 且 `shell: false`**（命令注入的根防线；Windows 下 `npm.cmd` 由 cross-spawn 解析）。
- **env 只透传 `PATH / HOME / APPDATA`**（其余环境变量一律不透传）。
- **POSIX 用 detached 进程组**（`detached: true` 仅 POSIX；Windows 按平台行为记录取舍）；**停止用 tree-kill 停整组**（`tree-kill(pid)`，Windows 下 tree-kill 同样适用）。
- 工作目录锁定为 `mizukiRoot`（经 `safeJoin` 校验）；未配置 mizukiRoot → 400。

### 3.3 日志：内存环形缓冲 + SSE

- 每个任务实例维护**内存环形缓冲（最近 2000 行）**，合并 stdout/stderr（stderr 标记来源）；超过 2000 行丢弃最旧。
- `GET /admin/process/tasks/:id/logs`（SSE，`@Sse()`）：先回放缓冲内已有日志，再实时推送新行；事件格式 `{ type: 'log' | 'exit', line?, exitCode? }`（最小约定，细节记报告）。
- 服务重启不保留日志（内存态）。

### 3.4 任务生命周期与端口检测

- `POST /admin/process/tasks`：`{ task }` → 创建任务实例（id = nanoid），spawn 子进程，返回 `{ id, task, status: 'running', pid }`。
- 任务表（内存 `Map<id, TaskInstance>`）：记录 task、pid、status（running/exited/killed）、exitCode、startedAt、finishedAt、日志缓冲。
- `GET /admin/process/tasks/:id`：状态与退出码。
- `DELETE /admin/process/tasks/:id`：tree-kill 停止整组 → status `killed`。
- `GET /admin/process/ports/:port`：**端口占用检测**——尝试绑定/探测该端口，返回 `{ port, inUse: boolean, byCurrentTask?: taskId }`（实现取 `net.createServer().listen` 探测法，取舍记报告）。
- 子进程退出（自然或异常）→ 更新状态、发射 `process.finished`。

### 3.4b 优雅停机（onApplicationShutdown）

- `ProcessManagerService` 实现 `OnApplicationShutdown`：收到 **SIGTERM / SIGINT**（经 `main.ts` 的 `app.enableShutdownHooks()` 传入）时：
  1. 对**全部 running 任务**执行 `tree-kill` 停整组；
  2. 等待子进程退出，**5 秒超时仍未退出则强杀**（再次 tree-kill / SIGKILL 语义）；
  3. **关闭全部 SSE 连接**（向已连接客户端发送结束事件后 `complete()`），停止日志转发；
  4. 清理全部内部**定时器**与事件监听（不得泄漏）。
- 停机完成后任务表全部置为终态（killed），pino 记录停机摘要（停止任务数 / 超时强杀数）。

### 3.5 事件（发射方，MASTER-PLAN §4.4 逐字）

- **`process.finished`**（EVENTS.ProcessFinished）：子进程退出（自然退出、异常退出、被 kill）后发射。
- payload：`{ task: string, exitCode: number, durationMs: number }`（zod schema 在 `packages/shared/src/events.ts`，逐字使用；被 kill 场景 `exitCode` 用实际退出码或约定负值，记报告）。
- 发射前 `ProcessFinishedPayload.parse`；恰好一次、失败不发；禁止字符串字面量。
- 订阅方（仪表盘/构建通知）在 P10d 及以后；本阶段用测试订阅者断言。

### 3.6 REST API（MASTER-PLAN §5 逐字，全部需认证）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/process/tasks` | task ∈ `install/dev/build/preview` 白名单 |
| GET | `/admin/process/tasks/:id` | 任务状态 |
| DELETE | `/admin/process/tasks/:id` | 停止 |
| GET | `/admin/process/tasks/:id/logs` | SSE 日志流 |
| GET | `/admin/process/ports/:port` | 端口占用检测 |

### 3.7 日志（服务端）

pino 记录：任务启动（task/pid/包管理器）、退出（exitCode/时长）、kill、端口检测结果。

## 4. 接线说明

1. `process.module.ts`：controllers `ProcessController`，providers `ProcessManagerService`。`ProcessModule` 已在 `app.module.ts` 注册（P0a 占位），本阶段填充。
2. 依赖注入：`AppConfig`（mizukiRoot）、`EventEmitter2`。
3. SSE：Nest 原生 `@Sse()` 装饰器（MASTER-PLAN §1 技术栈）；连接断开时清理订阅（不得泄漏定时器/观察者）。
4. 优雅停机：`main.ts` 追加 `app.enableShutdownHooks()`（§2 允许的唯一既有文件改动），`ProcessManagerService` 经 `OnApplicationShutdown` 响应（§3.4b）。
5. 分层自检：process（L3）只依赖 L0。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他一律保持原状；第 3 条 = 本阶段接线仅限 §2/§4 明列；第 4 条 = 本阶段零新增依赖（cross-spawn/tree-kill 已在清单，且 **`@types/tree-kill` 已随 P0a 勘误移除，不得重新引入**）。

**本阶段专属禁止**：

- **`shell: true`、任何形式的命令字符串拼接**（命令注入根防线，硬性）。
- 不得接受用户传入的任意命令/参数/环境变量（白名单外一切拒绝）。
- 测试不得对真实 Mizuki 目录执行任何子进程任务。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行）：

1. **启停 + SSE（标 slow）**：对 fixture 小项目（或最小自造子项目）启动 `dev` 类任务 → 断言 SSE 连接收到 ≥1 条日志事件 → `DELETE /admin/process/tasks/:id` 停止 → 断言进程退出且 `GET /admin/process/tasks/:id` 显示非 running 状态。该用例标注 `slow`（vitest 放宽超时）。
2. **优雅停机（标 slow）**：启动 `dev` 任务 → 向服务进程发送 **SIGTERM** → 断言子进程全部退出、端口释放、无孤儿进程（按 pid/进程组探测确认，如 `process.kill(pid, 0)` 抛错即视为已退出）。
3. **白名单拒绝**：`POST /admin/process/tasks` 传 `task: 'install;rm -rf /'` → 400；传 `'shell'`/`'arbitrary'` → 400；白名单四项各 200（或可执行状态）。
4. **`process.finished` 事件发射断言**：测试订阅者——任务自然退出后收到事件，payload 过 `ProcessFinishedPayload.parse` 且 `{ task, exitCode, durationMs }` 完整；被 kill 场景同样发射。
5. **环形缓冲**：让任务输出 >2000 行（脚本循环打印），断言缓冲长度 ≤2000 且保留最新行。
6. **端口检测**：`/admin/process/ports/:port` 对已占用端口（可先起一个监听）返回 `inUse: true`，对空闲端口 `inUse: false`。
7. **安全断言（代码级）**：单测/代码审查断言——spawn 调用 `shell` 参数为 `false`（可用包装层断言或 mock 记录）；env 仅含 `PATH/HOME/APPDATA`（白名单断言）。
8. **回归**：P0a–P8 既有用例全绿。
9. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（合计 ≥13 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径。
2. 测试结果：`pnpm test` 用例数与通过数（含 slow 用例时长）；§6 各项逐条结果。
3. 偏差清单：理想为空；`yarn install` 无参写法、Windows detached 行为、kill 场景退出码约定、端口探测实现须显式列出，必要处记 ADR。
4. `CHANGELOG.md` 追加 P9 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
