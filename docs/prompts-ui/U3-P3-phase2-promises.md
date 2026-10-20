# U3-P3 — 二期规格承诺兑现：向导目录点选 / 控制台历史与模板 / 相册 items 统一输出（含 DEV 规格修订与 B-P2 立项排期台账）

> [签发] 架构师 2026-10-20。执行方：用户指定模型通道。完成即停，交回报告等验收。
> [前置] HEAD = 23c6763（U3-P2，基线 523/523、60 文件）。本包 file:line 均按该 HEAD 实读。
> [PM 裁定] 2026-10-20「全部立项实现」：B-P1-01/02/03 本批兑现；B-P2-05/07/08 立项排期（U3-P4 起，本批只落台账注记）；DEV 四项规格修订本批闭环。

## 0. 两处架构师再裁（依据在案，执行方不得再偏离；PM 已在签发回复中过目）

**再裁 A（K1 内）：browse-dirs 鉴权形态。** R2-2（PHASE2:18）写「需认证端点」+ 验收「无 Token 401」，但该端点的唯一消费方是初始化向导——向导是 **pre-auth** 流程（`system.controller.ts`：detect/init 均 @Public，init 前无账号可登录），规格自矛盾。裁定：**@Public + 未初始化门**——`isInitialized()` 为真时调用 → 409（与 init 同款守卫）；未初始化窗口内可用。安全余量：全局限流照常（先限流后鉴权，@Public 不豁免 throttle）、仅目录名不返回文件、单次 200 上限、本服务 local-first（127.0.0.1）。R2-2 规格文本加修订注记（T6）。

**再裁 B（K5 内）：任务模板不做 cmd/args/shell 可配。** R2-10（PHASE2:85-87）的 `tasks.{dev,build}.{cmd,args,shell}`「按平台可配 pwsh/cmd/bash」写于 P9 加固**之前**：它会把服务变成「配置文件驱动的通用命令执行器」，正面违反 AGENTS §5 硬红线（任务白名单硬编码、shell 恒 false、不接受用户传参）与 ADR-011 解析链架构；其想解决的 Windows 垫片问题已被 pm-resolver 另行解决。裁定：模板**重定义为白名单任务的命名快捷预设** `{name, task, description?}`——console 渲染按钮、点击即 `startTask(task)` 走既有白名单链路，零新执行面。R2-10 规格文本加修订注记（T6）。规格验收「篡改 shell → 拒绝」以适配形态保留：tasks 元素 `.strictObject`，含 cmd/args/shell 键 → config 解析按既有失败语义拒绝。

## 1. 事实基座（已实读核实，执行方可抽验）

### 1.1 规格原文
- **R2-2**（PHASE2:17-29）：`GET /admin/system/browse-dirs?path=<绝对路径>`；无 path → 根列表（Windows 盘符 / POSIX `/`）；有 path → `[{name, isMizuki}]` + parent；仅目录、跳隐藏与符号链接目录、上限 200 + truncated；isMizuki 轻量判据（存在 package.json 或 astro.config.mjs）；404 目录不存在；向导改树形钻取为主入口 + 选中只读回填 + 手动输入折叠高级模式。
- **R2-10**（PHASE2:72-89）：纯增量（SSE/启停/环形缓冲/端口检测一行不动）；task_run 表（id PK、task、command_snapshot、started_at、finished_at、exit_code、log_text 尾部 ≤256KB）；启动写行、退出更新；REST `GET /admin/process/runs`（分页倒序）/`GET .../runs/:id`（含 log_text）/`DELETE .../runs/:id`；控制台历史区（分页、看全文、单删）；模板进 data/config.json、zod 校验。
- **R2-14 items 子项**（PHASE2:120-121）：列表端点输出统一 items 数组 `[{type:'file',name}|{type:'url',url}]`，本地与外部合并有序。

### 1.2 实现侧落点
- `system.controller.ts`：现有六路由（health/status/detect/init/mode/logs）；init @Public + 已初始化 409 惯例；`admin/system/logs` 的分页 clamp 模式（`clampIntParam`，默认 20 上限 100）可复用。
- `InitWizardView.vue:183-207`：step1 = el-input + detect 按钮 + 结果区；`mizukiRoot` ref + `runDetect`。
- `mizuki-detector.service.ts`：四项检查（package.json 含 astro / astro.config / src/data / posts 目录）+ lockfile 探测；isMizuki 轻量判据按 R2-2 逐字（package.json **或** astro.config.mjs 存在）。
- `process.controller.ts:25-68`：`admin/process` 下 tasks/ports 路由，无 runs；`process-manager.service.ts`：startTask（:122-172）/finalize（:316-349）/环形缓冲 2000 行/`childEnv`+`buildSpawnOptions` 安全面；pino 已记 plan* 字段（:159-170）。
- `infra/db/schema.ts`：11 表（mediaFile :139 / siteSetting :153 为近期表样例）；迁移走 `drizzle-kit generate` → `drizzle/000N_*.sql`（现存 0000/0001），启动自动迁移 `runMigrations`（db.module.ts:12）。
- `config/app-config.ts:16-43`：`AppConfigSchema` zod（mode/mizukiRoot/uploadLimitMb/jwtSecret/swagger/corsOrigins）；`getAppConfig()` 每请求活取（P11 坑5 先例，patchMode 即此模式）。**分层注意**：TASK_WHITELIST 现在硬编码于 process-manager.service.ts:38（L3），config（L0）要 z.enum 它必须先升格 shared 单源。
- `albums.service.ts:269-271`：`AlbumView = {name, info, images}`，`listImages`（:343 附近）文件名字典序、排 info.json 与缩略图后缀；外链照片在 `info.photos[]`；**无 GET :id detail 路由**（列表即全量）。
- `ConsolePage.vue` 在 `apps/web/src/views/process/`；TASK_OPTIONS 三项（preview 无按钮，audit §4-1 已裁语义合理，本批维持）。
- DEV 四项原文：PHASE2:40（minimal「与六类集合」）；REQUIREMENTS timeline type 一期基线表（约 :222，官方四值见 ADR-018）；REQUIREMENTS:318（富文本「可导出 HTML 与 Markdown」）；B-DEV-03 补 ADR-010（R2-7:54 点名「记 ADR-010（一期转 JPG 的原决策及废止理由）」但文件从未建，ADR 命名 kebab 惯例见 docs/decisions/）。
- 测试命名空间：`p0a-` 无占用（git -S 空）；`p9c` 空缺原因不明（同 p7g 禁复用）→ 用 **p9e**；p7 系已用至 p7j（p7g 永久跳过）。

## 2. 架构裁定 K（执行方不得偏离；发现与事实冲突停下报告）

**K1（browse-dirs 服务端，再裁 A）**：`system.controller` 增 `GET admin/system/browse-dirs`，@Public + 未初始化门（`isInitialized()` 真 → 409，文案注明仅向导期可用）。Query zod：`path` 可选 string；提供时**原始输入必须绝对路径**（`path.isAbsolute`，否则 400，拒绝 `..`/相对段注入）。无 path → 盘符枚举（Windows A-Z 逐一 `existsSync`，POSIX 固定 `/`），`parent: null`。有 path → resolve 后须存在且为目录（否则 404）；readdir withFileTypes，仅 `isDirectory() && !isSymbolicLink()`，名称以 `.` 或 `$` 开头跳过；`name.localeCompare` 排序；**200 上限 + `truncated` 标志**；`isMizuki` = 目录下存在 package.json 或 astro.config.mjs（R2-2 逐字，完整检测仍归既有 detect 端点）；`parent` = dirname（根目录 dirname===自身 → null → 前端回到盘符层）。响应 `{ parent: string | null, items: [{name, isMizuki}], truncated: boolean }`。限流走全局，不加专属节流。

**K2（向导树形点选）**：`InitWizardView.vue` step1 重构：点选钻取为主入口（根层盘符列表 → 逐级进入子目录列表；每项显示目录名，isMizuki 目录带徽标；返回上级入口；「选择此目录」回填完整路径）；选中后 `mizukiRoot` 以**只读展示**完整路径；手动输入折叠为「高级模式」（el-collapse 或 toggle，展开后可微调，逻辑同现有 el-input）；detect 按钮/结果区/后续步骤零改动。组件选择执行方定（el-tree lazy 或列表钻取均可，**零新依赖**，el-tree 为 EP 自带）。加载失败（404/409/网络）降级为提示 + 高级模式手输可用。

**K3（task_run 表）**：`schema.ts` 增 `taskRun`（`task_run`）：id text PK（nanoid）、task text、command_snapshot text、started_at integer(ms)、finished_at integer nullable、exit_code integer nullable、log_text text nullable。`drizzle-kit generate` 产出 **0002_*.sql 并入库 commit**（runMigrations 启动自动应用）。写入：`startTask` 注册实例成功后 insert（command_snapshot = `JSON.stringify({file: plan.file, args: [...plan.argsPrefix, ...args]})`，与 pino plan* 字段同源）；`finalize` 末尾 update（finished_at/exit_code/log_text，log_text = buffer 行 join('\n') 后按 UTF-8 字节 256KB 保尾截断，多字节截缘容忍替换字符并注释）。**历史写入 best-effort**：try/catch + pino warn，失败绝不影响任务终态分发与既有事件。`startTask`/`buildSpawnOptions`/`taskArgs`/`childEnv` 安全面**除历史写入外零 diff**（验收 grep 项）。

**K4（runs REST）**：`process.controller` 增三路由（全部需认证）：`GET admin/process/runs?page=&limit=`（clamp 20/100 同 logs 惯例；started_at 倒序；items **不含** log_text）、`GET admin/process/runs/:id`（含 log_text；404）、`DELETE admin/process/runs/:id`（返回形态对齐 albums/media DELETE 既有惯例；再删 404）。:id 参数 zod 同 ProcessTaskIdSchema 口径。

**K5（任务模板，再裁 B）**：`AppConfigSchema` 增 `tasks`：`z.array(z.strictObject({ name: z.string().min(1).max(64), task: z.enum(TASK_WHITELIST), description: z.string().max(200).optional() })).default([])`。**前置升格**：`TASK_WHITELIST` 迁至 packages/shared 单源（process-manager.service 改 re-export 保持既有 import 兼容，语义零变化）——L0 config 不得 import L3。读取**活取**（P11 坑5 先例，`getAppConfig()` 每请求；规格「重启读取」按此放宽，注记进 T6）。新增 `GET admin/process/templates`（需认证）返回 `{ items }` 供面板渲染。含 cmd/args/shell 等越界键的 tasks 元素 → 整体 config 解析按既有失败语义处理（执行方实读 app-config safeParse 回退行为并在报告披露实测结果）。

**K6（控制台 UI）**：`ConsolePage.vue` 增两区，SSE 实时区/启停交互/端口检测**一行不动**：① **历史记录区**——分页表格（任务/开始时间/退出码/耗时或状态），查看打开全文日志 dialog（复用 `v-dialog-resize` + draggable 惯例，`<pre>` 展示 log_text），单条删除带确认；② **模板区**——`GET templates` 渲染快捷按钮（name → `startTask(task)`，description 作 tooltip），空数组不显示该区。preview 无按钮的既有语义维持。

**K7（AlbumView.items）**：**additive**——`AlbumView` 增 `items: Array<{type:'file'; name: string} | {type:'url'; url: string}>`；顺序 = 本地 `listImages` 序在前 + `info.photos[]` 序在后（「合并有序」的裁定语义；两模式互斥不混排）；`images` 字段**原样保留**（管理 API additive 先例，U3-P1）。面板本批**不消费** items（既有双区 UI 更优，仅兑现 API 契约）。

**K8（DEV 四项）**：① PHASE2:40 R2-5 文本加修订注记（实际仅隐藏富文本，B2 终版裁决 7）；② REQUIREMENTS timeline type 一期基线表修订为官方四值 + ADR-018 迁移注记（执行方 grep 定位确切行）；③ REQUIREMENTS:318 加降级注记（HTML 包降级，P10c §3.3 授权）；④ 补建 `docs/decisions/ADR-010-upload-format-policy.md`：记录上传格式策略全弧（P5 一期「一律转 JPG」原决策 → R2-7/ADR-017 废止为媒体/相册保留原格式 → posts 封面**维持**转 JPG 的 B2 裁决 2/3 及理由），标题与体例对齐既有 ADR。

**K9（台账）**：audit README——B-P1-01/02/03 行改「立项闭环（U3-P3）」；B-P2-05/07/08 行加「立项排期（U3-P4/U4 路线）」注记；DEV 四行改「闭环（规格修订/ADR-010 补建）」；§5 批次表 U3-P3 行重写。SESSIONS 交付段 + CHANGELOG 批次条目。交付报告落 `docs/audits/u3-p3/README.md`（证据行编号、K/I 对照、用例明细、三连实录、偏差披露）。

**K10（测试落位）**：新建 `p0a-system-browse.e2e-spec.ts`（建议 8 条：无 path 根列表平台分支断言 win32 /^[A-Z]:\\$/ 或 POSIX [{name:'/'}]；子目录枚举含排文件；isMizuki 真假两态；`.`/`$` 前缀跳过；201 目录 → truncated 且 200 条；相对路径 400；不存在 404；**init 前可调 200 → initAndLogin 后 409**——同 spec 两阶段）；新建 `p9e-process-runs.e2e-spec.ts`（建议 7 条：启动即出行 finished_at=null；退出后 update + log_text 非空；:id 详情 404；DELETE 后 404；分页倒序多行；log_text 256KB 截断（DB 直预置超长行最稳）；templates 端点 + 越界键 config 拒绝——启动口径复用 p9 既有 fixture/桩法，执行方实读 p9 spec 对齐）；`p7c-album-fields.e2e-spec.ts` 增量 +4（items 顺序本地前外链后；file/url 形态；images 字段仍在；空相册 items=[]）。fixture 全 mkdtemp + env 注入。

## 3. 不变量 I

- **I1** 零新依赖：lockfile 与三处 package.json 零变动（el-tree 属 Element Plus 既有）。
- **I2** 红线全守：写盘仅单源能力（task_run 是 SQLite 表非文件写；迁移 SQL 由 drizzle-kit 生成）；测试仅 mkdtemp；不碰 `.git/`；不 push。
- **I3** 公开 API 冻结零 diff；管理 API 仅 additive（AlbumView +items、runs/templates 新路由、AdminSiteConfigView 不动）。
- **I4** 分层：TASK_WHITELIST 升格 shared 后 process-manager 保 re-export；config（L0）零 L3 import；system/process 模块职责边界不变。
- **I5** 数账：全绿轮计入，预计净增 +17~19（p0a 8 + p9e 7 + p7c +4），交付报告列明细。
- **I6** 三连全绿：build（vue-tsc 0 错）/ lint 0·0 / test 全绿（分批 ≤6 + `--maxWorkers=1`，TMP/TEMP 重定向）。
- **I7** UI 零扩张：无新路由/菜单；历史区与模板区入既有 ConsolePage；向导改动限 step1。
- **I8** 迁移完整：`drizzle/0002_*.sql` 入库；既有 0000/0001 与 `meta` 正常推进；老库（本机 data/mizuki.db）启动自动升级可跑（执行方本地实测启动一次）。
- **I9** 安全面零变化：`startTask` 执行链（spawn/buildSpawnOptions/taskArgs/childEnv/pm-resolver）除 K3 历史写入外零 diff（验收 grep）。

## 4. 任务 T

- **T1（K1）** browse-dirs 端点（含 zod query schema 与未初始化门）。
- **T2（K2）** 向导 step1 树形点选 + 高级折叠。
- **T3（K3）** task_run 表 + 迁移 + startTask/finalize 历史写入。
- **T4（K4）** runs 三端点。
- **T5（K5/K6）** TASK_WHITELIST 升格 + config tasks 键 + templates 端点 + ConsolePage 两区。
- **T6（K8）** DEV 四项规格修订 + ADR-010 补建 + R2-2/R2-10 两处修订注记（再裁 A/B）。
- **T7（K7）** AlbumView.items。
- **T8（K9/K10）** 台账 + 测试三件 + 交付报告。

## 5. 验收基线

数账 523 → 预计 540~542（全绿轮为准）；三连全绿；红线 grep：`/public/**`、backup/posts/media/collections/articles/site-config 模块、`MainLayout.vue`、路由表、`vite.config.ts`、lockfile、三 package.json、**process-manager 安全面（I9）**、既有 p9 spec 断言零弱化。

## 6. 红线（同全仓规约，重申）

写盘单源；禁裸 fs.writeFile 于 Mizuki 根；测试不碰真实主题目录；TS strict 禁 any 禁未用导入；错误形状 `{code,message,detail}` 不泄绝对路径（browse-dirs 的 404/400 文案不得回显绝对路径原文——用相对投影或通用文案）；跨模块仅事件/注册表/共享升格三通道；批次提交未许可不 push。

## 7. 停止条件

- 全部 T 完成且三连全绿 → **停**，交付报告（I5 明细、三连实录、偏差清单、K5 越界键实测行为）。
- 任何 K 与实读事实冲突 / 需要本包未授权的机制（新依赖、新事件、media 模块改动、config 校验语义变更）→ **停**，报告冲突点等架构师再裁。
- 完成即停：不做范围外顺手改。
