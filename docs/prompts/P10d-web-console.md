# 任务：管理面板 — 媒体/相册/备份/构建控制台/仪表盘（阶段 P10d）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P10d**，前置依赖阶段：**P10c（文章模块）**。

本会话范围一句话：**实现面板剩余模块——媒体库、相册管理、备份与恢复 UI、构建预览控制台（SSE 日志终端）、仪表盘统计卡片、设置管理页，并打通六类内容的图片上传；可选实现 `GET /admin/events` SSE 事件转发（做不做记 ADR）**。

只做本阶段：本阶段是面板的最后一块；完成后进入 P11 收尾。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§5「Media」「Albums」「Backup」「Process」路由清单、§4.4 事件表全部六事件（仪表盘实时刷新的数据源）、§8 路线图 P10 行（手动场景清单走通）
2. `docs/REQUIREMENTS.md`：**§7**（后台管理功能清单——第 2 条仪表盘、第 7 条文件与媒体管理、第 8 条备份与回滚、第 9 条构建与预览，逐条对照）、§6.9（相册 info.json 表单字段）
3. `CHANGELOG.md`：P10c 条目（最近一条）
4. `docs/decisions/` 全部 ADR
5. `docs/SESSIONS.md` 最近记录（如有）
6. 后端契约（只读参考）：`modules/{media, albums, backup, process}`（P7/P2/P9）、`packages/shared/src/events.ts`（六事件常量）

## 2. 实现文件清单

`apps/web` 下**新建**：

- `src/views/media/MediaLibraryPage.vue` — 媒体库（网格列表 + 上传 + 删除带引用明细）
- `src/views/albums/AlbumsPage.vue`、`src/views/albums/AlbumDetailPage.vue` — 相册列表与详情（图片管理 + info.json 表单）
- `src/views/backups/BackupsPage.vue` — 备份列表/创建/恢复/删除
- `src/views/process/ConsolePage.vue` — 构建预览控制台（任务启停 + SSE 日志终端 + 端口检测）
- `src/views/DashboardPage.vue` — 仪表盘（统计卡片 + 最近操作日志，替换 P10a 占位）
- `src/views/settings/SettingsPage.vue` — 设置管理页（站点/主题/导航/社交链接/功能开关/服务参数，见 §3.6）
- `src/api/{media,albums,backups,process,dashboard,settings}.ts` — 端点客户端
- `src/components/` — 图片上传组件（六类内容页复用的上传控件）、引用明细对话框、日志终端组件
- 路由与菜单接入（替换全部剩余占位）

**允许修改**：`apps/web/src/router/`、`src/layouts/MainLayout.vue`、`src/views/collections/` 与 `src/views/posts/`（仅为接入图片上传组件与预留插槽，不改既有交互语义）、`apps/web/package.json`（如需 SSE/终端渲染辅助，记 ADR-001）。

**后端例外（仅一处，可选）**：`GET /admin/events` SSE 转发事件总线——若实现，在 `apps/server/src/modules/system/` 或独立控制器内新增该端点（`@Public` 豁免之外，需认证），这是本阶段唯一允许的后端新增；**做不做、怎么做都必须记 ADR**。

**禁止触碰**：其余 `apps/server/` 源码。

## 3. 详细规格

### 3.1 媒体库（REQUIREMENTS §7 第 7 条）

- 网格展示 `GET /admin/media`：缩略图（相对路径拼静态地址或经后端静态服务——取可用者，记报告）、原名、尺寸、大小。
- 上传：多选 → `POST /admin/media`（进度提示）；后端 400（魔数拒绝）/413（超限）给出明确提示。
- 删除：二次确认 → 后端 409 时**展示引用明细**（`refType` + `targetLabel` 列表）。
- 链接复制：复制媒体相对路径到剪贴板（供内容页图片字段粘贴）。

### 3.2 相册（§6.9 表单字段）

- 列表：相册卡片（title/description/图片数）；创建对话框（info.json 全字段：title*、description、date、location、tags、layout、columns）。
- 详情：图片网格；上传（非 JPG 自动转码，由后端处理，前端提示）；删除单图（二次确认）；编辑 info。

### 3.3 备份与恢复（§7 第 8 条）

- 备份列表（`GET /admin/backups`）：scope、文件数、大小、时间、备注。
- 创建备份：scope 选择（full/data/content/db）+ 备注 → `POST /admin/backups`。
- 恢复：二次确认对话框，**明确展示“将覆盖当前内容”**，确认后带 `confirm: true` 调 `:id/restore`；完成后提示。
- 删除备份：二次确认 → `DELETE /admin/backups/:id`。
- 「覆盖前自动快照」由后端写管线自动完成（前端在恢复对话框说明该机制存在）。

### 3.4 构建预览控制台（§7 第 9 条）

- 四个任务按钮：安装依赖 / 开发预览 / 构建 / 站点预览（对应 `install/dev/build/preview`）→ `POST /admin/process/tasks`。
- **SSE 日志终端**：`GET /admin/process/tasks/:id/logs`（EventSource 或 fetch 流）实时滚动渲染，区分 stdout/stderr 样式；缓冲回放自动可见。
- 停止：`DELETE /admin/process/tasks/:id`；任务状态徽标（running/exited/killed）。
- 端口检测：输入端口 → `GET /admin/process/ports/:port` 显示占用状态。

### 3.5 仪表盘（§7 第 2 条）

- 统计卡片：项目/服务状态（`/system/status` + Mizuki 检测结果）、文章数、草稿数、日记数、友链数、相册数、备份状态（最近备份时间与数量）、最近操作日志（`operation_log`——**对接 P6 的 `GET /admin/system/logs`**）。
- 实时刷新：**可选** `GET /admin/events` SSE 转发事件总线（`content.changed`/`backup.completed`/`process.finished` 等）驱动卡片刷新——实现与否及方案记 ADR（事件规格以 `packages/shared/src/events.ts` 为准）。

### 3.6 设置管理页（REQUIREMENTS §7 第 6 条 + §5 接管范围）

- 对接 P8 的 settings REST（`GET /admin/settings`、`PUT /admin/settings/:key`、`DELETE /admin/settings/:key`）。
- 表单分组（分组口径以 §5 为准）：站点基础信息 / 主题配置 / 导航配置 / 社交链接 / 功能开关 / 服务参数（API、端口、上传限制、备份目录）。
- 每个键的输入控件按值类型渲染（布尔 → 开关、数字 → 数字输入、字符串 → 文本框、复杂对象 → JSON 文本编辑 + 前端 `JSON.parse` 校验）；保存调 `PUT :key`。
- **边界**：本页只读写 `site_setting`（运行态配置）；`data/config.json`（启动配置，如 mizukiRoot）不在本页修改（初始化向导已覆盖），页面注明该边界。
- Mizuki 侧 `config`/主题配置文件的接管（§5 第 3 条）属二期能力，本页仅覆盖 settings 表范围，差距记报告。

### 3.7 图片上传打通六类内容

- P10b 的图片字段（diary.images、projects.image、devices.image）与 P10c 的封面接入统一上传组件：选择文件 → `POST /admin/media` → 回填相对路径（或直接写入对应目录，经后端能力，取舍记报告）。

## 4. 接线说明

1. 路由：`/media`、`/albums`、`/albums/:id`、`/backups`、`/console`、`/settings`、`/`（仪表盘）。
2. 菜单全部指向真实页面，占位路由清空。
3. `GET /admin/events`（若实现）：后端需认证；前端 EventSource 附 token 受限——方案（查询参数一次性 token / fetch 流）取舍记 ADR。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1/2 条 = 只建 §2 清单内文件；第 3 条 = 后端改动仅限 §2 的 `GET /admin/events` 一处例外；第 4 条 = 新增依赖记 ADR-001。

**本阶段专属禁止**：

- **前端绕过 `/api/v1` 直接操作文件**；**任何前端代码中出现 secret**。
- 日志终端不得对后端返回内容做 `v-html` 注入（纯文本渲染）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

### 手动验收场景清单（逐条执行并记录结果）

1. 媒体上传/删除/引用明细（删除被日记引用的图 → 409 明细展示）。
2. 相册全流程（创建/上传转 JPG/删图/编辑 info）。
3. 备份创建（四种 scope）/恢复（confirm 流程）/删除。
4. 控制台：启动 `dev` → 日志实时滚动 → 停止 → 状态更新；端口检测正确。
5. 仪表盘卡片数值与后端实际数据一致；（若实现）事件驱动刷新可见。
6. 设置页：设置一个键（如功能开关布尔值）→ 保存 → 刷新页面值仍在 → `GET /admin/settings` 返回一致。
7. **端到端场景（P10 总验收，必须完整走通并逐步记录）**：**登录 → 建一条日记（含上传图片）→ 传一张图到媒体库 → 建一篇文章（Markdown 或富文本）→ 创建一次备份 → 执行构建 → 启动预览并看到日志**。

## 7. 交付报告要求

1. 文件清单：新建/修改的全部文件路径。
2. **`GET /admin/events` 决策与 ADR**（实现与否 + 方案）。
3. §6 手动场景与端到端场景逐条结果。
4. 疑问清单（操作日志读取降级、图片静态访问方式等取舍）。
5. `CHANGELOG.md` 追加 P10d 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
