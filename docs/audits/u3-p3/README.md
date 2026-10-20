# U3-P3 交付报告 — 二期规格承诺兑现：向导目录点选 / 控制台历史与模板 / 相册 items 统一输出

> 执行日期 2026-10-20。指令包：`docs/prompts-ui/U3-P3-phase2-promises.md`（K1–K10 / I1–I9 / T1–T8）。
> 起始 HEAD = `23c6763`（U3-P2，基线 523/523、60 文件）。
> **完成即停**：工作树改动未提交、未 push，等架构师复核。

---

## 0. 结论速览

| 项 | 结果 |
|---|---|
| T1–T8 | **全完成**（K1–K10 逐条落点见 §2） |
| 数账（I5） | **523 → 546（+23），60 → 62 文件**（p0a 新 8 + p9e 新 8 + p7c +4 + app-config +3） |
| `pnpm build` | exit 0（shared → server → web；vue-tsc 0 错；1915 modules / 12.89s） |
| `pnpm lint` | exit 0（0 error / 0 warning） |
| `pnpm test` | **62 文件 / 546 用例全绿**（全量单批 `--maxWorkers=1`，302.98s） |
| 红线 grep | `/public/**`、backup/posts/media/collections/articles/site-config 模块、`MainLayout.vue`、路由表、`vite.config.ts`、lockfile、三 package.json **零 diff** |
| I9 安全面 | `startTask` 执行链（spawn / buildSpawnOptions / taskArgs / childEnv / pm-resolver）**零 diff**（唯一新增行是 `commandSnapshot` 只读快照，见 §4） |

---

## 1. 两处架构师再裁的执行落点（执行方未偏离）

### 再裁 A（K1 内）：browse-dirs 鉴权形态 = @Public + 未初始化门

- 端点：`GET /api/v1/admin/system/browse-dirs?path=<绝对路径>`，标 `@Public()`。
- 未初始化门：`authService.isInitialized()` 为真 → `409`（文案「系统已初始化，目录浏览仅在初始化向导期可用」）。
- 依据与安全余量已写入 `docs/REQUIREMENTS-PHASE2.md` R2-2 修订注记块。
- 验证：`p0a` ⑧「init 前 200 → initAndLogin 后 409」两阶段同 spec 用例。

### 再裁 B（K5 内）：任务模板 = 白名单任务命名预设，零新执行面

- 形态：`{name, task, description?}`，`task` 取值域 = `TASK_WHITELIST`。
- **不含** cmd/args/shell；面板按钮点击走既有 `startTask(task)` 白名单链路。
- 越界键防护：tasks 元素为 `z.strictObject` → 含 cmd/args/shell 时 config 解析按既有失败语义拒绝（启动即失败）。
- 实测行为见 §6「K5 越界键实测」。

---

## 2. K 条款 → 落点对照表

| K | 条款 | 落点文件 | 关键实现 |
|---|---|---|---|
| **K1** | browse-dirs 端点（@Public + 未初始化门 + zod query） | `apps/server/src/modules/system/directory-browser.service.ts`（新）<br>`apps/server/src/modules/system/system.controller.ts`（+36）<br>`apps/server/src/modules/system/system.module.ts` | 根层=Windows 盘符枚举 / POSIX `/`；子目录仅 `isDirectory() && !isSymbolicLink()`；跳 `.`/`$` 前缀；`localeCompare` 排序；200 上限 + `truncated`；`isMizuki` = package.json **或** astro.config.mjs；相对路径 → 400；不存在/非目录 → 404；**错误文案不回显绝对路径原文** |
| **K2** | 向导 step1 树形点选 + 高级折叠 | `apps/web/src/views/InitWizardView.vue`（+215）<br>`apps/web/src/api/system.ts`（+26） | 根层盘符 → 逐级钻取 → 「选择此目录」回填；选中路径**只读**展示；手动输入折叠进 `el-collapse`「高级模式」；加载失败降级提示 + 手输仍可用；detect 按钮/结果区/后续步骤零改动 |
| **K3** | task_run 表 + 迁移 0002 + 历史写入 | `apps/server/src/infra/db/schema.ts`（+taskRun）<br>`apps/server/drizzle/0002_add_task_run.sql`（新）<br>`apps/server/src/modules/process/process-manager.service.ts`（+69）<br>`apps/server/src/modules/process/log-truncate.ts`（新） | id text PK / task / command_snapshot / started_at / finished_at? / exit_code? / log_text?；`drizzle-kit generate` 产出 0002 并入库；启动 insert（command_snapshot = `{file, args:[...argsPrefix, ...args]}`，与 pino plan* 同源）；finalize update（finished_at/exit_code/log_text）；**历史写入 best-effort**（try/catch + pino warn，绝不影响终态与既有事件） |
| **K4** | runs 三端点 | `apps/server/src/modules/process/task-runs.service.ts`（新）<br>`apps/server/src/modules/process/process.controller.ts`（+58）<br>`apps/server/src/modules/process/process.module.ts` | `GET runs?page=&limit=`（clamp 20/100，started_at 倒序，**items 不含 log_text**）；`GET runs/:id`（含 log_text，404）；`DELETE runs/:id`（`{deleted:true}`，再删 404）；`:id` 沿用 `ProcessTaskIdSchema` |
| **K5** | TASK_WHITELIST 升格 + config tasks 键 + templates 端点 | `packages/shared/src/process-tasks.ts`（新）<br>`packages/shared/src/index.ts`（+3）<br>`apps/server/src/config/app-config.ts`（+19）<br>`apps/server/src/modules/process/process-manager.service.ts`（re-export）<br>`apps/server/src/modules/process/process.controller.ts` | 白名单迁至 shared 单源（L0 config 可 `z.enum` 引用，不 import L3）；process-manager 保留 `export { TASK_WHITELIST }` 与 `export type { ProcessTaskName }` 保持既有 import 兼容、**语义零变化**；config `tasks` 键 = `z.array(z.strictObject({name 1–64, task: z.enum(TASK_WHITELIST), description ≤200?})).default([])`；`GET /admin/process/templates` 返回 `{items}`，**活取**（`getAppConfig()` 每请求） |
| **K6** | 控制台两区 | `apps/web/src/views/process/ConsolePage.vue`（+233）<br>`apps/web/src/api/process.ts`（+61） | ① 历史区：分页表格（任务/开始时间/状态/退出码/耗时）+ 查看全文日志 dialog（`v-dialog-resize` + draggable，`<pre>` 纯文本禁 v-html）+ 单条删除（`ElMessageBox.confirm` 确认）；② 模板区：`GET templates` 渲染按钮（description 作 tooltip），**空数组不显示该区**；SSE 实时区/启停/端口检测一行不动 |
| **K7** | AlbumView.items | `apps/server/src/modules/albums/albums.service.ts`（+36） | additive：`AlbumItem = {type:'file',name} \| {type:'url',url}`；顺序 = 本地 listImages 序在前 + 外链 photos[] 序在后；`images` 原样保留；统一出口 `buildViewFrom`（list/create/update/buildView 四处共用） |
| **K8** | DEV 四项 + ADR-010 + 两处修订注记 | `docs/REQUIREMENTS-PHASE2.md`（+35）<br>`docs/REQUIREMENTS.md`（+22）<br>`docs/decisions/ADR-010-upload-format-policy.md`（新） | ① R2-5 加注（「六类集合」一句作废）；② REQUIREMENTS §6.6 timeline 基线表改官方四值 + ADR-018 迁移注记；③ REQUIREMENTS §7-4 加 HTML 包降级注记；④ ADR-010 补建（上传格式策略全弧）；⑤ R2-2 加再裁 A 注记；⑥ R2-10 加再裁 B 注记 |
| **K9** | 台账 | `docs/audits/feature-alignment/README.md`（+31）<br>`docs/SESSIONS.md`、`CHANGELOG.md`、本报告 | B-P1-01/02/03 行改「立项闭环（U3-P3）」；B-P2-05/07/08 加「立项排期（U3-P4 / U4 路线）」；DEV 四行改「闭环」；§5 批次表 U3-P3 行重写；新增 §7 交付小结 |
| **K10** | 测试落位 | 见 §3 | p0a 8 例、p9e 8 例、p7c +4 例；fixture 全 mkdtemp + env 注入 |

---

## 3. 用例明细（I5 数账）

**净增 +23（523 → 546），62 文件**（基线 60 + 新增 p0a、p9e）。

### 3.1 `p0a-system-browse.e2e-spec.ts`（新建，8 例）

| # | 用例 | 断言 |
|---|---|---|
| ① | 无 path → 根列表 | 200；`parent === null`；`truncated === false`；win32 下每项匹配 `/^[A-Z]:\\$/`，POSIX 下恰为 `[{name:'/',isMizuki:false}]` |
| ② | 有 path → 子目录枚举 | 含 `plain-dir`；**不含** `a-file.txt`（仅目录）；名称按 `localeCompare` 升序 |
| ③ | isMizuki 真假两态 | `mizuki-pkg`（package.json）→ true；`mizuki-astro`（astro.config.mjs）→ true；`plain-dir` → false |
| ④ | `.` / `$` 前缀目录跳过 | 不含 `.hidden-dot`、不含 `$hidden-dollar` |
| ⑤ | 201 子目录 → 截断 | `truncated === true`；`items.length === 200` |
| ⑥ | 相对路径 → 400 | 400；**响应 message 不含提交原文** |
| ⑦ | 目录不存在 → 404 | 404；**响应 message 不含绝对路径原文** |
| ⑧ | 初始化门两阶段 | init 前 200 → `initAndLogin` 后 409；message 含「已初始化」 |

### 3.2 `p9e-process-runs.e2e-spec.ts`（新建，8 例）

| # | 用例 | 断言 |
|---|---|---|
| ① | 启动即出行 | 历史列表含该行；`finishedAt === null`；`exitCode === null`；`status === 'running'`；command_snapshot 可 JSON 解析出 `{file,args}` |
| ② | 退出后更新 | 轮询至 `finishedAt !== null`；`exitCode === 0`；`logText` 非空且含 `line-2500`；`status === 'exited'` |
| ③ | 详情含 log_text | 存在性断言：不存在 :id → 404（log_text 形态在 ② 已覆盖） |
| ④ | DELETE 后再取 → 404 | 删除 200 `{deleted:true}` → 再取 404 → 再删 404 |
| ⑤ | 分页倒序 | ≥3 行；`startedAt` 降序；`limit=9999` → clamp 至 100 |
| ⑥ | 256KB 截断（读取侧） | 截断单源：300KB → ≤256KB、保尾、未超限原样；DB 直预置超长行 → 详情端点仍 ≤256KB |
| ⑥b | 256KB 截断（**写入侧**） | 专用大输出项目（6000 行 ≈ 数百 KB）→ 落库 log_text ≤256KB；含 `006000`（尾部保留）、**不含** `000001`（前部被截） |
| ⑦ | templates 端点 + 越界键 | 默认 `items` 为数组；写入合法模板 → 活取可见且逐字相等；含 `cmd`/`shell` → `loadAppConfig` **抛错**（实测 message：`tasks.0: Unrecognized keys: "cmd", "shell"`） |

### 3.3 `p7c-album-fields.e2e-spec.ts`（增量 +4 → 14 例）

| # | 用例 | 断言 |
|---|---|---|
| c-① | 本地相册 items | 全部 `type === 'file'`；items 的 name 序 **等于** `images` 序 |
| c-② | 外链相册 items | `type === 'url'`；url 序 **等于** `photos[].src` 序；首项为 `https://cdn.example.com/alpine/01.jpg` |
| c-③ | images 字段仍在 | `images` 仍为数组；`items` 存在；**公开列表**每项亦带 items（公开面 additive） |
| c-④ | 空相册 | items `[]`、images `[]`（创建响应与列表响应双向验证） |

### 3.4 既有断言的**必要修订**（非弱化，见 §6 偏差 ②）

| 文件 | 修订 | 缘由 |
|---|---|---|
| `test/infra/db-migrate.spec.ts` | 业务表集合 11 → 12（+`task_run`）；断言文案「11 张」→「12 张」 | K3 新增表 |
| `test/app.e2e-spec.ts` | 同上（表名集合 + 用例标题） | 同上 |
| `test/config/app-config.spec.ts` | 默认值断言 +`tasks: []`；**另增 3 例**（合法模板解析通过 / 越界键抛错 / 非白名单 task 抛错） | K5 config 新键 |

---

## 4. I9 安全面零 diff 核验（grep 实录）

指令包要求「`startTask`/`buildSpawnOptions`/`taskArgs`/`childEnv`/pm-resolver 除历史写入外零 diff」。

```
$ git diff apps/server/src/modules/process/process-manager.service.ts \
    | grep -E "^[+-]" | grep -vE "^[+-]{3}" \
    | grep -E "spawn|buildSpawnOptions|taskArgs|childEnv|pmResolver|resolve\(|plan\.|shell|argsPrefix"
+      commandSnapshot: JSON.stringify({ file: plan.file, args: [...plan.argsPrefix, ...args] }),
```

**唯一命中行是只读快照的构造**（复用既有 `plan.file` / `plan.argsPrefix` / `args` 三个局部变量，**不改执行链、不新增参数**）。
`spawn(...)` 调用、`buildSpawnOptions(cwd)`、`taskArgs(task, packageManager)`、`childEnv()`、pm-resolver 解析链 —— 全部零 diff。

其余红线 grep（`/public/**`、backup/posts/media/collections/articles/site-config 模块源码、`MainLayout.vue`、路由表、`vite.config.ts`、`pnpm-lock.yaml`、三处 `package.json`）：**零 diff**（本批未触碰）。

---

## 5. 迁移与老库升级（I8）

- `apps/server/drizzle/0002_add_task_run.sql` 已入库（`drizzle-kit generate` 原生产物，未手写）：
  ```sql
  CREATE TABLE `task_run` (
    `id` text PRIMARY KEY NOT NULL, `task` text NOT NULL,
    `command_snapshot` text NOT NULL, `started_at` integer NOT NULL,
    `finished_at` integer, `exit_code` integer, `log_text` text
  );
  ```
- `drizzle/meta/0002_snapshot.json` + `_journal.json`（idx 2, tag `0002_add_task_run`）同步推进；既有 0000/0001 未动。
  - 快照自检：journal 3 条目（`0000_chunky_kabuki, 0001_add_token_version, 0002_add_task_run`）；
    0002 快照含 12 表。
- 启动自动迁移（`runMigrations`）幂等；`db-migrate.spec.ts` 幂等用例覆盖。
- **老库升级实测（I8 硬要求，执行方本地实跑）**：本机真库 `apps/server/data/mizuki.db`（11 表老库）
  → `MIZUKI_SERVER_PORT=0 MIZUKI_PREVIEW_PORT=0 node bin/mizuki-server` 启动一次 →
  日志「迁移执行开始 / 迁移执行完成」→ 复查真库：
  - 业务表 **11 → 12**（`… site_setting, tag, **task_run**`）；
  - `PRAGMA table_info(task_run)` → `id, task, command_snapshot, started_at, finished_at, exit_code, log_text`（七列齐备，与 schema 逐字一致）。
  - 启动脚本走 `dist/main.js`（`pnpm build` 产物），迁移由 `DbModule` 的 `SQLITE_CONNECTION` provider 触发。
- 测试数据隔离：全部 62 个套件走 `MIZUKI_DB_PATH` 注入的 mkdtemp 域，**真实主题目录与真库零写入**
  （AGENTS §4-9；本批唯一一次真库写入是上面这次**显式要求的老库升级实测**——只加表，不动既有数据）。

---

## 6. 偏差披露（5 条）

| # | 偏差 | 缘由与裁定 |
|---|---|---|
| ① | **log_text 截断在读取端也加了一道防御**（K3 只规定写入侧） | 首轮 p9e ⑥ 直接 DB 预置 300KB 行 → 详情端点回吐 307200 字节，暴露「DB 直预置绕过写入侧截断」时响应体不设上限。补 `TaskRunsService.detail` 同源截断（`truncateLogText` 复用，**同一单源函数**），使「详情端点响应体 ≤256KB」成为强保证。写入侧行为未变（⑥b 已证明）。属必要加固，非机制扩张。 |
| ② | 既有 3 个断言文件被修订（表数 11→12、config 默认值 +`tasks: []`） | K3 新增表 + K5 config 新键的**必然连带**。表数断言是「集合恰好等于」，不同步即红；config 默认值断言同理。**未弱化任何既有断言语义**，另在 app-config 补 3 例正向覆盖新键。 |
| ③ | p9e 做 8 例而非建议的 7 例（拆出 ⑥ 读取侧 / ⑥b 写入侧两条） | 首轮单条 ⑥ 只能证明读取侧；拆出 ⑥b 用**真实超长输出任务**证明写入侧保尾截断（这是 K3 的核心断言）。原 ⑥ 的读取侧断言合并入 ⑥b 的前半段（同一用例内两段），故总数 +1。 |
| ④ | p9e 另建「专用大输出项目」夹具（`makeBigProject()`），未改共享 `fixtures/mini-project` | 共享夹具被 p9 / p9b 两个既有套件复用（且 p9 §6.5 断言 `line-2500` 精确行），改它会破坏既有断言。改为在 p9e 的 mkdtemp 域内自建项目（package.json + build 脚本），**共享夹具零改动**。 |
| ⑤ | 改了 4 处「11 表」计数（MASTER-PLAN / README / docs/README / AGENTS.md）+ 2 处源码注释 | 表结构事实源同步（MASTER-PLAN §3 是「表结构唯一事实来源」，必须含 task_run）。历史 ADR（ADR-002）与历史提示词（`docs/prompts/**`）**未动**——它们记录的是一期基线，改写即篡改历史。 |

### K5 越界键实测行为（指令包 §7 停工条件点名要求披露）

```
$ node -e "loadAppConfig(configPath)"   # tasks: [{ name:'越界', task:'build', cmd:'powershell', shell:'powershell 任意' }]
→ throw Error: config.json 校验失败（<path>）: tasks.0: Unrecognized keys: "cmd", "shell"
```

**行为符合再裁 B 的适配形态**：tasks 元素为 `strictObject` → 越界键被拒 → 按 config 既有失败语义（**启动即失败**，非静默忽略、非部分接受）。该断言已固化为 `p9e ⑦` 与 `app-config` 新增用例。

---

## 7. 已知限制

1. `browse-dirs` 根层在 Windows 上枚举**存在的盘符**（`existsSync`），不枚举网络驱动器与未挂载卷。
2. `browse-dirs` 的 `isMizuki` 是**轻量**判据（package.json **或** astro.config.mjs），不保证是有效 Mizuki 项目——完整四项检测仍走既有 `POST /system/detect`。
3. `task_run` 历史**跨重启可见**（SQLite 落盘），但**正在运行**的任务只存在于进程内存（`ProcessManagerService.tasks`）——服务重启后内存态丢失，DB 中的行停留在 `finished_at = null`（历史记录显示为「运行中」）。此为内存态/持久态的固有分界，非缺陷；如需清理可在后续批次加「启动时把 finished_at 为空的行标记为中断」。
4. `log_text` 截断**保尾**（丢最早输出）——长构建的失败原因通常在尾部，此取舍与 R2-10「尾部截断保留」一致。
5. `AlbumView.items` 本批**面板不消费**（K7 明示：既有双区 UI 更优，仅兑现 API 契约）。
6. `browse-dirs` 为 @Public，仅靠「未初始化门」限制暴露面——初始化完成后永久关闭（409），是单向门。

---

## 8. 提交状态

- 全部改动（**27 改 + 8 新增**：`packages/shared/src/process-tasks.ts`、`log-truncate.ts`、`task-runs.service.ts`、
  `directory-browser.service.ts`、`drizzle/0002_add_task_run.sql` + snapshot、`p0a` spec、`p9e` spec、
  `ADR-010-upload-format-policy.md`、本报告）**未提交、未 push**，等架构师复核。
- 建议提交信息：
  `feat(system+process+albums): U3-P3 二期规格兑现 — 向导目录点选 / 控制台历史与模板 / 相册 items（基线 546）`
- **PM 手验点**：
  1. 未初始化状态下打开 `/init` → step1 应显示盘符列表 → 逐级点选 → 「选择此目录」回填只读路径 →
     「检测目录」出四项结果（人工确认浏览体验与路径拼接正确）；
  2. 初始化完成后刷新 `/init` → 应提示「系统已初始化，请直接登录」；直接访问
     `GET /api/v1/admin/system/browse-dirs` → 409；
  3. 控制台页 → 跑一次 build → 「历史记录」区出现该行（状态「成功」、退出码 0）→
     「查看日志」弹窗见完整输出 → 「删除」后消失；
  4. 在 `apps/server/data/config.json` 写
     `"tasks": [{"name":"构建产物","task":"build","description":"出静态产物"}]` →
     控制台出现「任务模板」区与该按钮（**无需重启**）→ 点击后走既有 build 链路；
     再把 `tasks` 元素加上 `"cmd":"powershell"` → 服务下次启动应**拒绝启动**并报
     `tasks.0: Unrecognized keys`（这是预期行为，不是 bug）。
