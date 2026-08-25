# 任务：认证与初始化向导（阶段 P6）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P6**，前置依赖阶段：**P5（Posts）**。

本会话范围一句话：**实现 auth 模块（argon2id + jose HS256 双 Token）、全局 JWT 守卫与 @Public 豁免、登录限流与失败锁定、操作日志拦截器、Mizuki 项目检测服务与一次性初始化向导，并为既有全部 admin 路由挂上守卫**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。本阶段是人工关卡（安全边界定型），完成后等待人工确认。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：**§4.1**（全局守卫策略）、**§4.3**（Mizuki 项目检测规则，四项检查）、§3 `admin_user` / `operation_log` 表、§5「System」「Auth」路由清单、§9 守则
2. `docs/REQUIREMENTS.md`：**§7 第 1 条**（初始化向导流程）、§8（用户与权限：认证细节）、§3（三模式）、§9 安全需求
3. `CHANGELOG.md`：P5 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/modules/auth/auth.module.ts`、`auth.controller.ts`、`auth.service.ts`（[P6]）
   - `apps/server/src/common/guards/jwt-auth.guard.ts`（[P6]）
   - `apps/server/src/common/decorators/public.decorator.ts`（[P6]）
   - `apps/server/src/common/interceptors/operation-log.interceptor.ts`（[P6]）
   - `apps/server/src/modules/system/mizuki-detector.service.ts`（[P6]）
7. 已实现的前置件：`config/app-config.ts`（含 mode 枚举）、`infra/db`（admin_user/operation_log 表）、`common/filters`（统一异常）、`common/security/safe-join.ts`

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/modules/auth/auth.module.ts`（[P6]）
- `apps/server/src/modules/auth/auth.controller.ts`（[P6]）
- `apps/server/src/modules/auth/auth.service.ts`（[P6]）
- `apps/server/src/common/guards/jwt-auth.guard.ts`（[P6]）
- `apps/server/src/common/decorators/public.decorator.ts`（[P6]）
- `apps/server/src/common/interceptors/operation-log.interceptor.ts`（[P6]）
- `apps/server/src/modules/system/mizuki-detector.service.ts`（[P6]）

**本阶段允许修改的既有实现文件**：

- `apps/server/src/modules/system/system.controller.ts`（扩展：`POST /system/detect`、`POST /system/init`、`GET /system/status`；health 标 @Public）
- `apps/server/src/app.setup.ts`（挂全局操作日志拦截器——守卫经 APP_GUARD 走模块注入，见 §4）
- `apps/server/src/app.module.ts`（注册 AuthModule 已有占位；追加 APP_GUARD provider）

**本阶段允许新建的文件**：

- `apps/server/test/` 下本阶段测试文件

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`modules/articles/*`（P8）、`modules/albums/*`（P7）、`modules/media/*`（P7）、`modules/process/*`（P9）、`modules/settings/*`（P8）。

## 3. 详细规格

### 3.1 Auth 核心（argon2 + jose HS256 双 Token）

- 密码：**argon2id** 哈希（`argon2.hash` 指定 type argon2id），校验用 `argon2.verify`。
- Token：**jose HS256** 双 Token：
  - `accessToken`：短时效（默认 15 分钟）；`refreshToken`：长时效（默认 7 天）。
  - claims：`sub`（admin id）、`username`、`type: 'access' | 'refresh'`、`jti`（nanoid）、`iat/exp`。
  - 支持过期与刷新：`POST /admin/auth/refresh` 校验 refresh token 有效后签发新的一对（轮换）。
  - **JWT secret 从 config/env 读取**：优先环境变量 `MIZUKI_JWT_SECRET`；缺失时自动生成强随机密钥并持久化到 `data/config.json`（字段 `jwtSecret`，加入 `AppConfigSchema` 可选字段），保证重启后 refresh token 仍有效。该取舍写入交付报告疑问清单。
- `logout`：无状态实现——返回 200 即可（客户端清除 token；服务端不维护黑名单），取舍写入交付报告。

### 3.2 REST API（MASTER-PLAN §5 逐字）

**Auth（公开）**：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/auth/login` | → `{ accessToken, refreshToken }` |
| POST | `/admin/auth/refresh` | 刷新 Token 对 |
| POST | `/admin/auth/logout` | 登出 |
| GET | `/admin/auth/me` | 当前管理员信息（需 access token） |

**System（部分公开）**：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/health` | P0a 已实现，标 @Public；**本阶段扩展响应增加 `initialized: boolean`（`admin_user` 表是否存在行）** |
| GET | `/system/status` | 服务状态（已初始化/版本/运行模式），需认证 |
| POST | `/system/detect` | Mizuki 目录检测，@Public |
| POST | `/system/init` | 初始化，**仅未初始化时可用一次**，@Public |
| GET | `/admin/system/logs` | **规格补白**：`operation_log` 分页读取（`?page=&limit=`，`created_at` 倒序），需认证。MASTER-PLAN §5 未列此端点，为本阶段补白（处理方式同 P8 settings 路径），纳入交付报告疑问清单 |

### 3.3 全局守卫与 @Public 豁免（MASTER-PLAN §4.1）

- `JwtAuthGuard` 经 `APP_GUARD` **全局注册**，除 `@Public()` 路由外全部需要 Token（校验 `Authorization: Bearer <accessToken>`）。
- `@Public()` 装饰器：`SetMetadata` 标记；豁免清单（逐字）：**`/public/**`、`/system/health`、`/admin/auth/login`、`/admin/auth/refresh`、`/system/detect`、`/system/init`**（`/public/**` 尚无路由，P8 落地）。
- **登录限流**：`/admin/auth/login` 路由级限流 **5 次/分钟**（P1 全局 60 次/分之外的独立严格限流，`@Throttle` 覆盖）。
- **失败锁定**：登录失败 `failed_login_count` +1；达到 **5 次**置 `locked_until = now + 15 分钟`（锁定值写入交付报告）；锁定期内即使密码正确也拒绝（423 或 401 + 明确锁定信息）；成功登录清零 `failed_login_count` 并更新 `last_login_at`。

### 3.4 初始化向导（`POST /system/init`，REQUIREMENTS §7 第 1 条）

- 入参（zod）：`{ mizukiRoot, mode: 'manage'|'additive'|'overwrite', username, password }`。
- 流程：`mizukiRoot` 经 detector 检测（§3.5），无效 → 400 附检查明细；有效则创建管理员（argon2id 哈希）+ 更新 `config.json`（mizukiRoot/mode/jwtSecret 生成）。
- **一次性**：`admin_user` 表已有行 → **409**。
- SQLite 自动创建（P0b 已实现），无需用户配置数据库。

### 3.5 Mizuki 项目检测（MASTER-PLAN §4.3 逐字）

给定路径 P，判定为 Mizuki 项目需**同时满足**：

1. `P/package.json` 存在且 `dependencies/devDependencies` 含 `astro`；
2. `P/astro.config.{mjs,ts,js}` 存在；
3. `P/src/data/` 存在且至少含 `diary.ts / friends.ts` 之一；
4. `P/src/content/posts/` 存在。

返回 `{ valid, checks: [...每项明细], packageManager: 'pnpm|yarn|npm'（按 lockfile 探测） }`。包管理器探测：`pnpm-lock.yaml` → pnpm；`yarn.lock` → yarn；`package-lock.json` → npm（均无时给默认值并在 checks 中注明）。

### 3.6 操作日志拦截器（`operation-log.interceptor.ts`）

- 全局拦截器，对**管理端写操作**（POST/PATCH/DELETE，`/admin/**`）写 `operation_log` 表：`id, user_id?, method, path, action, target, detail(脱敏 JSON 文本), ip, created_at`。
- **脱敏（硬性）**：`detail` 中不得出现密码、token、authorization 头——对 body 键（`password`、`token`、`accessToken`、`refreshToken`、`secret` 等）与请求头做掩码（如 `"***"`）。
- 异步写入失败仅记日志（pino），不影响响应。

### 3.7 日志

pino 记录：登录成功/失败（不含密码）、锁定、init 完成、守卫拒绝（不泄露 token 内容）。

## 4. 接线说明

1. `app.module.ts`：providers 追加 `{ provide: APP_GUARD, useClass: JwtAuthGuard }`（与 P1 的 `ThrottlerGuard` 共存，注意顺序：限流先于认证）；`AuthModule` 填充后生效。
2. `AuthModule`：providers `AuthService`、`MizukiDetectorService` 归 `SystemModule`（detector 被 system.controller 与 init 流程使用，经 `SystemModule` exports 或放入共享位置——归 system 模块，auth 经模块 import 使用，注意分层：auth/system 同属 L3，允许）。
3. `app.setup.ts`：`useGlobalInterceptors(OperationLogInterceptor)`。
4. `SystemController` 扩展按 §3.2；`@Public()` 标注豁免路由。
5. 配置扩展：`AppConfigSchema` 追加可选字段 `jwtSecret?: string`（更新 P0b 的 schema 与 ADR 记录）。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = 本阶段的核心工作正是接线（§2 内的文件），§2 之外的 stub 仍不得接线；第 4 条 = 本阶段零新增依赖（jose/argon2/@nestjs/throttler 已在清单）。

**本阶段专属禁止**：

- **secret 硬编码或写入任何日志**（JWT secret、密码、token 一律不得出现在日志/响应/测试快照中）。
- 不得修改 P1 的全局限流值；登录 5 次/分为路由级独立限流。
- 不得为测试方便放宽守卫豁免清单。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行，e2e 用 supertest）：

1. **既有全部 admin 路由挂守卫（跨阶段一致性验收项）**：对每个已含 admin 路由的模块（collections、posts、backup）各至少一条断言——不带 Token 访问返回 **401**；`GET /admin/auth/me` 无 Token 401、带有效 access token 200。
2. **登录流程**：init 创建管理员 → login 正确凭据 → 返回 `{accessToken, refreshToken}` → me 通过；错误密码 → 401 且 `failed_login_count` +1。
3. **失败锁定**：连续 5 次错误密码后，第 6 次即使密码正确也被拒（锁定）；`locked_until` 落库非空。
4. **登录限流**：路由级 5 次/分——连续 6 次登录请求（含失败）第 6 次返回 429（窗口可调小，断言语义不变）。
5. **刷新与过期**：refresh token 换新对成功；篡改/过期 access token → 401。
6. **init 一次性**：第一次 200/201；第二次（即使凭据不同）→ **409**。
7. **detector 正反用例**：正——假项目（fixture）返回 `valid: true` + 4 项 checks 全通过 + `packageManager` 与放置的 lockfile 一致；反——分别缺 astro 依赖/缺 astro.config/缺 src/data/缺 posts 四个用例，各返回 `valid: false` 且对应 check 为失败。
8. **@Public 豁免**：`/system/health`、`/system/detect` 无 Token 可访问；`/system/status` 无 Token 401；**health 响应含 `initialized` 字段——init 前为 `false`、init 后为 `true`**。
9. **操作日志脱敏**：登录请求后 `operation_log` 有记录（或登出等管理写操作），断言 `detail` 不含密码明文与 token 值（含 `"password"` 键已被掩码）。
10. **日志读取端点**：`GET /admin/system/logs` 无 Token 401；带 Token 返回分页记录（`?page=&limit=`，`created_at` 倒序，含上一步产生的记录）。
11. **回归**：P0a–P5 既有用例全绿（注意：既有 e2e 需适配守卫——测试内先 init+login 拿 token，或为测试注入豁免，适配方式写入交付报告）。
12. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（合计 ≥20 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 疑问清单（不得静默决定的取舍在此声明）：JWT secret 持久化策略、锁定阈值/时长（5 次/15 分钟）、logout 无状态实现、既有测试的守卫适配方式、**`GET /admin/system/logs` 端点（规格补白，MASTER-PLAN §5 未列，处理方式同 P8 settings）**。
4. `CHANGELOG.md` 追加 P6 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
