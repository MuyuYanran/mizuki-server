# U3-P4a — 任务级环境变量注入 + 番剧/B站配置档纳管（A-GAP-07 / A-GAP-11≡B-P2-05）

> [签发] 架构师 2026-10-21。执行方：用户指定模型通道。**完成即停**，交回报告等验收。
> [前置] HEAD = `fcfe914`（v1.0.0 + CI 修复收尾）。基线 **546 用例 / 62 文件**（全量单批 `--maxWorkers=1`）；
> 三连全绿；CI run 11 首绿（`65a25cc`）。本包所有 file:line 均按该 HEAD 实读。
> [PM 裁定] 2026-10-21 U3-P4 九项裁定（`docs/audits/feature-alignment/README.md` §8）：
> 本批兑现**立项项 A-GAP-07 + A-GAP-11**（两项同批——一个给凭据、一个给开关，拆开价值减半）。

## 0. 三处架构师再裁（执行方不得偏离；发现与事实冲突**停下报告**）

**再裁 A（env 的落点形态）**：**不放进 `tasks[]` 模板**。现有 `TaskTemplateSchema = {name, task, description?}`
（`config/app-config.ts:22-26`）是「白名单任务的命名快捷预设」，一个模板对应一次点击；
而 `BILI_SESSDATA` 这类变量是**任务运行期环境**，对同类任务恒生效 —— 挂到模板会造成
「同名任务换个模板就丢凭据」的随机行为。裁定：新增**配置根级** `taskEnv: Record<string,string>`，
对**所有**白名单任务的子进程生效（`install/dev/build/preview` 一致）。

**再裁 B（写后不可读）**：`taskEnv` 的值按 **secret 处理**：GET 只回 `{ key, masked }`（`masked` = `••••` + 末 4 字符，
长度 <8 时整体掩码），**永不回明文**；PUT 为**整表替换**语义（面板增/删/改后整表提交）。
理由：`BILI_SESSDATA` 是 B 站账号 cookie，泄露 = 账号被盗；本仓已有「secret 不入日志」红线（AGENTS §4-6）。

**再裁 C（A-GAP-11 的物化落点）**：`anime` / `bangumi` / `bilibili` 三键在主题 `src/config.ts` 里是
**`siteConfig` 对象的成员**（审计口径 config.ts:57-69），因此走 **`spliceSiteInfo` 同款逐属性置换**
（`site-config.service.ts:612-659`：逐键 `setInitializer` + `originals['siteConfig.<key>']` 留档），
**不得**用 `spliceWholeDeclaration` 整档置换（会吃掉用户注释与未受管成员）。
新建**独立路由域** `PUT admin/config/anime`，不扩张既有 `site-info` 的 15 键契约。

## 1. 事实基座（已实读核实，执行方可抽验）

### 1.1 进程侧（A-GAP-07）
- `process-manager.service.ts:476-493` `childEnv()`：**只透传** `PATH` / `HOME` / `APPDATA` 三个宿主变量，
  再恒定写 `CI='true'`（注释明示：取宿主 CI 会破坏「env 仅白名单透传」的泄漏防线，故写常量）。
- `:495-503` `buildSpawnOptions(cwd)`：`{ cwd, env: childEnv(), detached: process.platform !== 'win32', shell: false }`
  —— **env 的唯一注入点**；`pm-resolver` 的探活也经 `childEnv()`（`withPathEnv` 在其上叠加 PATH），
  故改动此处即两路一致。
- `:469` `taskArgs(task, pm)`：`install` → `['install']`（yarn 无参）/ 其余 → `['run', task]`。
- `config/app-config.ts:29-60` `AppConfigSchema`（zod）；`:22-26` `TaskTemplateSchema`（`.strictObject`）；
  `:12` 从 `@mizuki/shared` 取 `TASK_WHITELIST`（单源 `packages/shared/src/process-tasks.ts:19`；
  `process-manager.service.ts:47` 保 re-export）。
- 配置**活取**：`getAppConfig()` 每请求读取（P11 坑 5 先例；U3-P3 已据此把模板做成"写 config.json 免重启"）。
- **落点安全性已核**：`apps/server/data/` gitignored；备份面 `infra/backup/backup.service.ts:270-295`
  只收 `<root>/src/data/*.ts|*.json` + `<root>/src/content/**`（`full` 另加 db）→ **`config.json` 不进任何备份**。

### 1.2 配置物化侧（A-GAP-11）
- `site-config.controller.ts`：`@Controller('admin/config')`，现有 `GET /`（:42）、`PUT /lang`（:48）、
  `PUT /comments`（:57）、`PUT /nav`（:67）、`PUT /site-info`（:81）、`PUT /profile`（:91）、`PUT /announcement`（:101）。
- `site-config.service.ts`：`getConfig()`（:130）产出 `AdminSiteConfigView`（各域 override 优先、基线回落）；
  `putSiteInfo()`（:238）→ `spliceSiteInfo()`（:612-659）；`writeOverride()`（:311-313，原子写侧车）。
- `packages/shared/src/site-config.ts`：`SiteInfoSchema`（:248-266，15 键，`.strict()`）、
  `SITE_INFO_KEYS`（:272，序 = schema 定义序，禁手工重排）、`ConfigOverrideFileSchema`（:340-362，
  含 `siteInfo` / `profile` / `announcement` 与 `originals` 记录）。
  **该文件 :65-67 已显式声明**：`keywords / bangumi / bilibili / anime / showCoverInContent / generateOgImages /
  favicon / showLastModified / pageProgressBar / thirdPartyAnalytics` 为**不受管**（标注"A-GAP-11，后批"）
  —— 本批只解禁其中 `anime` / `bangumi` / `bilibili` 三键，其余**仍然不动**（改注释时逐字保留其余键名）。
- 主题侧类型源：`<mizukiRoot>/src/types/config.ts`（`AnimeConfig` / `BangumiConfig` / `BilibiliConfig`）。

## 2. 架构裁定 K

**K1（`taskEnv` schema）**：`AppConfigSchema` 增
`taskEnv: z.record(z.string(), z.string()).default({})`，配 `superRefine` 三条硬约束：
① **键名白名单前缀**：只允许 `BILI_` / `ANIME_` / `ENABLE_` / `CONTENT_` 四个前缀（不区分大小写地校验后要求**大写**形态），
其余键 → 校验失败（走 config 既有失败语义，执行方实读 `loadAppConfig` 的 safeParse 回退行为并在报告披露）；
② **禁止覆盖安全键**：`PATH` / `HOME` / `APPDATA` / `CI` 一律拒绝（防面板改写子进程 PATH 与 CI 常量）；
③ **上限**：键数 ≤ 16、单值长度 ≤ 4096、键名 ≤ 64 字符。`config.json` 缺 `taskEnv` → 缺省 `{}`（**向后兼容，零迁移**）。

**K2（注入点，单点）**：`childEnv()` 内部先取白名单透传，再 `Object.assign` 合并 `getAppConfig().taskEnv`，
最后**恒写** `CI='true'`（顺序不可变：`taskEnv` 永远不能覆盖 `CI`）。**`buildSpawnOptions` / `startTask` /
`resolveProjectSpawnPlan` 其余零改动**（执行方在报告里贴 diff 边界自证）。

**K3（REST，写后不可读）**：新增两端点（均需认证）：
- `GET admin/process/task-env` → `{ items: Array<{ key: string; masked: string }> }`（**按 key 字典序**；空表 → `items: []`）；
  响应类型进 `packages/shared`（如 `TaskEnvViewSchema`），前端零本地类型复制。
- `PUT admin/process/task-env` → body `{ entries: Record<string,string> }`：**整表替换**（`{}` = 清空，合法）；
  zod（`ZodValidationPipe`）套 K1 三条约束；成功返回与 GET 同形的掩码视图；写盘走 config 既有原子写通道
  （执行方复用现有 config.json 读写单源，**禁裸 `fs.writeFile`**，遵守 AGENTS §4-1）。
- `masked` 规则：`value.length >= 8` → `'••••' + value.slice(-4)`；否则 `'••••'`。

**K4（日志/错误脱敏）**：`taskEnv` 的值**不得**出现在 pino、异常 detail、`operation_log`、SSE 帧里。
执行方须：① 对 config 落盘/读取路径中可能 `logger.*({ config })` 的地方逐一核对（grep `taskEnv` 与 `getAppConfig()` 的日志调用）；
② PUT 校验失败的 `detail` 只回**键名**不回值；③ 报告里贴「全仓 grep `taskEnv` 的日志落点核对表」。

**K5（面板：任务环境变量区）**：`ConsolePage.vue` 增第三区「任务环境变量」（与既有模板区并列，SSE/启停/端口检测**一行不动**）：
掩码表格（key / masked / 删除）+ 「新增变量」行（key 输入 + value 密码框 + 提示"保存后不可再查看"）+ 「保存」整表提交。
写操作二次确认（沿用既有 `ElMessageBox.confirm` 惯例）。**禁止**在任何前端状态里持久化明文值。

**K6（shared：anime 域 schema）**：`packages/shared/src/site-config.ts` 新增
`AnimeConfigSchema` / `BangumiConfigSchema` / `BilibiliConfigSchema` 与聚合 `SiteAnimeSchema`
（= `{ anime, bangumi, bilibili }` 三键，`.strict()`），**字段面以主题 `src/types/config.ts` 为准逐键对齐**
（零删减、零改名、零自创；只加值域约束如 URL/枚举/整数区间）。执行方须把实读的类型片段贴进报告；
若主题实况与审计表所列键（`anime.mode`、`bangumi.userId`、`bilibili.{vmid,fetchOnDev,coverMirror,useWebp}`）
**有出入，以主题类型为准并披露差异**。
同时 `ConfigOverrideFileSchema` 增 `siteAnime: SiteAnimeSchema.partial().optional()`（缺键 = 未设置 = 基线生效），
并把 :65-67 的不受管注释改为「三键已于 U3-P4a 纳管，其余仍不受管」——**其余键名逐字保留**。

**K7（站点配置物化与路由）**：`site-config.service.ts`：
- 新增 `SITE_ANIME_KEYS = ['anime','bangumi','bilibili'] as const`（shared，序 = 定义序）；
- 把 `spliceSiteInfo` 的循环体抽成 `spliceSiteKeys(configPath, carrier, values, keys, kind)`（**行为逐字等价**，
  既有 `spliceSiteInfo` 改为一行委托，回归由既有 p7i/p7f 全量保证）；
- 新增 `spliceSiteAnime()`（委托上者，`originals['siteConfig.anime'|'siteConfig.bangumi'|'siteConfig.bilibili']` 留档）
  与 `putSiteAnime(values)`；`getConfig()` 视图增 `anime: { effective, override }` 形状（**与既有 siteInfo 域同构**，
  执行方照抄 `siteInfo` 字段的组装方式，保持前端可复用同一渲染逻辑）；
- `site-config.controller.ts` 增 `PUT admin/config/anime`（body = `SiteAnimeSchema.partial()`，`.strict()` 越界 400）。
**不变量**：`PUT /site-info` 的 15 键契约、`SITE_INFO_KEYS`、`originals` 既有键形**零变化**。

**K8（面板：站点配置页新分区）**：`SiteConfigPage.vue` 增「番剧与 B 站」分区（折叠面板，默认收起）：
`anime.mode` 下拉 + `bangumi` / `bilibili` 子表单（键面由 shared schema 驱动，优先复用既有 `schema-form`）；
回显 override 优先、基线回落；保存走 `PUT admin/config/anime`；页内提示「保存后需跑一次 build 才在站点生效」
（与既有站点配置分区文案一致）。**不消费 `SiteInfo` 的 15 键表单**（两个分区互不影响）。

**K9（台账）**：`docs/audits/feature-alignment/README.md` §8.1 的 A-GAP-07 / A-GAP-11 行标注「已交付（U3-P4a）」；
`docs/SESSIONS.md` 交付段 + `CHANGELOG.md` 批次条目 + `AGENTS.md` §5 process 行的 env 说明（一句）。
交付报告落 `docs/audits/u3-p4a/README.md`（证据行号、K/I 对照、用例明细、三连实录、偏差披露）。

## 3. 不变量 I

- **I1** 零新依赖：`pnpm-lock.yaml` 与四处 `package.json` 依赖清单零变动。
- **I2** 红线：写盘只走既有单源（config.json 原子写；`src/config.ts` 走 `site-config` 物化器）；
  测试全 `mkdtemp`，**绝不**碰真实 Mizuki 目录；不碰 `.git/`；不 push。
- **I3** 公开 API `/public/**` **零 diff**（本批不涉及）。
- **I4** 管理 API 仅 additive：新增两端点 + `AdminSiteConfigView` 增 `anime` 字段；**既有响应形状与状态码零变化**。
- **I5** secret：`taskEnv` 值不出现在任何响应/日志/错误 detail/SSE（K4 自证）。
- **I6** `childEnv()` 既有语义保持：`PATH/HOME/APPDATA` 透传 + `CI='true'` 恒在（K2 顺序不可变）。
- **I7** 数账：全绿轮计入；本批净增 **+16~18**（p9f ≈ 8 + p7k ≈ 8），报告列明细。

## 4. 测试落位

- 新建 `apps/server/test/p9f-task-env.e2e-spec.ts`（建议 8 例，命名空间 `p9f` 经 `ls` 确认未占用）：
  ① 空表 GET → `items: []`；② PUT 两条 → GET 掩码（`••••`+末4，短值全掩码）；③ **明文永不回**（响应体字符串 grep 断言不含原值）；
  ④ 前缀越界键（如 `FOO_BAR`）→ 400；⑤ 安全键（`CI` / `PATH`）→ 400 且错误 detail **不含值**；
  ⑥ 键数 17 → 400；⑦ 整表替换语义（旧键消失）；⑧ 注入生效：用一次真实受控任务（如 `build` 的桩/夹具）
  断言子进程 env 含新值——**执行方须复用 p9 既有 fixture/桩法**，禁连真机主题（AGENTS §4-9）。
- 新建 `apps/server/test/p7k-site-anime.e2e-spec.ts`（建议 8 例，`p7k` 未占用）：
  ① 无 override → `anime.effective` = 基线值；② PUT 部分键 → 仅该键物化、其余键**字节不变**；
  ③ `originals['siteConfig.anime']` 留档出现；④ 越界键 → 400（`.strict()`）；
  ⑤ 第二次 PUT 同键 → 不改 `originals`（首次原文本保留）；⑥ 清除 override（`PUT {}` 或既有清除惯例）→ 还原留档原文本；
  ⑦ `PUT /site-info` 回归（15 键契约不变）；⑧ config.ts 非受管成员（含注释）**逐字节不变**（写入前后取 diff）。
- 既有 spec 必跑回归：`p7f` / `p7h` / `p7i`（config 域）、`p9` / `p9b` / `p9e`（进程域）。

## 5. 验收口径与纪律

- **三连全绿**才交：`pnpm --filter @mizuki/shared build` → `pnpm test`（全量单批 `--maxWorkers=1`）→ `pnpm build` → `pnpm lint`（0/0）。
  数账申报格式：`test N/N（M 文件全绿单批）/ build 0 / lint 0:0`。
- **禁**：改 `SITE_INFO_KEYS` 或 `PUT /site-info` 契约；用整档声明置换做 anime；把 `taskEnv` 写进 `tasks[]`；
  在日志/响应回显 `taskEnv` 值；新增依赖；动 `apps/web` 之外的主题源码。
- 发现本包事实基座与实况不符（如行号漂移、主题类型键面不同）→ **停下报告**，不自行放宽。
- 报告必含：K1~K9 / I1~I7 逐条对照、`git diff --stat`、新增用例明细、两处"不可读"自证（响应体 grep + 日志 grep）、
  主题类型实读片段、偏差披露。

## §commit（建议，执行方可按实际拆分，但**禁 push**）

```
feat(U3-P4a): 任务级环境变量注入（taskEnv 白名单 + 掩码读取）与番剧/B站配置档纳管
```
