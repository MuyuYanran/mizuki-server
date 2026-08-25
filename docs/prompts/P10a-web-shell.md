# 任务：管理面板外壳 — 工程、登录、布局与请求层（阶段 P10a）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P10a**，前置依赖阶段：**P9（进程管理）**。

本会话范围一句话：**搭建 `apps/web` 管理面板（Vue 3 + Element Plus + Vite）——登录页、初始化向导页、主布局与侧边栏导航、路由守卫、带 401 自动 refresh 的请求封装**。

只做本阶段：本阶段只交付面板外壳与认证链路，六类集合页、文章编辑、媒体/备份/控制台分别在 P10b/P10c/P10d 实现；后端代码原则上不动（仅允许的例外见 §2）。

> 技术栈（锁定）：Vue 3 + Element Plus + vue-router；与后端经 **`/api/v1`** 同源通信（MASTER-PLAN §1：管理面板与 API 同源，端口 20154）。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§1（面板同源、端口 20154、前缀 /api/v1）、§5「Auth」「System」路由清单、§8 路线图 P10 行
2. `docs/REQUIREMENTS.md`：**§7 第 1 条（初始化向导流程，逐字依据）**、§2.1（本地面板形态）、§8（认证行为）
3. `CHANGELOG.md`：P9 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 前端现状：`apps/web/package.json`（最小占位，名 `@mizuki/web`）、`apps/web/README.md`
7. 后端契约（已实现）：`POST /admin/auth/login|refresh|logout`、`GET /admin/auth/me`、`GET /system/health`、`GET /system/status`、`POST /system/detect`、`POST /system/init`（源码在 `apps/server/src/modules/auth/` 与 `modules/system/`，只读参考）

## 2. 实现文件清单

`apps/web` 当前仅占位（无 stub 可转正），本阶段**新建**以下内容：

- `apps/web/` 完整 Vite + Vue 3 + TypeScript 工程：`index.html`、`vite.config.ts`、`tsconfig.json`、`src/main.ts`、`src/App.vue`、`src/env.d.ts`
- `src/router/` — 路由表与守卫（登录页、初始化向导页、主布局及其子路由占位）
- `src/views/LoginView.vue`、`src/views/InitWizardView.vue`、`src/views/DashboardPlaceholder.vue`（仪表盘占位，P10d 实现）
- `src/layouts/MainLayout.vue` — 主布局 + 侧边栏导航（菜单项：仪表盘 / 文章 / 日记 / 友链 / 项目 / 时间线 / 技能 / 设备 / 相册 / 媒体库 / 备份 / 构建预览 / 设置；非本阶段实现的页面指向占位路由）
- `src/api/` — 请求封装（axios 或 fetch 包装 + 401 自动 refresh）与 auth/system 端点客户端
- `src/stores/` 或组合式函数 — token 存取与登录态
- 其余子页面占位组件（`src/views/PlaceholderView.vue` 单组件复用）

**允许修改的既有文件**：`apps/web/package.json`（填充依赖与脚本）、`apps/web/README.md`、根 `pnpm-workspace.yaml`（如需）。

**后端例外（仅当必要时）**：为面板开发体验，可在 `apps/web/vite.config.ts` 配置 dev 代理指向 `http://localhost:20154`（纯前端配置，不改后端代码）。

**禁止触碰**：`apps/server/` 下任何源码文件（发现后端契约缺陷 → 停下报告，按 §8 处理，不得顺手改后端）。

## 3. 详细规格

### 3.1 工程基线

- Vite + Vue 3（`<script setup>` + Composition API）+ TypeScript strict；Element Plus（完整引入或按需，取简者，记报告）。
- 脚本：`dev`（vite dev，端口自定避免与 20154 冲突）、`build`（`vue-tsc --noEmit && vite build`）、`preview`、`lint`（复用根 eslint，vue 插件按需新增——新增依赖记入 ADR-001）。
- dev 代理：`/api` → `http://localhost:20154`；生产同源（面板静态产物最终由后端或同域托管，本阶段仅约定路径前缀 `/api/v1`）。

### 3.2 登录页

- 表单（username + password）→ `POST /api/v1/admin/auth/login` → 存 `{ accessToken, refreshToken }`（localStorage）→ 跳主布局。
- 错误处理：401 显示「用户名或密码错误」；423/锁定信息显示锁定提示；429 显示限流提示。
- 登录成功后 `GET /admin/auth/me` 拉取管理员信息供布局展示。

### 3.3 初始化向导页（REQUIREMENTS §7 第 1 条逐字流程）

欢迎 → 选择 Mizuki 目录（输入路径，`POST /system/detect` 检测并**展示每项检查明细**）→ 选择运行模式（仅管理/新增文件接入/覆盖文件接入，对应 `manage/additive/overwrite`，展示模式说明）→ 设置管理员账号（用户名 + 密码 + 确认）→ `POST /system/init` 完成 → 跳登录页。

- 已初始化（init 409）→ 提示并跳登录。
- 登录页检测「未初始化」状态：**经 `GET /system/health` 的 `initialized` 字段判断（P6 §3.2），`false` 时引导至向导页**。

### 3.4 路由守卫

- 白名单：`/login`、`/init`；其余路由无 accessToken 一律重定向 `/login`。
- 已登录访问 `/login` 重定向主页。

### 3.5 请求封装（401 自动 refresh，硬性）

- 统一请求层：所有请求自动附 `Authorization: Bearer <accessToken>`；响应 401 时**自动调用 `POST /admin/auth/refresh` 换取新 Token 对并重放原请求一次**；refresh 失败 → 清空本地 token → 重定向 `/login`。
- 并发 401 只触发一次 refresh（进行中的 refresh 共享同一 Promise）。
- 响应解析适配后端统一异常格式 `{ code, message, detail }`：非 2xx 向调用方抛出含 `message` 的错误。

### 3.6 主布局与导航

- Element Plus 容器布局：顶栏（项目名 + 管理员 + 登出）+ 侧边栏菜单（§2 菜单项）+ 内容区 `<router-view>`。
- 登出：`POST /admin/auth/logout` + 清本地态 + 回登录页。

## 4. 接线说明

1. 根 `pnpm build`（`pnpm -r build`）将包含 `apps/web` 构建——确保 web 的 build 脚本兼容（`vue-tsc` 可用）。
2. 根 `pnpm lint` 需覆盖（或显式排除）web 目录：新增 `eslint-plugin-vue` 等配置写入根 `eslint.config.mjs`（新增依赖记 ADR-001）。
3. 所有 API 调用只经 `src/api/` 封装，禁止组件内裸写 URL 字符串（常量集中管理）。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1/2 条 = 只建 §2 清单内文件，六类集合页/文章编辑/媒体/备份/控制台一律占位，**哪怕看起来“顺手就能写完”也禁止实现**；第 3 条 = 不得改动后端任何接线；第 4 条 = 前端依赖新增（vue 系 + eslint vue 插件）须记入 ADR-001 表格。

**本阶段专属禁止**：

- **前端绕过 `/api/v1` 直接操作文件**（前端没有任何文件系统访问——禁止任何形式的本地文件读写企图，包括借助后端未授权端点）。
- **在任何前端代码中出现 secret**（JWT secret、密码明文常量等一律禁止；密码仅在表单中作为输入传输）。
- 不得把 refreshToken 附加到普通请求头（只有 refresh 调用使用它）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

（`pnpm test` = 服务端既有用例全绿回归；`pnpm build` 含 `apps/web` 的 `vue-tsc + vite build`。）

随后逐项：

1. **构建与类型**：`pnpm --filter @mizuki/web build` 成功（strict 类型检查通过）；产物 `apps/web/dist/` 生成。
2. **登录链路（手动）**：启动后端（先经 `POST /system/init` 初始化）→ `pnpm --filter @mizuki/web dev` → 浏览器访问 → 错误密码显示错误提示 → 正确密码进入主布局，侧边栏菜单完整（§3.6 清单）。
3. **路由守卫（手动）**：未登录访问主页 → 跳 `/login`；登录后刷新仍保持登录态。
4. **401 自动 refresh（手动 + 代码断言）**：手动清空 localStorage 中 accessToken（保留 refreshToken）→ 触发任一需认证请求 → 观察请求先 401 后自动 refresh 成功并完成（浏览器网络面板两次请求）；代码审查断言并发去重逻辑存在（同一时刻仅一个 refresh 调用）。
5. **初始化向导（手动）**：空库启动后端 → 面板引导进入向导 → 输入假项目路径检测展示四项明细 → 选模式 → 建管理员 → 完成跳登录；二次访问向导接口 409 被正确提示。
6. **回归**：P0a–P9 服务端用例全绿；根 `pnpm lint` 通过。

## 7. 交付报告要求

1. 文件清单：新建/修改的全部文件路径（前端工程树）。
2. 新增前端依赖版本表（追加 ADR-001）。
3. §6 各项逐条结果（手动项附操作摘要）。
4. 偏差清单与疑问清单（含「未初始化状态检测方式」「Element Plus 引入方式」等取舍）。
5. `CHANGELOG.md` 追加 P10a 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
