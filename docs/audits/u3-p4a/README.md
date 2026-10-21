# U3-P4a 交付报告 —— 任务级环境变量注入 + 番剧/B站配置档纳管

> [执行方报告] 2026-10-21。对应指令包 `docs/prompts-ui/U3-P4a-task-env-anime.md`
> （含执行期裁定补充）。基线 HEAD = `239ce0e`（包内写的 `fcfe914` 为其祖先，见偏差 D-3）。
> **本文只记执行方实测**；全量用例与 `pnpm build` 由架构师在收口轮执行（本批纪律：不跑全量、不 build）。

---

## 1. 落点一览

| 层 | 文件 | 内容 |
|---|---|---|
| L0 shared | `packages/shared/src/task-env.ts`（新） | `TaskEnvRecordSchema`（三条约束单源）、`maskTaskEnvValue`、`taskEnvViewOf`、`TaskEnvEntrySchema` / `TaskEnvViewSchema` / `PutTaskEnvBodySchema` |
| L0 shared | `packages/shared/src/index.ts` | 导出 `./task-env` |
| L0 shared | `packages/shared/src/site-config.ts` | `AnimeConfigSchema` / `BangumiConfigSchema` / `BilibiliConfigSchema` / `SiteAnimeSchema` / `SITE_ANIME_KEYS` / `PutSiteAnimeBodySchema`；`ConfigOverrideFileSchema` 增 `siteAnime`；不受管注释按 K6 改写（其余键名逐字保留） |
| L0 config | `apps/server/src/config/app-config.ts` | `AppConfigSchema.taskEnv`（缺省 `{}`，零迁移） |
| L3 process | `apps/server/src/modules/process/process-manager.service.ts` | `childEnv()` 合并 `taskEnv`（透传 → taskEnv → 恒写 CI）；新增 `listTaskEnv()` / `putTaskEnv()` |
| L3 process | `apps/server/src/modules/process/process.controller.ts` | `GET/PUT admin/process/task-env` |
| site-config | `apps/server/src/modules/site-config/site-config.service.ts` | `spliceSiteInfo` 循环体抽为 `spliceSiteKeys(...)`（一行委托）、`spliceSiteAnime()`、`putSiteAnime()`、`readSiteAnimeBaseline()`、`getConfig().anime` |
| site-config | `apps/server/src/modules/site-config/site-config.controller.ts` | `PUT admin/config/anime` |
| web | `apps/web/src/api/config.ts` / `process.ts` | 视图字段 + `putSiteAnime()` / `listTaskEnv()` / `putTaskEnv()`（taskEnv 类型直接引用 shared） |
| web | `apps/web/src/views/settings/SiteConfigPage.vue` | 「番剧与 B 站」折叠分区（schema-form 驱动，默认收起） |
| web | `apps/web/src/views/process/ConsolePage.vue` | 「任务环境变量」区（掩码表格 + 新增行 + 保存整表 + 二次确认） |
| test | `apps/server/test/p9f-task-env.e2e-spec.ts`（新，8 例）、`apps/server/test/p7k-site-anime.e2e-spec.ts`（新，8 例） | 全 `mkdtemp` 隔离 |

无新增依赖、无删除文件、未改 `/public/**`。

---

## 2. 主题类型实读片段（K6 依据）

来源：`<mizukiRoot>/src/types/config.ts`（本机 `config.json` 的 `mizukiRoot`，**只读**）。
三类配置**不是命名类型**，而是 `SiteConfig` 的匿名内联成员，**全部字段可选**：

```ts
	// 添加bangumi配置
	bangumi?: {
		userId?: string; // Bangumi用户ID
		fetchOnDev?: boolean;
	};

	// 添加bilibili配置
	bilibili?: {
		vmid?: string; // Bilibili用户ID (vmid)
		fetchOnDev?: boolean; // 是否在开发环境下获取 Bilibili 数据
		coverMirror?: string; // 封面图片镜像源（可选，默认为空字符串）
		useWebp?: boolean; // 是否使用WebP格式（默认 true）
	};

	// 添加番剧页面配置
	anime?: {
		mode?: "bangumi" | "local" | "bilibili"; // 番剧页面模式
	};
```

主题 `src/config.ts` 中三键同处 `siteConfig` 对象（`bangumi` :57-60、`bilibili` :61-66、`anime` :67-69），
与指令包「审计口径 config.ts:57-69」一致。

**与审计表的差异**：审计表漏列 `bangumi.fetchOnDev`；本批按主题实况**纳入**（见偏差 D-1）。

---

## 3. K1~K9 逐条对照

| 裁定 | 状态 | 证据 |
|---|---|---|
| **K1** `taskEnv` schema + 三条约束 | 做到 | `packages/shared/src/task-env.ts`：前缀白名单 `BILI_/ANIME_/ENABLE_/CONTENT_`（大小写不敏感比对 + 强制大写形态）、禁 `PATH/HOME/APPDATA/CI`、条数≤16/键名≤64/值≤4096；`app-config.ts:69` 以 `.default({})` 挂到配置根级。非法写法走 `loadAppConfig` 既有失败语义（`safeParse` 失败 → `logger.error` + 抛错，启动即失败），**不静默丢弃** |
| **K2** 注入点单点、顺序不可变 | 做到 | `childEnv()` 内仅新增一行 `Object.assign(env, getAppConfig().taskEnv)`，位于透传循环之后、`env['CI']='true'` 之前；`buildSpawnOptions` / `startTask` / `resolveProjectSpawnPlan` **零改动**（`git diff` 边界见 §6） |
| **K3** REST 写后不可读 | 做到 | `GET admin/process/task-env` → `{items:[{key,masked}]}`（key 字典序，空表 `[]`）；`PUT` body `{entries}` 整表替换（`{}` 合法清空）；响应类型 `TaskEnvViewSchema` 在 shared，前端零本地类型复制；写盘走 `mergeAndPersistConfig`（原子写单源）。掩码规则：`len>=8 → '••••'+末4`，否则 `'••••'` |
| **K4** 日志/错误脱敏 | 做到 | 见 §7 grep 核对表：全仓 `taskEnv` 的日志落点只有 `{count}` 与 `keys:['taskEnv']`，无值、无内层键；400 `detail.issues` 只含键名与上限；pino/SSE/`operation_log` 均不含值（拦截器只记路由元信息） |
| **K5** 面板任务环境变量区 | 做到 | `ConsolePage.vue` 第三区（模板区之后、历史区之前）：掩码表格（key / masked / 删除）+ 新增行（key 输入 + `type="password"` 值）+「保存整表」+ `ElMessageBox.confirm` 二次确认；OK 后清空本地明文；SSE/启停/端口检测一行未动 |
| **K6** anime 域 schema | 做到（含 D-1 订正） | 三域 schema 逐字对齐主题、**每字段 `optional()`**、各自 `.strict()`；`SiteAnimeSchema` 三域必填 + `.strict()`；`SITE_ANIME_KEYS = ['anime','bangumi','bilibili'] as const`；`ConfigOverrideFileSchema.siteAnime = SiteAnimeSchema.partial().optional()`；:65-67 注释改写为「三键已纳管，其余仍不受管」，其余键名逐字保留 |
| **K7** 物化与路由 | 做到 | `spliceSiteKeys(configPath, carrier, values, keys, kind, restoreMissing?)` 抽取；`spliceSiteInfo` 改为一行委托（缩进推断 / `addPropertyAssignment` 缺失插入 / `originals` 首次留档全部保留，回归 p7f/p7i 全绿）；`spliceSiteAnime()` 走同函数（`originals['siteConfig.anime'|'siteConfig.bangumi'|'siteConfig.bilibili']`）；`putSiteAnime()`；`getConfig().anime = { effective, override }`；`PUT admin/config/anime`（`PutSiteAnimeBodySchema` 越界 400）。**不变量**：`PUT /site-info` 15 键契约 / `SITE_INFO_KEYS` / 既有 `originals` 键形零变化（p7i 16 例全绿，p7k ⑦ 显式断言） |
| **K8** 站点配置页新分区 | 做到 | `SiteConfigPage.vue` 增 `el-collapse-item name="anime" title="番剧与 B 站"`（`activeSections` 默认仅 `site-info` ⇒ 本区默认收起）；表单由 shared `SiteAnimeSchema` 驱动（`anime.mode` 经 mapper 渲染为下拉）；页内提示「按域整对象替换：未在表单出现的子键会被移除」+「保存后需跑一次 build」 |
| **K9** 台账 | **部分未做（交架构师）** | 台账与包内补充由架构师同步订正（本会话期间已见 `docs/audits/feature-alignment/README.md`、`docs/prompts-ui/U3-P4a-task-env-anime.md` 的**非本人**改动）；`docs/SESSIONS.md` / `CHANGELOG.md` / `AGENTS.md` §5 未由执行方改动，理由见偏差 D-7 |

---

## 4. I1~I7 逐条对照

| 不变量 | 状态 | 证据 |
|---|---|---|
| **I1** 零新依赖 | 做到 | `git status` 中 `pnpm-lock.yaml` 与四处 `package.json` 均未修改 |
| **I2** 写盘红线 | 做到 | config.json 走 `mergeAndPersistConfig`（`atomicWriteFile`）；`config.ts` 走 `site-config` 物化器（`pre_write` 备份 + 原子写）；测试全 `mkdtemp`，真实主题目录只读；未碰 `.git/`、未 push |
| **I3** `/public/**` 零 diff | 做到 | 本批未改任何 public 控制器/service |
| **I4** 管理 API additive | 做到 | 新增 2 端点（`task-env` GET/PUT）+ 1 端点（`config/anime` PUT）；`AdminSiteConfigView` 仅增 `anime` 字段；既有响应形状/状态码零变化（p7f 16 例、p7i 16 例、p4d3 未触及） |
| **I5** secret | 做到 | p9f ③ 断言 PUT/GET 原始响应文本不含任何提交值；⑤⑥ 断言 400 detail 不含值；pino 落点见 §7 |
| **I6** `childEnv()` 既有语义 | 做到 | `PATH/HOME/APPDATA` 透传与 `CI='true'` 恒在（p9 8 例、p9b 2 例、p9e 8 例全绿；p9f ⑧ 断言子进程 `PROBE_CI=true`） |
| **I7** 数账 | 做到 | 本批净增 **+16**（p9f 8 + p7k 8），落在 +16~18 区间 |

---

## 5. 新增用例明细

### `apps/server/test/p9f-task-env.e2e-spec.ts`（8 例，全绿）

| # | 断言 |
|---|---|
| ① | 空表 GET → `{ items: [] }` |
| ② | PUT 两条 → 掩码视图（`••••`+末4 / 短值整体掩码 / key 字典序）；GET 与 PUT 同形；落盘为明文 |
| ③ | 明文永不回显：GET 响应**原文**不含 LONG/SECOND/INJECT 三个值 |
| ④ | `FOO_BAR` → 400（`entries.FOO_BAR` 路径）、`bili_sessdata` → 400（须大写），detail 不含值，配置文件零改动 |
| ⑤ | `CI` / `PATH` / `HOME` / `APPDATA` → 400，detail 含键名不含值，零写盘 |
| ⑥ | 17 条 / 键名 >64 / 单值 >4096 → 400，零写盘 |
| ⑦ | 整表替换（旧键消失）；`{}` 清空后落盘 `taskEnv: {}` |
| ⑧ | 真实受控 `build` 任务（tmp 内探针项目）子进程 env 含注入值，且 `CI=true` 未被覆盖 |

### `apps/server/test/p7k-site-anime.e2e-spec.ts`（8 例，全绿）

| # | 断言 |
|---|---|
| ① | 无 override → `anime.effective` = 基线三域值，`override = null` |
| ② | PUT 仅 `anime` 域 → 该域物化；`bangumi`/`bilibili` 域块**逐字节不变**；`keywords` 不变 |
| ③ | `originals['siteConfig.anime']` 首次留档（含 `mode: "local"`）；未提交域不产生留档；侧车 `siteAnime` 只记提交域 |
| ④ | 域内越界键 / 顶层未知域 / 非法枚举 → 400 零物化（`overridePath` 不存在） |
| ⑤ | 第二次 PUT 同域 → `originals` 保持首次原文本（不被 override 污染） |
| ⑥ | `PUT {}` → 还原留档原文本（`mode: "local"` 回归）、侧车 `siteAnime` 消失、留档仍保留 |
| ⑦ | `PUT /site-info` 15 键契约不变（全键 200；把 `anime` 塞进 site-info body → 400）；三域不被 site-info 触碰 |
| ⑧ | 第一个受管域之前的全部文本（文件头注释 + 两个 const + 15 个 siteInfo 成员 + `keywords`）**逐字节相同**；受管域确实被整体替换 |

---

## 6. 实测记录（执行方本轮）

```
pnpm --filter @mizuki/shared build                                    → exit 0
vitest run test/p9f-task-env test/p7k-site-anime --maxWorkers=1       → 2 文件 / 16 用例全绿
vitest run test/p7f p7h p7i p7j --maxWorkers=1                        → 4 文件 / 41 用例全绿
vitest run test/p9 p9b p9e --maxWorkers=1                             → 3 文件 / 18 用例全绿
pnpm lint                                                             → exit 0（0 error / 0 warning，无输出）
vue-tsc --noEmit -p apps/web/tsconfig.json                            → exit 0（apps/web 不在根 eslint 覆盖面）
tsc -p apps/server/tsconfig.json --noEmit                             → exit 0
```

未执行（按本批纪律，交架构师）：`pnpm test` 全量、`pnpm build`。

---

## 7. K4「两处不可读」自证

### 7.1 响应体 grep（p9f ③⑤⑥）

- PUT/GET 的 `res.text` 逐值断言 `not.toContain(<明文>)`；
- 400 的 `res.text` 断言不含提交值（前缀越界 / 安全键 / 超长值三组）。

### 7.2 全仓 `taskEnv` 日志落点核对表

| 落点 | 记录内容 | 是否含值 |
|---|---|---|
| `app-config.ts` `logger.info({configPath})` ×2 / `logger.error({configPath}, message)` | 路径 + 校验 issue 文本（字段路径与消息） | 否 |
| `app-config.ts` `logger.info({configPath, keys: Object.keys(patch)})` | `['taskEnv']` 字面量 | 否（也不含内层键名） |
| `process-manager.service.ts` `logger.info({count})` | 条数 | 否 |
| SSE 帧（`LogEvent`） | 只有任务 stdout/stderr 行 | 否 |
| `operation_log`（P6 拦截器） | 路由/方法/状态等元信息 | 否 |

---

## 8. API 一览（本批新增）

| 方法 | 路径 | 成功 | 错误形状 |
|---|---|---|---|
| GET | `/api/v1/admin/process/task-env` | 200 `{ items: [{ key, masked }] }`（key 字典序） | 401（全局守卫） |
| PUT | `/api/v1/admin/process/task-env` | 200 同上（掩码视图） | 400 `{ code:'BadRequestException', message, detail:{issues:[{path,message}]} }`；401 |
| PUT | `/api/v1/admin/config/anime` | 200 `AdminSiteConfigView`（含 `anime.{effective,override}`） | 400 同上（`.strict()` 越界 / 非法枚举）；409（探针门禁）；404（`siteConfig` 形态不符）；401 |

---

## 9. 偏差与不确定项

- **D-1（实质差异，已按 K6 补充纳入）**：审计表漏列 `bangumi.fetchOnDev`（主题实有）。已纳入 schema 并披露。
- **D-2（表述差异）**：主题侧**没有** `AnimeConfig` / `BangumiConfig` / `BilibiliConfig` 三个命名类型（全仓 grep 只命中指令包本身）；三键是 `SiteConfig` 的匿名内联成员。本仓 schema 名沿用包内命名（自建），字段面按主题逐字对齐。
- **D-3（包头过期）**：包内写 HEAD = `fcfe914`，实况 `239ce0e`；`fcfe914..239ce0e` 三次提交**全 docs-only**，故包内所有 `file:line` 零漂移（逐条抽验通过）。
- **D-4（UX 取舍，K3 的必然推论）**：PUT 整表替换 + 明文不可读 ⇒ 面板无法回传未重输的既有值。面板实现为「只提交本次输入过值的键」，并在保存前二次确认**逐条列出将被移除的既有变量**；未改进服务端语义。
- **D-5（视图语义选择）**：`anime.effective` 逐域取 `override ?? 基线`（**域级**替换，非域内键级 merge），与物化语义严格一致；三域全不可得时返回 `{}`（非 null），`override` 缺省为 null。面板据此全字段回填。
- **D-6（降级分支）**：基线某域含未支持字面量 → 该域省略 + `logger.warn`（其余域不受牵连）；三域全不可得 → `effective = {}`，面板空档起步，保存即整域接管（原文本仍留档）。
- **D-7（K9 部分未做）**：`docs/SESSIONS.md` / `CHANGELOG.md` / `AGENTS.md` §5 及 `docs/audits/u3-p4a/README.md` 之外的台账条目**未由执行方改动**——架构师已声明同步订正台账，且其会话期间已在同两处文档落笔；执行方避免并发冲突。
- **D-8（口径待订正，非本轮改动）**：`docs/audits/feature-alignment/README.md` 的 **A-GAP-07 行**仍写「走 `config.json` 的 `tasks[].env`」，与 §0 再裁 A（配置**根级** `taskEnv`）不一致；本轮未改该文件（见 D-7），提请架构师一并订正。
