# U3-P2 — frontmatter 补键 / 相册封面引用注册表 / 导航接管确认（含 A-GAP-06 改判销案 + wallpaperMode 收紧）

> [签发] 架构师 2026-10-19。执行方：用户指定模型通道。完成即停，交回报告等验收。
> [前置] HEAD = 2b22479（U3-P1，基线 505/505、58 文件）。本包所有 file:line 均按该 HEAD 实读核实，不是转抄审计。

## 0. 背景与批次定位

U3-P2 原定四项：A-GAP-06 pagefind、A-GAP-09 frontmatter 补 7 键、B-P2-09 相册封面注册表、A-GAP-10 LinkPreset 警示强化。架构师出包前实读复核发现 **A-GAP-06 是审计误诊**（详见 §1.1 与 K1），本批改为「改判销案 + 台账修订」，零产品代码。其余三项范围不变，另折入 U3-P1 验收遗留的 wallpaperMode 收紧。零新依赖、零新机制、零新路由/菜单。

## 1. 事实基座（已实读核实，执行方开工前可抽验）

### 1.1 A-GAP-06 为什么是误诊

- 主题 `Mizuki/package.json:16`：`"build": "node scripts/update-anime.mjs && astro build && pagefind --site dist && node scripts/compress-fonts.js"` —— **pagefind 内联在 build 脚本链内**，`pagefind ^1.4.0` 是运行时依赖（:68）。
- 面板任务链：`process-manager.service.ts:129` `taskArgs(task)` → `['run','build']` 原样透传（:407-412）；pm-resolver 垫片穿透只改写 **pnpm 自身调用**（`pm-resolver.ts:220` file=process.execPath + 入口 js），`run build` 参数不变 → 面板 build 必然执行主题完整脚本链（含 pagefind）。
- `Mizuki/dist/pagefind/` 实存（pagefind-entry.json 等 8+ 文件，2026-09-08 构建）。
- 审计引用的官方文档 `guide/deploy/07-Docker部署.md:104` 原文是 `RUN pnpm run build || pnpm exec astro build && pnpm exec pagefind --site dist` —— 这是**失败兜底链**（`||` 优先级低于 `&&`：整链 build 失败才退回 astro-only + pagefind），不是「build 后须补跑 pagefind」的口径。审计员误读。
- 主题 `.npmrc` 有 `manage-package-manager-versions = true`、packageManager=pnpm@10.22.0：宿主 pnpm 12 会自切 10.22.0 执行——与本裁断无关（pagefind 在主脚本非 pre/post 钩子，任何 pnpm 版本行为一致），记录在案防后续误判。

### 1.2 A-GAP-09 三落点现状

- 主题真源 `Mizuki/src/content.config.ts:7-41`：26 字段。面板/服务端已知 16 键（`posts.service.ts:74-115` + `PostEditPage.vue:380-384` KNOWN_FM_KEYS），缺 **updated(:10) / priority(:19) / sourceLink(:21) / licenseName(:22) / licenseUrl(:23) / passwordHint(:28) / alias(:31)** 七键。主题 `prev*` 四键标注 "For internal use"（:37-40），**不纳入**管理面。
- 服务端：`PostFrontmatterSchema` 为 `.passthrough()`（:115）——七键数据不丢，仅无表单项且面板列为「未知键」。`NULL_DELETE_KEYS`（:138）现 6 键：encrypted/password/comment/permalink/lang/draft。date/pubDate 日期键用 `|| undefined` 空值不写键（`PostEditPage.vue:230-231`），**无删键路径**（既有口径）。
- 面板：`fm` 状态（:112-135+）、`populateForm`（:172-195）、`buildFrontmatter`（:217-241）、`onDatePick(field:'date'|'pubDate'|'published')`（:253）。

### 1.3 B-P2-09 现状

- `albums.service.ts:206-208`：`collectReferences()` 返回 `[]`，:202-204 注释「info.json 无封面字段」已过时（外链模式 `AlbumInfoExternalSchema` :144 `cover: z.string().min(1)` 必填；`UpdateAlbumBodySchema` :175 cover 可选）。
- **外链照片 src 写入口径已明文接受站点绝对路径**：`ExternalPhotoSrcSchema`（:113-120，ADR-022）`http(s) 或 / 开头`，注释直书「媒体库选择器回填的 /images/…」。相册封面输入框 placeholder 同样明示 `https://... 或 /images/...`（`AlbumDetailPage.vue:560`）。⇒ 注册范围必须含 cover **与** photos[].src。
- 删除检查是**精确串等对账**：`media.service.ts:192` `ref.mediaPath === row.path`，row.path 形态恒为 `public/images/uploads/<nanoid>.<ext>`（:41 UPLOADS_REL_DIR、:131）。
- 归一先例：collections 贡献者（`collections/media-reference.ts:76-79`）normalizeUserPath + 无 '/' 且有 imageDir 才拼前缀；posts 贡献者（:63-69）同理。站点 URL→mediaPath 映射无既有先例，本批新立（K4）。
- 注册表消费方 `media.service.ts:190-201`：有引用 → 409 `{message, detail:{references:[{refType,targetLabel}]}}`。**media 模块零改动**（REQUIREMENTS §16.4 注册表反转）。
- shared `media-reference.ts:13` 注释已预列 `'album-cover'` 为预期 refType。

### 1.4 A-GAP-10 现状

- 服务端 `site-config.service.ts:405-425`：navBarConfig 基线含 LinkPreset 标识符 → `astToValueWithConsts` 抛 UnsupportedLiteralError → `baselineNav = null`（降级分支，ADR-020 已知限制）。
- 面板 `SiteConfigPage.vue`：`navBaselineUnavailable`（:183 由 `view.baselineNav === null` 派生）；警示 alert 已有（:566-574）；`baselineNavText` 仅由**解析成功的** baselineNav 生成（:185）→ 基线不可得时**用户看不到主题默认导航是什么**；`onSaveNav`（:326-354）仅空数组有二次确认，**接管保存无确认**。
- `AdminSiteConfigView`（:58-86）无原始文本字段。管理 API 增量加字段有 U3-P1 先例（一次 +6）。
- LinkPreset 枚举 0-9（主题 `types/config.ts:205-216`），可出现于 links 顶层与 children；children 封顶 1 层维持 ADR-020 已知限制，**本批不动**。

### 1.5 wallpaperMode 现状

- 主题类型 `types/config.ts:136-139`：`wallpaperMode` **必填**对象（defaultMode 必填枚举 + showModeSwitchOnMobile 可选）；真基线 `Mizuki/src/config.ts:80` 有值。
- shared `site-config.ts:259` 落了 `.optional()`（U3-P1 验收已记录的偏差）；`SiteInfoSchema` 注释（:243-247）与面板 `SITE_INFO_OPTIONAL_KEYS`（`SiteConfigPage.vue` :224 消费）同列五可选键。
- 探针宽松视图 `SiteInfoProbeSchema`（15 键全 optional）与侧车 `siteInfo: SiteInfoSchema.partial()` 均不受必填化影响。
- **p7i 用例④**（`p7i-site-sidepanel-override.e2e-spec.ts:336-348`）恰用 wallpaperMode 做缺省零触碰用例——必填化后该用例必红，须改键（K7）。

## 2. 架构裁定 K（执行方不得偏离；发现与事实冲突时停下报告，不得自行改裁）

**K1（A-GAP-06 改判销案）**：审计误诊，按 §1.1 证据链改判。动作仅台账：`docs/audits/feature-alignment/README.md` A-GAP-06 行标注改判 + 新增简短改判小节（证据：主题 build 脚本内联 pagefind / pm-resolver 参数透传 / dist/pagefind 实存 / Docker 文档是兜底链非后置步骤）；SESSIONS 记录。**零产品代码、零测试**（禁止写「断言主题 build 脚本含 pagefind」之类的耦合测试——主题内容不属于本仓契约）。

**K2（A-GAP-09 服务端 schema）**：`PostFrontmatterSchema` 增七键，类型逐字对齐主题：
- `updated: DateLikeSchema.optional()`（与 date/pubDate 同型；**不设删键路径**——空值不写键、PATCH 缺键保留存量，与既有日期键口径一致，注释写明）；
- `alias / passwordHint / licenseName / licenseUrl / sourceLink: z.string().nullable().optional()`；`priority: z.number().nullable().optional()`（无取值域，对齐主题 z.number()）。
`NULL_DELETE_KEYS` 增六键（alias/priority/passwordHint/licenseName/licenseUrl/sourceLink）→ 12 键。可空性注记口径照 C1/A3 既有注释风格（null 删键哨兵）。`prev*` 四键不入 schema 不入表单。

**K3（A-GAP-09 面板）**：`PostEditPage.vue`：
- `fm` 状态 +7：`updated: string`（dateToString 口径）、`alias/passwordHint/licenseName/licenseUrl/sourceLink: string`、`priority: number | null`；
- `populateForm` 回填：updated 走 `dateToString`；priority `typeof === 'number'` 才回填否则 null；字符串键 `typeof === 'string'` 才回填；
- `buildFrontmatter`：`updated: fm.updated || undefined`；六键 `fm.x || null`（priority 用 `?? null`）；空串/清空即删键，禁凭空落键；
- `KNOWN_FM_KEYS` 16→23；`onDatePick` field 联合类型加 `'updated'`；
- 表单项（沿用 fm-sidebar 既有 el-form 结构，无新组件库用法）：更新时间=el-date-picker（同 date/pubDate）、别名/密码提示/许可证名称/许可证链接/来源链接=el-input、排序权重=el-input-number（无 min/max 约束，schema 为权威）；放置：更新时间贴日期区、别名贴 permalink、排序权重贴置顶、密码提示贴密码、许可证三键连续一组置于评论设置之后。标签中文：更新时间/别名/排序权重/密码提示/许可证名称/许可证链接/来源链接。

**K4（B-P2-09 注册表）**：`albums.service.ts` `collectReferences()` 实装：遍历相册列表（复用既有 `list()` 的目录读取口径，**不复制粘贴读取逻辑**——若 list 不合用可提为私有共享读取），对 `mode === 'external'` 的 info：
- cover 与 photos[].src 逐值归一：http(s) 外链 → 跳过；`normalizeUserPath` 后去前导 `/`；`public/` 开头 → 原样；`images/` 开头 → 拼 `public/` 前缀；**其余（含裸文件名）跳过**（mediaPath 恒含 `/`，裸名不可能对账命中，注释写明）；
- 产出 `{ refType: 'album-cover' | 'album-photo', targetLabel: <相册名>, mediaPath }`；
- 单相册读取失败 warn 跳过（collections 贡献者同款双层防御）；mizukiRoot 未配置 → 返回 []。
更新 :12 与 :202-204 的过时注释。**media 模块、shared/media-reference.ts 零改动**。

**K5（A-GAP-10 服务端）**：`AdminSiteConfigView` 增 `baselineNavRaw: string | null`：navBarConfig 声明存在 → `navInit.getText()`（初始化器原文）；声明缺失 → null。基线解析成败均照给原文。管理 API 增量字段（U3-P1 先例），公开 API 零变动。

**K6（A-GAP-10 面板）**：`SiteConfigPage.vue`：
- fetchConfig 存 `baselineNavRaw`；基线折叠区改为：`baselineNavText`（解析成功）优先，否则 `baselineNavRaw` 存在时展示原文（标签「主题默认导航（原文对照，含 LinkPreset 预设，只读）」，复用 nav-baseline-pre 样式）；
- `onSaveNav` 增接管确认：新增 ref 记录 `view.nav === null`（fetchConfig 派生）；保存时若该态为真——links 非空 → ElMessageBox 确认「主题默认导航含 LinkPreset 预设（基线不可解析），保存后预设将被替换；原文已留档，可经「还原主题默认」恢复。确定保存？」；links 为空 → 现有空导航确认文案前加同义接管提示（单次确认，不叠两次弹窗）；override 已存在（nav 非 null）→ 维持现状（空数组仍走既有确认）；
- 既有警示 alert、还原按钮、children 一层封顶帮助文案不动。

**K7（wallpaperMode 收紧）**：`site-config.ts:259` 去掉 `.optional()`；:243-247 注释改为「siteStartDate / navbarTitle / pageScaling / tagStyle 为可选，其余 11 键必填」；面板 `SITE_INFO_OPTIONAL_KEYS` 移除 wallpaperMode。p7i 用例④改用其余可选键（siteStartDate/navbarTitle/pageScaling/tagStyle 任一，执行方按 fixture 现状选）保持零触碰语义，另**新增**一条「body 缺 wallpaperMode → 400」用例。探针宽松视图、侧车 partial 不动（K 无涉）。真基线含该键，面板全量表单流不受影响。

**K8（测试落位）**：新文件 `p5f-posts-frontmatter-extra-keys.e2e-spec.ts`（p5 命名空间，p5–p5e 已用）；新文件 `p7j-album-cover-references.e2e-spec.ts`（**跳过 p7g**——历史空缺原因不明，禁复用）；`p7f-config-override.e2e-spec.ts` 增量加 baselineNavRaw 用例；p7i 用例④原位改写 +1 新用例。fixture 隔离照旧（mkdtemp + MIZUKI_CONFIG_PATH/MIZUKI_CONFIG_OVERRIDE_PATH env 注入）。

## 3. 不变量 I（验收逐条核）

- **I1** 零新依赖：`pnpm-lock.yaml`、三处 `package.json` 零变动。
- **I2** 红线全守：写盘仅 safeJoin+preWriteBackup+atomicWriteFile；测试 fixture 仅 mkdtemp；真实主题目录零写入；不碰 `.git/`；不 push。
- **I3** 公开 API 冻结：`/public/**` 零变动；管理 API 仅 K5 增量字段。
- **I4** 分层：albums 贡献者留在 albums 模块（albums.module.ts 注册，四贡献者同构）；L2 互不 import；media/shared 引用面零改动。
- **I5** 数账：全绿轮计入台账。预计净增 16~17（p5f 7 + p7j 7 + p7f +1~2 + p7i +1），以执行方实际用例清单为准，交付报告列明细。
- **I6** 三连全绿：`pnpm build` exit 0（含 vue-tsc 0 错）、`pnpm lint` 0/0、`pnpm test` 全绿（本机配方：分批 ≤6 文件 + `--maxWorkers=1`，TMP/TEMP 重定向 `.test-tmp/vitetmp`）。
- **I7** UI 面零扩张：无新路由/菜单/组件文件；表单项入既有 fm-sidebar；导航改动限既有 collapse 区。
- **I8** 存量数据零迁移：七键存量文章读取行为不变（passthrough 既有）；populateForm 回填后不再显示为「未知键」（行为改善，非数据变更）。

## 4. 任务 T

- **T1（K2/K3）** frontmatter 七键：schema + 删键集 + 面板表单/回填/提交/KNOWN_FM_KEYS。
- **T2（K4）** albums 贡献者实装 + 注释修正。
- **T3（K5/K6）** baselineNavRaw + 面板原文对照 + 接管确认。
- **T4（K7）** wallpaperMode 必填化 + 注释/SITE_INFO_OPTIONAL_KEYS + p7i 用例改写。
- **T5（K8）** 测试四件：p5f 新（建议用例：七键创建往返落盘 / PATCH 单键合并 / null 删键逐键（至少 alias+priority+passwordHint）/ updated 缺键保留 / 类型错 400×2 / passthrough 未知键回归 / deriveStatus 回归锚）；p7j 新（建议：上传媒体→外链相册 cover=/images/ 形态→删媒体 409 明细 / cover=public/ 形态 409 / cover=https 无拦 / photos[].src 本地形态 409 refType=album-photo / 裸文件名跳过 / 改 cover 后可删（动态重扫）/ local 相册无引用回归）；p7f 增（LinkPreset fixture → baselineNav null + baselineNavRaw 含 'LinkPreset'）；p7i 改+增（K7）。
- **T6（K1 + 台账）**：audit README 四行销账标注（A-GAP-06 改判 / A-GAP-09 闭环 / A-GAP-10 强化闭环+children 维持已知限制 / B-P2-09 闭环）+ 改判证据小节；SESSIONS 交付段；CHANGELOG 批次条目；交付报告落 `docs/audits/u3-p2/README.md`（证据行①起编号、K/I 对照、偏差披露）。

## 5. 验收基线

数账 505 → 预计 521~522（全绿轮为准）；三连全绿；红线 grep 零触碰（backup/posts/media/collections/articles 模块源码、路由表、MainLayout、vite.config、lockfile、package.json ×3、`/public/**`——media 模块只读核验零 diff）。

## 6. 红线（同全仓规约，重申）

写盘只走单源能力；禁裸 fs.writeFile 于 Mizuki 根；测试不碰真实主题目录；TS strict 禁 any 禁未用导入；错误形状 `{code,message,detail}` 不泄绝对路径；事件目录/注册表是仅有的跨模块通道；批次提交未许可不 push。

## 7. 停止条件

- 全部 T 完成且三连全绿 → **停**，交付报告（含 I5 用例明细、三连实录、偏差清单）。
- 任何 K 条款与实读事实冲突 / 需要本包未授权的机制（新依赖、新表、新路由、media 模块改动）→ **停**，报告冲突点等架构师再裁。
- 完成即停：不做本包范围外的顺手改。
