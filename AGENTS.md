# AGENTS.md —— 在本仓工作的 AI 代理须知

本文件只记两件事：**动手前必须知道的事**，以及**去哪找权威源**。具体行为以源码与 `docs/` 为准；
人读的说明看 [`README.md`](README.md)。

---

## 1. 这是什么

**Mizuki-Server**：Astro 静态博客主题 **Mizuki** 的本地优先管理服务。它不改主题源码结构，只做四件事：

1. **内容管理** —— 集合（diary / friends / projects / timeline / skills / devices / anime）、Markdown 文章、富文本文章、相册、媒体库、about 页；
2. **站点配置** —— `src/config.ts` 的受控子集（`lang` / `commentConfig` / `navBarConfig`）物化改写；
3. **构建与预览** —— 白名单任务（`install` / `dev` / `build` / `preview`）、实时日志 SSE、静态 dist 预览通道；
4. **对外接口** —— JWT 管理 API（`/api/v1/admin/**`）+ 限流公开 API（`/api/v1/public/**`）+ 同源托管的管理面板。

生产形态一条命令：`pnpm install && pnpm build` 后 `node apps/server/bin/mizuki-server`，面板与 API 同在 **20154**。

## 2. 仓库布局

```
apps/server      NestJS 11 + Drizzle/better-sqlite3；API 与面板同源托管（20154）
  src/common/    L0 单源能力：路径监狱、原子写、zod 管道、markdown 渲染、媒体引用注册表…
  src/config/    L0 应用配置：config.json → AppConfigSchema（zod）
  src/infra/     L0 数据库（12 表）与备份实现
  src/modules/   领域模块（L0~L3 分层见 §4）
  src/bootstrap/ 启动装配：swagger / 静态面板 / site-assets 通道
  bin/           生产启动脚本 mizuki-server
  test/          vitest 单测 + e2e（62 文件 / 546 用例）
  data/          运行时产物（gitignored，见 §7）
apps/web         Vue 3 + Element Plus 面板（dev 20155，/api 与 /site-assets 代理到 20154）
packages/shared  zod schema + 事件目录（前后端唯一共享面）
docs/            规格、决策、台账、阶段提示词（见 §10）
```

`.github/workflows/ci.yml`：push 时 `pnpm install --frozen-lockfile` → `pnpm lint && pnpm test && pnpm build`（Node 22 / pnpm 9）。

## 3. 命令与验证（先看这条警告）

> **根 `package.json` 覆盖事故（已修复，2026-10-15）。** 2026-10-09 它曾被 DSH 插件脚手架覆盖成
> `{"name":"@local/demo-mcp", … "dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}`，后果：根级
> `pnpm dev|build|test|lint` 全部不可用（实测 `pnpm run lint` → `[ERR_PNPM_NO_SCRIPT] Missing script: lint`，
> 退出码 1），`node_modules/.bin/eslint` 与 `node_modules/.bin/vitest` 均不存在。
> 已按 HEAD 恢复（`git checkout -- package.json`），monorepo 清单完好。
> 若再次出现根级脚本缺失，先 `git diff package.json` 对比 HEAD，再同命令恢复。

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖（本机需 `--frozen-lockfile --config.node-linker=hoisted`） |
| `pnpm dev` | 后端 watch 启动（20154） |
| `pnpm --filter @mizuki/web dev` | 面板 dev（20155） |
| `pnpm test` | 后端 vitest 全量（基线 **546 用例 / 62 文件**） |
| `pnpm build` | `shared → server → web` 全量构建（web 含 `vue-tsc --noEmit`） |
| `pnpm lint` | 根 eslint（含 boundaries 分层；**显式排除 `apps/web/**` 与 `.test-tmp/**`**） |

**工具链坑（Windows 本机实测，非猜测）**

- 依赖安装要 `--config.node-linker=hoisted`（符号链接权限不足）；CI 用 pnpm 9，本机可能是 pnpm 12。
- `@mizuki/shared` 必须**先 build**（`node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json`），
  否则 server 报 `Cannot find module '@mizuki/shared'`。
- vitest 全并行在本机不可用（30 个 worker 异常退出）：分批 ≤6 个文件 + `--maxWorkers=1`；vitest 4 已无 `--reporter=basic`。
- Windows 非 ASCII 用户名会让 `pm-resolver.spec.ts` 的 3 个用例失败（环境性，不是代码缺陷）。
- **DSH 运行时不含包管理器**（2026-10-16 实测；2026-10-20 订正）：`runtime/…/node/bin` 只有 `node.exe`，
  `where npm` 无结果，pnpm 仅以 `pnpm.cjs` 形式存在（`shell:false` 下 `.cmd` 不可 spawn）。
  → **在 DSH 运行时内跑 `pnpm test` 会必现 484/490**（失败全在 p9 进程与解析链）。
  **但把用户 pnpm 目录加进 PATH 后（用户 AppData/Local/pnpm/bin）即可全绿**：
  2026-10-20 U3-P3 批实测 **62 文件 / 546 用例全绿**（全量单批 `--maxWorkers=1`）。
  本机 `MIZUKI_PM_<NAME>_PATH` 无对象可指。
- **web 构建一度被 esbuild 大输入临时文件拒绝**（`vite:esbuild-transpile` remove `Access is denied`）——
  已按 **ADR-027** 绕开（`build: { target: 'esnext', minify: false, cssMinify: 'esbuild' }`），`pnpm build`
  现可全绿；**改回默认压缩或给 element-plus 加 `manualChunks` 之前先读 ADR-027（后者实测运行期 TDZ 崩）**。
- **验收三连 = test + build + lint 全绿**；数账只认全绿轮（流程规则候选 R6）。

## 4. 硬性红线（改动前必读）

1. **写盘只走既有单源能力**：
   - **集合内容**（`<mizukiRoot>/src/data/*.ts`）只能经 `apps/server/src/modules/data-files` 的写管线
     —— `safeJoin → zod 整体校验 → 语法校验 → 陈旧检测（重试 1 次，仍冲突 409）→ pre_write 备份 → 原子写 → 失效缓存`，
     顺序不可变；
   - **其余域各写自己那份文件，但同样必须** `safeJoin` + pre_write 备份 + `common/fs/atomic-write.ts`：
     Markdown 文章与 about（`posts`）、上传图与相册 `info.json`（`media` / `albums`）、`src/config.ts` 受控子集（`site-config`）。
   - 全仓**禁止**裸 `fs.writeFile` / `writeFileSync` 落 Mizuki 根下文件；唯一例外是**备份恢复**（`infra/backup`）——
     它按 manifest 逐字节回灌，属恢复通道，不是内容编辑。
2. **文件即数据库**：集合内容只存在 `<mizukiRoot>/src/data/*.ts`，用 ts-morph 改 AST 而非文本替换。
   **禁止为集合内容建任何数据库表**（P4 六类 + 三期追加 anime，注册表共七条）。
3. **依赖分层**（`eslint.config.mjs` 的 boundaries，error 级）：
   **L0** = `packages/shared/src`、`server/src/{common,infra,config}` →
   **L1** = `modules/data-files` →
   **L2** = `modules/{collections,posts,albums,media,articles,settings}`（**L2 之间禁止互导**）→
   **L3** = `modules/{auth,system,process,backup}`（L3 之间允许）。
   `modules/{preview,site-config,theme}` 与 `test/` 不在 elements 清单内，不受 boundaries 约束，但同样遵守第 1、4 条。
4. **跨模块只有三条通道**：事件目录（`packages/shared/src/events.ts`）、媒体引用注册表（`common/registry`）、
   把共性升格到 `common/` 或 `shared`。事件名与 payload 只认 `EVENTS` 常量与 zod schema，禁写字符串字面量；
   订阅方必须**幂等**且异常内部捕获不冒泡。
5. **输入边界**：外部输入一律 zod（按路由 `@UsePipes(new ZodValidationPipe(Schema))`）；路径一律 `safeJoin`；
   外部命令只经 `cross-spawn` 且 `shell: false`，任务白名单硬编码（`install|dev|build|preview`），**不接受用户传参**。
6. **不泄内部信息**：对外错误文案不得含磁盘绝对路径（用相对投影，绝对路径只进 pino）；
   secret / token 不入日志；错误形状固定 `{ code, message, detail }`，`code` 取 `HttpException.constructor.name`。
7. **公开 API 已冻结**：P8 之后 `/public/**` 的路径与响应形状不再变更；管理 API 的成功状态码与错误形状是外部契约。
   改动前先看 ADR 与 `CHANGELOG.md`，必要时按 §10 记 ADR。
8. **TS 纪律**：`strict: true` + `noUncheckedIndexedAccess`，禁 `any`；不要放宽既有类型逃逸，也不要留下未用导入（lint 必须 0）。
9. **测试不碰真机**：测试数据隔离在 `mkdtemp` 临时域，**绝不**对真实 Mizuki 主题目录做写操作；
   fixtures 在 `apps/server/test/fixtures/`，本机 `.test-tmp/` 是 gitignored 临时验证区。

## 5. 后端模块地图

| 模块 | 层 | 阶段 | 职责 | 主要路由 |
|---|---|---|---|---|
| `data-files` | L1 | P3 | 引擎门面 `readCollection` / `mutateCollection`，8 步写管线 | —（内部） |
| `collections` | L2 | P4 | 集合 CRUD、id 生成与值域迁移（ADR-014/018）、`content.changed` | `/admin/collections/:type`、`/public/collections/:type` |
| `posts` | L2 | P5 | Markdown 文章（目录式 + 单文件）、about、`article` 表 markdown 索引 | `/admin/posts*`、`/admin/about` |
| `articles` | L2 | P8 | 富文本（TipTap `doc_json` → sanitize `html_cache`）、统一索引、公开混合分页 | `/admin/articles*`、`/public/articles*` |
| `albums` | L2 | P7 | `public/images/albums/<名>/info.json` + 图片，非 JPG 自动转 JPG | `/admin/albums*` |
| `media` | L2 | P7 | 上传五件套（白名单→魔数→上限→随机名→sharp 重编码去 EXIF）+ `media_file` 索引 + 引用检查 409 | `/admin/media*` |
| `settings` | L2 | P8 | `site_setting` key-value | `/admin/settings` |
| `auth` | L3 | P6 | argon2id + jose HS256 双 token（access 15m / refresh 7d 轮换）、登录 5 次/分、失败锁定、`token_version` | `/admin/auth/*` |
| `system` | L3 | P0a/P6 | health、Mizuki 四项检测、init 一次性、运行模式 | `/system/health`、`/admin/system/*` |
| `process` | L3 | P9 | 任务白名单 + pm-resolver（ADR-011）+ 环形日志 2000 行 + SSE + tree-kill 停组 | `/admin/process/*` |
| `backup` | L3 | P2 | 备份 / 恢复（restore 需 `confirm: true` 且先备份） | `/admin/backups*` |
| `preview` | — | ADR-019 | 静态 dist 预览通道：独立监听、仅 GET、cookie JWT、扩展名白名单 | `/preview/*` |
| `site-config` | — | ADR-020 | `config.ts` 受控子集物化读写 + 侧车 override | `/admin/config*` |
| `theme` | — | ADR-024 | 主题档案与漂移基线、写入门禁 | `/admin/theme/*` |

**装配顺序**（`main.ts` → `app.module.ts`）：`bootstrap` → `configureApp`（全局前缀 + helmet + CORS + 异常过滤器）
→ 条件 swagger → `site-assets` 通道 → 静态面板 → `listen`；模块注册顺序 `Throttler → EventEmitter → Db/Backup/Registry → 领域模块`，
全局守卫次序为**先限流后鉴权**。全局 `@Public()` 豁免放在 `common/decorators`。

## 6. 前端地图（`apps/web`）

- **请求层** `src/api/http.ts`：统一前缀 `/api/v1`；401 自动 refresh 并**重放原请求一次**（并发共享同一个 Promise）；
  refresh 三态 `ok | rejected | network`，只有 `rejected` 清 token（弱网不掉线）。
- **路由** `src/router/index.ts`：`/login`、`/init` 公开；其余需登录；manage 模式隐藏 `/articles*`。
- **页面**：仪表盘、集合（`/collections/:type` 动态组件）、Markdown 文章（列表 / 编辑 / about）、富文本（列表 / 编辑）、
  媒体库、相册（列表 / 详情）、备份、控制台（SSE 日志）、设置、站点配置。
- **编辑器三件套** `src/lib/editors/`：CodeMirror（Markdown + frontmatter 表单）、Vditor、TipTap（富文本，位图粘贴/拖拽直传）。
- **表单** `src/lib/schema-form/`：由 zod schema 生成 Element Plus 表单（ADR-007）。
- **图片与引用**：`src/lib/image-src.ts` 是拼 src 的唯一出口（相对路径拼 `/site-assets/…`，`http/data/blob` 原样）；
  `src/lib/media-ref.ts` 是引用形态中心 —— 内容字段一律存**站点 URL 形态** `/images/...`，不要存 `public/images/...`。
- **状态**：`stores/auth.ts`（localStorage；refreshToken 只用于 refresh）、`stores/system.ts`（运行模式，失败 fail-open）。
- **构建要点**：vite 把 `@mizuki/shared` 别名指到 `src/index.ts`（shared 的 CJS 产物 rollup 无法静态分析 `__exportStar`）；
  dev 代理 `/api` 与 `/site-assets` → 20154。

## 7. 数据与运行时目录

- **SQLite**（`apps/server/data/mizuki.db`，Drizzle，12 表）：`admin_user`、`article`、`article_content`、`category`、
  `tag`、`article_tag`、`comment`（休眠，ADR-016）、`operation_log`、`backup_record`、`media_file`、`site_setting`、
  `task_run`（[U3-P3/K3] 任务运行历史）。
- `article` 是**两源统一索引**（`source_type` = `markdown | richtext`），富文本正文与 `html_cache` 在 `article_content`。
- `apps/server/data/` 已被 gitignore（仅 `README.md` 与 `backups/.gitkeep` 入库）。本机**已初始化**：
  `config.json` 指向本机 Mizuki 主题目录（绝对路径，不入库）、`mode: manage`，并含一条 `jwtSecret`
  —— 因此初始化向导会返回 409，属正常，别当 bug 修。
- 备份：`data/backups/<时间戳>-<nanoid>/manifest.json`（原路径 + sha256），`pre_write` 保留 10 份。
- 侧车与基线：`data/config-override.json`（ADR-020）、`data/theme-baseline/baseline.json`（ADR-024），均 gitignored，随 `data/` 一起迁移。

## 8. 端口与环境变量

**端口**：`20154` 主服务（API + 面板同源）／`20155` 面板 dev／`4173` 预览通道（占用则启动报错，设 `0` 取临时端口）。

| 变量 | 缺省 | 说明 |
|---|---|---|
| `MIZUKI_SERVER_PORT` | `20154` | 主服务端口 |
| `MIZUKI_WEB_DIST` | `apps/web/dist` | 面板静态托管目录（不存在则只跑 API） |
| `MIZUKI_CONFIG_PATH` | `apps/server/data/config.json` | 配置文件覆盖 |
| `MIZUKI_DB_PATH` | `apps/server/data/mizuki.db` | SQLite 覆盖 |
| `MIZUKI_JWT_SECRET` | 无（init 生成并持久化） | 生产注入通道，优先于 config.json（ADR-005） |
| `MIZUKI_LOG_LEVEL` | `info` | pino 级别 |
| `MIZUKI_PM_<NAME>_PATH` | 无 | 包管理器显式路径（`NAME` ∈ pnpm/npm/yarn） |
| `MIZUKI_PREVIEW_PORT` / `_HOST` / `_DIST_PATH` | `4173` / 镜像主服务 host / `<mizukiRoot>/dist` | 预览通道（请求期活读） |
| `MIZUKI_CONFIG_OVERRIDE_PATH` | `apps/server/data/config-override.json` | 站点配置侧车路径 |
| `MIZUKI_THEME_BASELINE_PATH` | `apps/server/data/theme-baseline/baseline.json` | 主题漂移基线 |

另有非配置消费的 `PATH`（pm-resolver 定位器）。**公网部署**：`config.json` 置 `"swagger": false`，
走 https + 反向代理；前后端分离或自定义域名时必须登记 `corsOrigins`，否则浏览器因缺 CORS 头拒绝跨源请求。

## 9. 工作树现状与未清项（进仓先看一眼）

- HEAD = 发布提交 **v1.0.0**（2026-10-20；含 U3-P3 二期规格兑现批：向导目录点选 / 控制台历史与模板 / 相册 items 统一输出，
  交付报告 `docs/audits/u3-p3/README.md`，数账 **546/546、62 文件**，三连全绿）。
  **版本**：`v1.0.0` tag，四处 package.json = 1.0.0；双语 README（`README.md` 中文 + `README.en.md` 英文）。
- **发布前历史脱敏（2026-10-20，方案 B）**：未推送段经 `git filter-repo --replace-text` 重写——密码明文→`<redacted>`、
  本机绝对路径→占位符（`<repo-root>` / `<user-home>` / `<system-temp>` / `<pnpm-store>`）。**旧哈希已全部失效**：
  台账/ADR 中引用的 d99ab9d、23c6763、2b22479 等对应重写后为 27b7f10、17794c8、2e8790c 等（以 `git log` 实际值为准）；
  备份分支 `pre-scrub-backup-20261020` 与 `.test-tmp/pre-scrub-backup-20261020.bundle` 保留脱敏前原貌（**勿推送**）。
  已公开段两处残留（HANDOFF-ARCHITECT 旧事故行）已在本发布提交做前向清洁。
- 早前批次的已入库结论：面板自定义主题（ADR-026）+ 本机 web 构建打通（ADR-027）。
  U3-P3 批**未引入任何依赖变更**：`pnpm-lock.yaml` 与三处 `package.json` 依赖清单零变动。
  （`M README.md` 媒体白名单订正已随 `bd3b1fa` 入库。）
- **本机构建状态（2026-10-16 实测，已解决）**：`pnpm build` = `shared → server → web` **exit 0**
  （1903 modules / 18.71s），构建前后 `<system-temp>` 的 `esbuild-*` 残渣均为 0。此前的失败
  （`vite:esbuild-transpile` 大输入临时文件 `Access is denied`；dev 的 `.vite/deps_temp_*` 写出被拒）
  经五组对照钉死为**环境侧对 esbuild 子进程大输入临时文件清理的拒绝**，已按 **ADR-027** 在
  `apps/web/vite.config.ts` 绕开（`build: { target: 'esnext', minify: false, cssMinify: 'esbuild' }`）：
  不再对 chunk 做语法降级与 JS 压缩，>1 MiB 链路不触发。代价＝未压缩产物（JS 6.08 MB / gzip 1.35 MB，
  部署侧需 gzip/br），一行可回退。**勿用 `manualChunks` 拆 element-plus 去复现「绿色 build」——
  实测运行期 TDZ 崩溃（环形 chunk 破坏 ESM 求值序）。** 见 ADR-027 与 `docs/SESSIONS.md` 本轮记录。
- **本机 `pnpm test` 全绿**（2026-10-20 实测，U3-P3 批）：**62 文件 / 546 用例全绿**
  （全量单批 `--maxWorkers=1`；分批 <=6 文件亦全绿）。此前记的「本机 484/490，失败在 p9 进程链」
  系 **DSH 运行时无 npm/pnpm** 时的表现；在具备 pnpm 的普通终端里已不复现。
- **非本仓产物**（2026-10-06 落盘，均未跟踪）：`.acl-recovery/`、`.mnemosyne-test/`、`dump-config-final.txt`、
  `junction-snapshot-20261006.txt`。别当项目内容，也**不要在未确认前删除**。
  （同期的 `cordis.patch.yml` 与 `README.zh.md`——DSH 插件脚手架残留——已于 2026-10-15 经确认删除。）
- 目录名后缀 `-recovery-20260911` 与 `data/backups/20260911*` 来自 2026-09-11 的恢复重建（提交 `1fb04b0`）。
- **媒体白名单口径（曾漂移，已订正 2026-10-15）**：根 `README.md` 曾写六格式（ADR-013 时代口径），已改为终集
  九扩展名 `jpg/jpeg/png/gif/webp/avif/bmp/tiff/tif`（ADR-017，`svg` 排除；**媒体库面 bmp 防御拒绝、相册面准入**）。
  权威源：`docs/decisions/ADR-017-upload-whitelist-final.md` 与 `modules/media/media.service.ts` 的常量。
- **未清项**：C7 疑问②（`config.ts` 物化态的面板警示）、C3 项 6（POSIX 真机抽查）、用户手验清单待回；
  E 批 **E1.5 / E3b / E2 冻结**（积分枯竭，解冻顺序 E1.5 → E3b → E2）；
  流程规则候选 R5（恢复后审计）、R6（数账只认全绿轮）待转正入 `docs/PROCESS-RULES.md`。

## 10. 开发流程与文档落点

- **分阶段提示词驱动**：一次会话只做一个阶段。提示词在 `docs/prompts/`（`INDEX.md` 是阶段顺序表 + 人工关卡），
  二期批次在 `docs/prompts-phase2/`。
- **事实源**：结构与阶段划分、锁定技术栈看 `docs/MASTER-PLAN.md`；字段与行为看 `docs/REQUIREMENTS.md`
  （另有 `REQUIREMENTS-PHASE2.md` / `REQUIREMENTS-PHASE3.md`）；每条取舍落 `docs/decisions/ADR-0xx-*.md`。
- **记录**：每个阶段收尾写 `docs/SESSIONS.md`（活跃卷：数账 + §commit）与 `CHANGELOG.md`；大块报告放 `docs/audits/`。
- **跨阶段铁律** `docs/PROCESS-RULES.md`：R1 从请求/页面派生 host，禁硬编码 `127.0.0.1`；R2 前置条件条件化；
  R3 缺失/空/非法/合法四格语义；R4 结论复用需域验证。
- **人工关卡**：P0b（数据库定型）、P3（数据文件引擎）、P6（安全边界）、P8（公开 API 定型）完成后必须停下等人确认。
- **提交纪律（用户约定）**：未经明确许可**不 push**；成批提交（先改完，再提交一次）；发布前核对不含本机绝对路径、
  密钥、`.env`；GitHub 项目需中英双 README。

## 11. 常见任务导航

- **加/改一个 API**：controller 挂 zod pipe → service 复用 `common/` 单源能力 → 补 e2e（`apps/server/test/*.e2e-spec.ts`）
  → 跨模块联动走事件，不直接 import 别的领域模块。
- **改集合字段**：`packages/shared/src/collections/*.ts`（前后端共用）→ `modules/collections/registry.ts`
  → 需要时按 ADR-018 口径加迁移 → 面板表单自动跟随（schema-form 驱动）。
- **加一个面板页**：`views/` 新建组件 → `router/index.ts` 注册 → `api/` 加客户端 → `layouts/MainLayout.vue` 加菜单。
- **改站点配置受控子集**：`packages/shared/src/{site-config,nav-config}.ts`（`.strict()` 兜底禁蔓延）
  → `modules/site-config` 物化写入器 → `views/settings/SiteConfigPage.vue`；注意侧车漂移与「保存后需跑 build 才生效」。
- **动媒体或相册**：上传五件套 + 引用注册表；被引用的媒体删除必须 409 并给明细。
- **动预览通道**：先读 ADR-019（三档缓存、扩展名白名单、cookie 隔离）与 e2e `p9d-preview`。
- **跑不动测试**：先看 §3 的 vitest 分批与 `@mizuki/shared` 构建顺序，再看这份改动是否碰了真实 Mizuki 目录。

## 12. 文档索引（按需再读）

| 想了解 | 读 |
|---|---|
| 技术栈与六条架构决策、表结构、安全白名单、AI 编码规则 | `docs/MASTER-PLAN.md` |
| 功能字段与行为（一/二/三期） | `docs/REQUIREMENTS.md`、`REQUIREMENTS-PHASE2.md`、`REQUIREMENTS-PHASE3.md` |
| 每条取舍的来龙去脉 | `docs/decisions/ADR-000-template.md` … `ADR-020-config-override.md`、`ADR-010-upload-format-policy.md`、`ADR-026-panel-custom-theme.md`、`ADR-027-web-build-esbuild-bypass.md` |
| 安全复查 9 条 + 规格核对 | `docs/SECURITY-REVIEW.md`、`docs/SPEC-ALIGNMENT-B4.md` |
| 跨阶段铁律 | `docs/PROCESS-RULES.md` |
| 部署与 12 个环境变量 | `docs/DEPLOYMENT-CHECKLIST.md` |
| 开发台账（数账、事故、未清项） | `docs/SESSIONS.md` + `docs/SESSIONS-ARCHIVE.md` |
| 阶段级变更 | `CHANGELOG.md` |
| 重构与恢复审计 | `docs/audits/`（`phase4-refactor-review.md`、`phase4-refactor-implementation.md`、`phase4-d4/d4g-recovery-audit.md`） |
| 主题侧规格摘录 | `docs/refs/mizuki-docs/` |
| 目录树与模块→阶段映射 | `docs/STRUCTURE.md`、`docs/README.md` |

**ADR 缺口**：`docs/decisions/` 现存 `ADR-000` ~ `ADR-020`（**ADR-010 已于 U3-P3 补建**：
`ADR-010-upload-format-policy.md`，上传格式策略全弧）与 **`ADR-026`（面板自定义主题）、
`ADR-027`（web 构建绕行）**（后两者 2026-10-16 新建）；
代码里另引用 **ADR-022**（外链相册 src 写入口径）、
**ADR-024**（theme-lock 双轴与门禁）、**ADR-025**（`deriveStatus` 的 `published === false` 兼容分支，禁删改），
但这些编号**没有对应文件**——遇到它们时以代码内标签（`[Phase4-…/ADR-0xx]` 注释）加 `CHANGELOG.md` / `docs/SESSIONS.md` 为准。
**下一空号 028**（021/023 亦无文件但编号已按语境预留，勿回填）。

**本文件与源码冲突时**：先查 `CHANGELOG.md` / `docs/SESSIONS.md` 是否已解释该差异，再把本文件改对——不要默默按旧描述改代码。
