# 全仓结构与模块实现审查（重构优化提案）

> [性质] **提案，非裁决**。本文只做只读审查与方案设计，未改动任何代码（`git status --porcelain` 为空）。
> 凡触及对外错误语义 / 状态码 / 响应形状的条目，均在「待裁决」列显式标注，按 PROCESS-RULES
> 的分批纪律等待人工裁决后再纳入批次提示词。
> [基线] 工作树 `55b5a5e`（Phase4-D4e 终态）；后端 40 个测试文件 / 451 用例为回归安全网。
> [范围] `apps/server`（9,848 行）+ `apps/web`（9,466 行）+ `packages/shared`（862 行）。
> [审查日期] 2026-09-10。

---

## 0. 结论摘要

架构分层是**健康的**：`common`(L0) → `infra`(L1) → `modules`(L2) 的边界有 eslint boundaries
强制，跨模块交互统一走事件总线与注册表（无 L2 互 import），六类集合「文件即数据库」与
SQLite 索引的职责切分清晰，注释密度与决策溯源（ADR 编号 / 裁决原文）在同类项目里属上乘。

问题集中在**同一模式被复制到多处后各自演化**，由此派生三类后果：

| 类别 | 数量 | 说明 |
|---|---|---|
| 逐字复制（机械等价，纯重构可消） | **9 组 / 约 35 处** | 原子写 ×9、root 解析 ×8、zod→400 映射 ×5、sha256 ×5 … |
| 复制后**语义漂移**（重复的代价已兑现） | **4 组** | 见 §3.2，其中 1 组已构成必现 500 |
| 与既有纪律/文档**背离** | **2 组** | 绝对路径入响应体、CORS 死代码 |

**净收益预估**：新增共享模块约 9 个文件，可消除重复实现 **约 500±80 行**；闭合 **3 处真实缺陷**
（1 处必现 500、1 处未爆发索引错误、1 处静默失效功能）；统一 **2 组安全加固口径**。
所有条目均设计为**逐字节等价替换**，对外路由、响应形状、成功状态码零变更。

---

## 1. 模块清单与职责

### 1.1 工作区

| 单元 | 职责 | 规模 |
|---|---|---|
| `apps/server` | NestJS 11 + Drizzle/SQLite；API 与面板同源（默认 20154） | 9,848 行 / 76 文件 |
| `apps/web` | Vue 3 + Element Plus 管理面板（含自研 schema-form 与三编辑器） | 9,466 行 / 53 文件 |
| `packages/shared` | 前后端共享 zod schema / 事件契约 / Tier1 档案（无业务逻辑） | 862 行 / 15 文件 |

### 1.2 后端跨切面（`src/common`、`src/config`、`src/infra`）

| 路径 | 职责 |
|---|---|
| `common/security/safe-join.ts` | **全项目唯一合法路径入口**：`safeJoin`（字符串层监狱）+ `safeRealJoin`（+ realpath 防符号链接逃逸） |
| `common/security/magic-sniff.ts` | 图片魔数嗅探（扩展名 ↔ 真实格式比对） |
| `common/pipes/zod-validation.pipe.ts` | 路由级 zod 校验管道，失败 → 400 + `detail.issues` |
| `common/guards/jwt-auth.guard.ts` | 全局 JWT 守卫；经 `ACCESS_TOKEN_VERIFIER` token 与 auth 模块解耦（L0 ← token → L3） |
| `common/interceptors/operation-log.interceptor.ts` | 管理端写操作审计入库；detail 递归脱敏（密码/token/secret/authorization） |
| `common/filters/all-exceptions.filter.ts` | 全局异常收敛为 `{ code, message, detail }`；未知异常 500 且不外泄堆栈 |
| `common/registry/media-reference.registry.ts` | 媒体引用贡献者注册表（同步反查通道，消费方 media / 注册方自注册） |
| `common/markdown/frontmatter.ts` | gray-matter 包装，往返保真（未知字段保留 / 键序保持 / 类型不漂移） |
| `common/render/render.ts` | marked + sanitize-html（markdown）/ TipTap JSON → 安全 HTML |
| `common/logger.ts` | 全项目共享 pino 实例 |
| `config/app-config.ts` | `data/config.json` 加载 + zod 校验 + 进程内单例 + 合并持久化 |
| `infra/db/` | Drizzle 11 张表 schema + 启动自动迁移 |
| `infra/backup/backup.service.ts` | **唯一备份实现**：pre_write / manual / db + manifest(sha256) + 恢复 + 保留策略(10 份) |

### 1.3 后端业务模块

| 模块 | 规模 | 职责 | 关键不变量 |
|---|---|---|---|
| `system` | 167+124 | 健康检查、Mizuki 探测、一次性 init、运行模式变更、操作日志分页 | detector 为 init 期一次性判定 |
| `auth` | 328 | argon2 登录、JWT 双 Token 轮换、改密（tokenVersion +1）、失败锁定 | `InitBodySchema` 同时被 system 复用 |
| `data-files` | 818（6 文件） | ts-morph 引擎：8 步写管线（哈希→AST 求值→zod→序列化+语法校验→陈旧检测重试1次→pre_write 备份→原子写→失效缓存） | **管线顺序不可变**；事件发射不在引擎 |
| `collections` | 498+123 | 七类集合 CRUD；registry 驱动（新增类型 = 加配置对象）；载入期幂等迁移（ADR-014/018） | 禁止为集合内容建表 |
| `posts` | 818 | Markdown 文章 CRUD + 两类盘上形态（目录式/文件式）+ 封面上传 + 索引同步 | 全写路径 = pre_write 备份 + 原子写 |
| `articles` | 512 | 富文本 CRUD（doc_json → html_cache）、post.changed 增量订阅、公开混合分页 + 首页缓存 | 公开面双泄漏点已修（password 剥离 / encrypted 清空） |
| `albums` | 700 | 相册目录 + info.json 双模式（local/external）、图片上传、缩略图变体（fail-open） | 模式切换双向 409 规则 |
| `media` | 281 | 上传五件套（白名单→魔数→上限→随机名→重编码去 EXIF）+ 删除前引用检查 | 五步顺序不可变 |
| `process` | 462+318 | 白名单任务（install/dev/build/preview）+ 解析链（pm-resolver）+ 环形日志缓冲(2000) + SSE + tree-kill 停机 | `shell:false` 恒成立；env 仅白名单 + 固定 CI=true |
| `preview` | 312 | 独立监听 4173 的静态预览通道（ADR-019 四边界同构 ADR-012） | 全请求期活读 env（P11 坑 5） |
| `backup` | 81 | 备份 REST 门面（调用 infra/backup） | — |
| `settings` | 85 | `site_setting` 运行态 key-value JSON | 与 config.json 严禁混用 |
| `site-config` | 447 | 主题 `config.ts` 受控子集（lang / commentConfig / nav）定点置换 + 侧车 override | 物化前过 theme 探针门禁 |
| `theme` | 389 | 双轴（漂移诊断 / 探针执法，ADR-024）；基线四态加载 | 探针参照源自档案，禁取运行基线 |

### 1.4 前端

| 目录 | 职责 |
|---|---|
| `api/` | 薄请求客户端；`http.ts` 统一注入 Authorization、401 自动刷新重放、并发刷新去重、`ApiError` 归一 |
| `stores/` | `auth`（登录态 + localStorage 持久化 + 资产 cookie）、`system`（运行模式，fail-open 幂等） |
| `components/` | 上传 / 裁切 / 选图器 / SSE 日志终端 / 409 引用明细弹窗 / 必填提示 |
| `lib/` | `image-src`（/site-assets 拼装）、`media-ref`、`theme`（三态）、`editors/`（TipTap/CodeMirror/Vditor）、`schema-form/`（zod→描述符映射 + 通用渲染器） |
| `layouts/` `router/` | 顶栏 + 侧栏（minimal 模式过滤）；路由守卫（登录态 + minimal 重定向） |
| `views/` | 15 个页面；最大两个为 `AlbumDetailPage`(774) 与 `PostEditPage`(724) |

---

## 2. 分层与解耦现状评估

| 维度 | 评价 | 依据 |
|---|---|---|
| 边界强制 | 良好 | eslint `boundaries` 拦截 L2 互 import；跨模块只走 `EventEmitter2` 与 `MediaReferenceRegistry`（均在 `common/`，L0） |
| 依赖倒置 | 良好 | 守卫不依赖 auth 服务，经 `ACCESS_TOKEN_VERIFIER` symbol 解耦；`ValueCache`/`FileLock` 为可注入的轻量 provider |
| 配置读取 | 良好但**分歧** | `getAppConfig()` 活取值纪律统一；但 6 个模块各自用 `BACKUP_OPTIONS`（备份语义的注入对象）当「mizukiRoot 载体」（见 §3.3 C5） |
| 事件契约 | 良好但**载荷不足** | 6 个事件全部经 zod parse 后发射，纪律严明；但 `post.changed` 缺 `filePath`，逼订阅方猜测（见 §3.2 B1） |
| `main.ts` 职责 | **偏胖** | 345 行承担 Swagger / 静态面板 / site-assets 通道（217 行含 cookie 解析与守卫链）/ bootstrap 四类职责 |
| 引擎纯度 | 良好 | `data-files` 不发射事件，由调用方在成功出口发射，避免重复事件与耦合 |
| 前端分层 | 良好 | 无 prop drilling、无 `any`/`@ts-ignore`、无 `console.*`；api 为薄客户端 |

---

## 3. 可优化点逐项

风险列约定：**P0** 缺陷 / **P1** 语义漂移 / **P2** 结构 / **P3** 风格。待裁决列标注是否改变对外可观测行为。

### 3.1 逐字复制（可机械消除）

| # | 重复项 | 现有份数与位置 | 方案 | 收益 | 风险 |
|---|---|---|---|---|---|
| A1 | **原子写**（temp + rename） | **9 份**：`data-file.service.ts:134`、`posts.service.ts:665`、`media.service.ts:276`、`albums.service.ts:687`、`albums.service.ts:654`（缩略图 webp 变体）、`site-config.service.ts:439`、`site-config.service.ts:211`、`app-config.ts:109`、`theme-registry.service.ts:138`（+ `backup.service.ts:209` 恢复路径 `.restore-` 变体） | `common/fs/atomic-write.ts` → `atomicWriteFile(abs, data, { tmpPrefix?, ensureDir? })` | 9→1；消除**两套临时名方案**（`nanoid(8)` vs `Date.now()+Math.random()`）并存；统一 mkdir 与失败清理 | P3 |
| A2 | **mizukiRoot 解析 + safeJoin 包装** | **8 份**：`posts.service.ts:673/681`、`articles.service.ts:447/454`、`media.service.ts:257/264`、`albums.service.ts:555/562`、`backup.service.ts:247/255/267`、`process-manager.service.ts:349`、`theme-registry.service.ts:382`、`site-config.service.ts:81` | `common/fs/mizuki-root.ts` → `requireMizukiRoot({ missing })` + `toMizukiAbs(rel)`，`missing` 参数化保留各模块错误类型与文案 | 8→1；「未初始化」判定口径统一（现为 400/404 两态，参数显式化） | P2，**文案须逐字保留** |
| A3 | **sha256** | **5 份**：`data-file.service.ts:160`、`posts.service.ts:816`、`backup.service.ts:466`、`theme-registry.service.ts:207`、`theme-registry.service.ts:219`、`media.service.ts:149` | `common/crypto/hash.ts` → `sha256Text` / `sha256File` | 5→2；主题指纹 digest 与备份校验口径统一 | P3 |
| A4 | **URL 路径逐段解码 + 走私拒绝**（**安全关键**） | **2 份**：`main.ts:205-227`（site-assets）、`preview.service.ts:286-311`（parseSegments） | `common/security/url-path.ts` → `decodePathSegments(path, { rejectHidden })` | ⚠️ 两处**安全关键**逻辑各写一遍：今后任一侧加固（如 Unicode 归一化、`%c0%af` 超长编码变体）都不会同步到另一侧——**这是「重复导致未来漏洞」的典型** | P2，差异须逐条参数化（main 不含 `startsWith('.')`、preview 含） |
| A5 | **cookie 解析** | **2 份逐字相同**：`main.ts:109-129`、`preview.service.ts:84-104` | `common/http/cookie.ts` → `readCookie` | 2→1 | P3 |
| A6 | **Bearer 提取** | **2 份**：`jwt-auth.guard.ts:81-88`（正则 `/^Bearer\s+(.+)$/i`）、`main.ts:182` 内联同正则 | 导出 guard 内实现供 main 复用 | 2→1；认证解析口径单一来源 | P3 |
| A7 | **zod 失败 → 400 + `detail.issues` 映射** | **5 份**：`zod-validation.pipe.ts:18-31`、`collections.service.ts:352-366`、`posts.service.ts:760-774`、`posts.service.ts:298-309`、`albums.service.ts:144-158` | `common/validation/zod-issues.ts` → `issuesFrom(err)` + `badRequestFromZod(schema, value, message)` | 5→1；前端字段级提示依赖 `detail.issues[].{path,message}` 形状，5 份实现意味着形状可能漂移 | P3，各 message 参数化保留 |
| A8 | **分页参数解析** | **2 套且语义分歧**：`system.controller.ts:161`（clampInt，静默截断至 max 100）、`articles.controller.ts:111-132`（超 50 → **400**） | 归位 `common/http/pagination.ts`，**保留两套语义**并显式注释两条契约来源 | 消除「同名单不同行为」的认知陷阱 | P2，**不得统一语义**（属对外行为变更） |
| A9 | **JSON 错误响应** | **2 套**：`main.ts:150-155`（respond401/404）、`preview.service.ts:107-109`（respondJson） | `common/http/json-error.ts` | 2→1 | P3 |
| A12 | `UploadedFileLike` | **3 份**：`posts.service.ts:166`、`media.service.ts:42`、`albums.service.ts:40` | 提至 `common/http/uploaded-file.ts` | 现有注释称「避免 L2 互 import」，但**纯类型**不构成 L2 依赖（shared 已放同类契约），该理由不成立 | P3 |
| A13 | 单段名 schema | **3 份同构**：`PostSlugSchema`(posts:52)、`ArticleSlugSchema`(articles:47) **逐字相同**、`AlbumNameSchema`(albums:51) 同构 | `common/validation/segment-name.ts` 工厂 `singleSegmentName({ max, label })` | 3→1 | P3，max（200/200/100）与 message 保留 |
| A14 | 小工具 | `toPosix`(backup:471) 与 `value.split('\\').join('/')`（posts media-ref:64、collections media-ref:76）语义重叠 | 并入 `common/fs/posix.ts` | 口径统一 | P3 |

### 3.2 语义漂移（重复的代价已兑现）

| # | 问题 | 证据 | 影响 | 方案 | 风险 |
|---|---|---|---|---|---|
| **B1** | **`post.changed` 载荷缺 `filePath`，订阅方靠猜路径** | 载荷仅 `{slug, frontmatter, fileHash, deleted}`（`shared/events.ts:30-35`）；`posts.service.ts:590` 的 `filePath` 由参数传入（B2 已修正为实际盘上路径），而 `articles.service.ts:473` **硬编码** `src/content/posts/${slug}/index.md` | B2 引入文件式 `<slug>.md` 后，两份映射必然分叉。当前因 `existing.fileHash !== payload.fileHash` 判据在多数路径短路（posts 先写了正确行）**尚未爆发**；一旦行处软删态或哈希不一致，subscriber 会写入目录形态路径，`publicDetail`（`articles.service.ts:345`）随后读错路径 → 404 | 载荷增**可选** `filePath?: string`（additive，属内部事件契约非公开 API，`test/shared/events.spec.ts` 可兜）；articles 侧优先取载荷、缺省回退旧推导（向后兼容） | P1 |
| **B2** | **`article.slug` UNIQUE 在 markdown 侧无护栏 → 必现 500 + 半成功** | `schema.ts:33` `slug notNull().unique()`；`posts.service.ts:611` 查询 `where(eq(article.slug, slug))` **不分 sourceType**，命中 richtext 行后落到 `insert`（:621）→ SqliteError → 500。旁证：`posts.service.ts:260-267` 只查文件系统，`syncIndex`（:437-440）的 `bySlug` 只含 markdown 行 | **可复现序列**：`POST /admin/articles` 建 slug=`hello`（`articles.assertSlugFree:411` 只查 DB 不查盘）→ `POST /admin/posts {slug:"hello"}` → 文件在 `:272` **已落盘** → 索引 insert 违约 → 500，盘上残留孤儿文章。`syncIndex` 同理可整批中断 | ① `upsertArticleRow` 查询补 `eq(article.sourceType,'markdown')`；② 创建/同步前做跨 sourceType 占用检查 → 409 明确文案 | **P0** |
| **B3** | **CORS 扩展通道 `config.json.corsOrigins` 是死代码（文档与实现背离）** | `app.setup.ts:19-30` 注释承诺「AppConfig 若声明 corsOrigins 将自动并入」；但 `AppConfigSchema`（`app-config.ts:15-29`）是普通 `z.object`（默认 strip 未声明键），`corsOrigins` **必被剥离** → `getAppConfig()['corsOrigins']` 恒 `undefined` | 运维按文档配置 `corsOrigins` **无任何效果且无告警** | 二选一（**待裁决**）：① 正式纳入 schema `corsOrigins: z.array(z.string()).default([])`（复活功能，配置校验面变化）；② 删除该分支 + 修正注释（保守清理） | **P0**，①属配置面变更 |
| **B4** | **状态推导规则（含安全向兼容分支）两份、且告警不对称** | `posts.service.ts:789-801` `deriveStatus` 对 `published===false` 记 pino warn（ADR-025 登记的「宁可重复告警」取舍）；`articles.service.ts:472` 内联同一判定 **无 warn** | 同一安全规则两处实现：遗漏一侧即草稿被公开（属**安全向回归**）；告警依赖调用路径而非规则本身 | 抽 `common/markdown/derive-status.ts`，**须逐字保留 warn 与「宁可重复告警不可漏报」取舍** | P1，红线：ADR-025 语义不得改 |
| B5 | `toDate`/`toDateOrNull` | `posts.service.ts:804-813` 与 `articles.service.ts:485-494` **逐字相同** | 与 B4/B1 同源（两份 frontmatter→行映射） | 并入 `common/markdown/article-row.ts`：`toArticleRow(...)` + `toDateOrNull` | P3 |
| B6 | 页面设置读取无缓存 | `system.controller.ts:145-158` 每请求 `JSON.parse(package.json)` | 健康检查/状态端点高频调用下的无谓 IO | 进程内单例（与 `getAppConfig` 同型） | P3 |

### 3.3 职责划分与解耦

| # | 问题 | 证据 | 方案 | 收益 | 风险 |
|---|---|---|---|---|---|
| C1 | **`main.ts` 承担 4 类职责（345 行）** | `setupSwagger:43-64`、`setupStaticPanel:75-92`、site-assets 通道 `94-311`（含 cookie 解析 + 守卫链 + 路径解码 + static 实例缓存）、`bootstrap:317-338` | 拆 `src/bootstrap/{swagger,static-panel,site-assets,index}.ts`，`main.ts` 只留引导与直跑守卫 | site-assets 是**测试无法直接覆盖的 HTTP 层**，拆分后可单测 handler；`main.ts` 降至 ~60 行 | P2，`setupSwagger`/`setupStaticPanel` 被 e2e 直接 import（p11-static-panel / p12-site-assets），须保留 re-export 或同步更新测试导入 |
| C2 | **`evaluator.ts` 两套求值器近重复（~180 行）** | `astToValue:72-147` vs `astToValueWithConsts:207-265`：分派表同型，差异仅在 ①Identifier 查常量表 ②`astToValueWithConsts` **无数组字面量分支** ③NumericLiteral 的 `Number.isFinite` 检查只在 `astToValue` | 合并为 `evaluateLiteral(node, { filePath, consts? })`，`astToValue` 作 `consts===undefined` 的薄封装（公开签名与错误类型不变） | ~180→~110 行；消除「加固只做一边」（finite 检查目前不对称） | **P2 + 红线**：`astToValueWithConsts` 无数组分支是**有意降级**（navBarConfig 的 LinkPreset 依赖它恒抛 → D3 降级分支），合并时必须显式保留该差异，否则 D3 语义变更 |
| C3 | `data-file.service` 三处相同「载入前奏」 | `readCollection:54-62`、`attempt:97-103`、`evaluator.evaluateExport:150-157`（load + getDecl + initializer 判空，三份） | 抽 `loadExportInitializer(absPath, varName, content?)` | 三处合一，错误文案与抛错类型一致 | P3 |
| C4 | `articles.service` 混 4 类职责（512 行） | 富文本 CRUD / post.changed 订阅 / 公开分页与详情 / 首页缓存 `publicPage1Cache:114` 同处一类 | **小切口优先**：抽 `markdown-row.ts`（映射）+ `article-cache.ts`（缓存），类体减 ~60 行；**大拆分**（拆三个 service）列为可选 | 小切口低成本；大拆分牵动 DI 与 e2e provider override，性价比低 | P2 |
| C5 | **`BACKUP_OPTIONS` 被当通用配置载体** | `posts.service.ts:674`、`collections`、`articles`、`media`、`albums`、`process-manager.service.ts:350` 均用它取 `mizukiRoot` | 与 A2 同波次：抽 `common/fs/mizuki-root.ts`，`BACKUP_OPTIONS` 收窄回备份语义 | 命名-职责对齐；模块不再依赖备份模块只为读配置 | P2 |
| C6 | `common/` 根目录平铺 | 现为直接子目录/文件并列，新增文件无归口 | 新文件按子域归置 `common/{fs,http,validation,crypto,markdown,security}/` | 防止 common 继续摊平 | P3 |
| C7 | 路径监狱加固**读写不对称** | 写路径只过 `safeJoin`：`data-file.service.ts:150`、`posts.service.ts:683`、`media.service.ts:266`、`albums.service.ts:564`、`articles.service.ts:456`；读路径过 `safeRealJoin`：`main.ts:263`、`preview.service.ts:221` | 写路径统一改走 `safeRealJoin`（其「最深层已存在祖先」语义已支持新建文件） | 消除符号链接逃逸的纵深防御缺口 | **P2，需独立波次**：触及全部写路径；另 `safeRealJoin` 在 root 不存在时抛**普通 Error**（`safe-join.ts:88`）需一并处理 |

### 3.4 错误处理与边界

| # | 问题 | 证据 | 影响 | 方案 | 风险 |
|---|---|---|---|---|---|
| **E1** | **API 错误响应泄漏磁盘绝对路径**（与项目自定纪律冲突） | `data-file.service.ts:59` 与 `:101`（`...：${abs}`）、`evaluator.ts:43` `ExportNotFoundError(varName, filePath)`（filePath 为绝对路径，经 404 message 外投）、`backup.service.ts:447`（`manifest 缺失或损坏：${manifestPath}`）、`site-config.service.ts:254/271`、`theme-registry.service.ts:306` | README 与委托代验 playbook 均要求「API 响应禁止泄露绝对路径」。当前 **4 个模块 6 处**违反；暴露主机目录结构（用户名/盘符/部署布局） | 对外文案改相对形态（`src/data/diary.ts`、`<mizukiRoot>/src/config.ts`、备份目录以 id 指代），**绝对路径仅保留于 pino 日志** | **P1，待裁决**：属对外错误文案变更（非接口形状变更）；且现有 e2e 可能断言了含路径的 message，须同步核对 |
| E2 | `assertSyntaxValid` 抛普通 Error → 对外 **500 InternalError** | `syntax-check.ts:39-42`，由 `data-file.service.ts:117` 调用 | 用户内容导致的语法失败被报为「内部服务器错误」，**语义错位**且无法自助 | 改抛 `BadRequestException` | **P1，待裁决**：`code` 由 `InternalError` → `BadRequestException`，属对外错误语义变更 |
| E3 | 裸 `.parse()` 可直达 500 | `albums.service.ts:271/272/297/312/347/359/365/381/404/431/485/486`（**12 处**）、`posts.service.ts:258/396`。讽刺的是同文件 `:140-143` 注释明确写着「裸 .parse 会把 ZodError 直达 500，必须映射 400」，随后仍继续使用 | 因控制器已有 `ZodValidationPipe` 前置，正常路径不触发；但 schema 与服务层口径一旦分叉（如 `AlbumInfoExternalSchema.parse(mergedRaw)` 读盘数据）即 500 | 统一走 A7 的 `badRequestFromZod` | P2（防御纵深） |
| E4 | 原型链键未拒绝 | `evaluator.ts:99` `result[name] = ...`（name 可为 `'__proto__'`，对象字面量键合法）；`astToValueWithConsts:222` 同；`serializer.ts:13-16` 会产出 `__proto__: x` 字面量 | `result['__proto__']=x` 改的是原型而非加键 → **值静默丢失**；写出的文件被 Node 导入时会设置原型。需畸形数据文件触发，且 schema 多不含该键；但 `PostFrontmatterSchema.passthrough()` 说明自定义键是被允许的 | `Object.create(null)` 承载或显式拒绝 `__proto__`/`constructor`/`prototype` 键（抛 `UnsupportedLiteralError`） | P3 |
| E5 | `ValueCache` 返回共享可变引用 | `value-cache.ts:28-37`；注释已声明「调用方不得原地修改」但无机制约束 | 现消费方均为只读，安全；属「文档纪律代替类型约束」 | `get()` 返回 `Readonly<T>` 签名（零运行时代价），或增 `{ clone: true }` | P3 |
| E6 | `probePort` 误报 + 死字段 | `process-manager.service.ts:215-229` 把所有监听失败（含 `EACCES`）报为 `inUse`；`PortProbeResult.byCurrentTask`（:100-105）声明后**从未赋值** | 端口探测结果对非占用类错误失真；字段为死代码 | 区分 `error.code`；`byCurrentTask` 补实现或标注「保留字段，未实现」（响应形状收窄属对外变更，不建议删除） | P3 |
| E7 | 结构化边界良好 | `FileLock.withLock`（`file-lock.ts:18-33`）链尾清理正确、前序失败不断链；`process-manager` 环形缓冲 splice 正确；`finalize` 幂等（竞态防护）；前端 SSE / 编辑器观察器均在 `onBeforeUnmount` 清理 | — | **保持** | — |

### 3.5 前端（`apps/web`）

| # | 问题 | 证据 | 影响 | 方案 | 风险 |
|---|---|---|---|---|---|
| **F1** | **刷新失败即强制登出（网络抖动误判）** | `api/http.ts:109` 的 `catch` 对**任何**异常都 `return false` → 上层 `clearAuth()` + `sessionExpiredHandler()` | **高**：弱网或后端重启瞬间把已登录用户踢回登录页 | 区分「刷新端点返回非 2xx（凭证真失效）」与「网络/超时错误」；后者不清 token、不触发会话失效 | P1 |
| F2 | `handleError` 样板 7 份 | `AlbumDetailPage.vue:438`、`CollectionListPage.vue:305`、`AlbumsPage.vue:149`、`ConsolePage.vue:135`、`SiteConfigPage.vue:201`、`BackupsPage.vue:110`、`MediaLibraryPage.vue:79` | 新增页面易漏改分支 | `lib/notify.ts` → `notifyApiError(e, fallback)` | P3 |
| F3 | `restoreBackup` 重复 | `api/posts.ts:146-152` 与 `api/backups.ts:49-55` 实现相同，`RestoreResult` 类型也重复定义 | 契约双份 | 改为复用 `backupsApi.restore` | P3 |
| F4 | 格式化/日期工具复制 | `formatTime` 4 处（`BackupsPage:106`/`MediaLibraryPage:75`/`ConsolePage:131`/`DashboardPage:26`）；`formatSize` 2 处（`BackupsPage:100`/`MediaLibraryPage:69`）；`onDatePick` 3 处 | — | `lib/format.ts` + `lib/date.ts` | P3 |
| F5 | `detail.issues` 归一化三套 | `api/collections.ts:54 extractFieldIssues`、`api/articles.ts:65 extractArticleIssues`、`PostEditPage.vue:327-346` **重新手写一遍循环** | 第 3 套实现（且未 import 既有函数） | 统一 1 个 `normalizeValidationIssues` | P3 |
| F6 | 前后端契约漂移 | `api/media.ts:34` 的 `MediaReference` **缺 `mediaPath`**（shared 版有，`shared/media-reference.ts:12`）；`api/config.ts:19` 把 `commentConfig` 退化为 `Record<string, unknown>`（shared 已有 `CommentConfigValue`） | 服务端使用 `mediaPath` 时前端取不到；站点配置表单失去类型校验 | 复用 shared 类型 | P2 |
| **F7** | **Markdown 编辑器页大段复制 + 绕过 store** | `PostEditPage.vue:48-75` 与 `AboutEditPage.vue:22-48` 的引擎选择 / `onImagesPicked` / 光标插入逻辑重复（各 ~50 行）；且直接读写 `localStorage('mizuki.editor.engine')`（`PostEditPage:51,74`、`AboutEditPage:25,47`） | 两最大文件各可减 ~50 行；偏好散落 | `lib/useMarkdownEditor.ts` 组合式（内部封装 localStorage） | P2 |
| F8 | 编辑器接口不统一 | `VditorEditor` 暴露 `getValue/setValue/insertAtCursor`，`CodeMirrorEditor` 有 `getValue/insertAtCursor`，`TipTapEditor` **都无**（仅 v-model）；3 份 v-model watch 样板 | 富文本当前**无法在光标插入图片**（能力缺口）；`index.ts` 仅 barrel，非抽象 | 定义 `EditorHandle` 接口 + `useVModelEditor` 消除样板 | P2 |
| F9 | minimal 前缀常量双份 | `router/index.ts:76` 与 `MainLayout.vue:68` | 模式判定双源，易不一致 | 常量上收 `stores/system.ts` | P3 |
| F10 | `recycleStore` 位于 api 层 | `api/posts.ts:105-143` 用 localStorage 实现回收站状态 | 职责错位（api 层不应有状态） | 移至 `stores/recycle.ts` | P3 |
| F11 | `mapper.ts` 依赖 zod 运行时内部结构 | `lib/schema-form/mapper.ts:152` `typeName(t) = t.constructor.name` + 7 处 `as unknown as ZodOptional<...>` | zod 升级/构建压缩可能断裂 | 封装 `safeUnwrap()` + 未知类型兜底 | P2 |

---

## 4. 可落地优化方案（按波次）

> 每波独立可提交、可回滚、可单独验收；波内条目**不得跨波混合**。
> 全波共同验收：`pnpm lint` + `pnpm test`（451 用例基线不减）+ `git status --porcelain` 为空。

### Wave-1 零风险机械抽取（无对外可观测变化）

| 项 | 内容 |
|---|---|
| 范围 | A1 A2 A3 A5 A6 A7 A9 A12 A13 A14 + C3 C5 C6 + B5 |
| 落点 | 新增 `common/fs/{atomic-write,mizuki-root,posix}.ts`、`common/http/{cookie,json-error,uploaded-file}.ts`、`common/validation/{zod-issues,segment-name}.ts`、`common/crypto/hash.ts`、`common/markdown/article-row.ts` |
| 不动 | 全部错误类型 / message 文案 / 状态码；`deriveStatus` 的 warn 语义（ADR-025）；`BACKUP_OPTIONS` 对外契约 |
| 验收 | 逐模块 e2e 全绿；对 A1 补「临时文件不残留」断言（成功后同目录无 `.tmp-*`） |
| 收益 | 约 -300 行重复；`BACKUP_OPTIONS` 职责归位 |

### Wave-2 缺陷闭合（**须先裁决对外文案/状态码**）

| 项 | 待裁决点 |
|---|---|
| B1 `post.changed` 增可选 `filePath` | 是否允许内部事件载荷 additive 扩展 |
| B2 slug UNIQUE 护栏 | 新增 409 分支（此前为 500）→ 属缺陷修复，建议直接纳入 |
| B3 CORS 死代码 | ① 复活（配置面变更）或 ② 删除（纯清理） |
| B4/B6 deriveStatus 单源化 + package.json 缓存 | 红线：ADR-025 warn 取舍逐字保留 |
| E1 绝对路径出响应 | **对外错误文案变更**，须裁决 |
| E2 `assertSyntaxValid` 400 化 | **对外错误码变更**，须裁决 |

### Wave-3 安全口径统一（独立波次，需完整回归）

| 项 | 内容 |
|---|---|
| A4 | 路径段解码单源化（`rejectHidden` 参数化保留差异） |
| C7 | 写路径 `safeJoin` → `safeRealJoin`；`safeRealJoin` 的 root 缺失异常类型统一 |
| E3 | 12 处裸 `.parse()` 收敛至 `badRequestFromZod` |
| 验收 | p1-security / p12-site-assets / p4/p5/p7 全量重跑；路径穿越用例须含 `%2e%2e%2f`、`..\\`、符号链接三类 |

### Wave-4 结构拆分（中成本，建议单批）

| 项 | 内容 |
|---|---|
| C1 | `main.ts` → `src/bootstrap/*`（保留 e2e 复用导出） |
| C2 | `evaluator.ts` 双求值器合并（**红线**：保留 `astToValueWithConsts` 无数组分支） |
| C4 | `articles.service` 小切口（映射 + 缓存外置），大拆分列为可选 |

### Wave-5 前端归口

| 项 | 内容 |
|---|---|
| F1 | **优先**：刷新失败误登出（高影响） |
| F2 F3 F4 F5 F6 | 样板归一 + 契约收敛至 shared |
| F7 F8 F9 F10 F11 | 组合式抽取 + 编辑器接口统一 + 常量单源 + mapper 加固 |

---

## 5. 明确不改动（边界声明）

1. **阶段裁决登记的语义**：`deriveStatus` 的 `published===false` 兼容分支与 warn（ADR-025）、
   `astToValueWithConsts` 无数组分支（D3 降级依赖）、相册 `hidden` 过滤语义、预览缓存三档分派、
   `preview` 405 先于 401 的口径、`childEnv` 固定 CI=true。
2. **对外接口**：全部路由路径、响应形状、成功状态码、错误体 `{code,message,detail}` 结构。
3. **`HttpException.constructor.name` 即 `code`** 的既有约定（`all-exceptions.filter.ts:26`）。
4. **不引入新依赖**（不引入 class-validator / automapper 等），不改变 `packages/shared` 的
   「只放类型与 schema，禁业务逻辑」纪律。
5. 不改动 `docs/` 既有台账（本文为新增审计件，不修改任何既有登记）。

---

## 6. 回归风险与验证矩阵

| 波次 | 主要风险 | 验证手段 |
|---|---|---|
| Wave-1 | 文案逐字漂移 → e2e 断言失败 | `test/**` 全量 + 对 `message` 的既有断言逐个比对 |
| Wave-2 | 对外可观测行为变化 | 仅新增分支（B2）；文案类须架构师逐条批准后改 e2e 断言 |
| Wave-3 | 写路径行为变化（可能拒绝既有可写路径） | 三类穿越用例 + 全量内容模块 e2e + 手工 smoke（真实 Mizuki 目录建/改/删各一次） |
| Wave-4 | 导入面变化（e2e 直接 import `main.ts`） | p11-static-panel / p12-site-assets 导入同步；golden 字节测试 |
| Wave-5 | 交互回归 | 手工走查（登录态、长时挂机刷新、编辑器插图、minimal 模式） |

**贯穿纪律**：单波单提交；提交前 `git status --porcelain` 为空；越界变更（含 formatter 自动格式化）
立即 `git checkout` 回滚并披露；每波递交附 anchor count tally 与 per-hunk justification。

---

## 7. 附：建议裁决顺序

1. **先裁 Wave-2 的三项对外变更**（E1 绝对路径文案、E2 错误码、B3 CORS 去向）——它们决定
   Wave-1 的文案参数化设计（若 E1 通过，Wave-1 的 A2 参数化需预留「相对路径形态」位）；
2. 再放行 **Wave-1**（零风险，可由自查完成）；
3. **Wave-3 / Wave-4** 视日程分两批；
4. **Wave-5** 可与后端并行（无耦合面）。
