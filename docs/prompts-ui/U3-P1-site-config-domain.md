# 批次指令包 U3-P1 — 配置域一期：站点信息档 + 侧栏内容

【U3-P1 · 架构师签发 2026-10-19 · 数账基线 490（本批允许净增，存量必须全绿）】

> 执行通道由 PM 指定，本包自包含、不依赖任何会话上下文。
> 本包为强约束防漂移指令：预裁决 K1~K10 已把设计分叉定死，执行侧**不得自行扩大或
> 缩小范围**，遇到本包未覆盖的细节按「最接近的 K 条款」类推并在报告中列出。

---

## 1. 背景与现状（必读，全部为已核实事实）

- 功能-文档对齐核查（`docs/audits/feature-alignment/README.md`，已入库于 36c55cb）裁定
  本批 = **A-GAP-01（siteConfig 站点信息档）+ A-GAP-02（侧栏 profileConfig / announcementConfig）**。
  主题 config.ts 共 25 个导出对象，当前面板仅管 3 个（lang / commentConfig / navBarConfig.links）。
- 现行架构（ADR-020，**本批全部沿用、零新机制**）：
  - `packages/shared/src/site-config.ts`：受控子集 zod schema，全 `.strict()`（越界键 400），
    `ConfigOverrideFileSchema` = 侧车载体（version 1，可选键 siteConfig{lang} / commentConfig / nav / originals）；
  - `apps/server/src/modules/site-config/site-config.service.ts`：GET（override 优先 + 基线对照）/
    PUT（ts-morph **声明级/属性级定点置换** → preWriteBackup → 原子写 → 侧车 + originals 留档）；
    `siteConfig.lang` 走**对象内属性置换**（其余 10+ 键零触碰），`commentConfig` / `navBarConfig`
    走**整声明置换**（`valueToTsLiteral` 序列化）；
  - 每个写入口前置 `themeRegistry.assertProbesPass([...])`（ADR-024 探针门禁，失败 409 零物化）；
  - 控制器三端点：`GET /admin/config`、`PUT lang`、`PUT comments`、`PUT nav`（`site-config.controller.ts`）；
  - 面板 `SiteConfigPage.vue`：lang（el-select allow-create）+ comments（schema-form 驱动）+
    nav（JSON textarea 兜底，C2b links 先例）。
- 主题侧权威源（**字段面与可选性的唯一依据**，执行时打开核对，禁止凭记忆写）：
  - `Mizuki/src/types/config.ts`：`SiteConfig`（L9-197）、`ProfileConfig`（L230-243）、
    `AnnouncementConfig`（L335-348）；
  - 真实基线样例：`Mizuki/src/config.ts` `siteConfig`（L26-158）、`profileConfig`（L284-319）、
    `announcementConfig`（L390-400）。
  - ⚠️ 主题目录在 `apps/server/data/config.json` 的 `mizukiRoot` 指向处——**只许读参考，
    任何测试/脚本禁止写它**（AGENTS §4.9：测试数据隔离在 mkdtemp fixture）。
- 官方文档参考：`mizuki-docs/docs/basic-layout/01-基础配置.md`、`sidepanel/02-个人资料组件配置.md`、
  `sidepanel/03-公告组件配置.md`（背景理解用；类型定义冲突时**以类型定义为准**）。
- 工具链坑（AGENTS §3）：`@mizuki/shared` 改动后须先 build 再跑 server 测试；
  vitest 分批 ≤6 文件 + `--maxWorkers=1`；本机验收三连口径见 §6 T6。

## 2. 目标

把「config.ts 25 对象仅管 3」推进到「管 6」：新增受控面 **siteInfo（siteConfig 的 15 个
非-lang 键）+ profileConfig + announcementConfig**，走满 ADR-020 既有链路（schema →
zod 管道 → 探针门禁 → 定点物化 → 侧车留档 → 面板表单），零新机制、零新依赖。

## 3. 不变量（优先级高于一切任务；冲突时不变量赢）

| # | 不变量 | 验证口径 |
|---|---|---|
| I1 | 验收三连全绿：`pnpm build` exit 0（shared→server→web，vue-tsc 0 错）、`pnpm lint` 0/0、`pnpm test` 存量 490 全绿 + 本批新增全绿 | 三条命令实录 |
| I2 | 公开 API 冻结：`/public/**` 零触碰；既有 `/admin/config` 四端点契约零破坏（p7f/p7h 全绿即证，这两文件**只许因新增字段断言而增量扩充，禁改既有断言语义**） | 逐字 diff + 测试 |
| I3 | 物化红线：全部写盘走 site-config 既有 splice + `preWriteBackup` + `atomicWriteFile` 单源；禁裸 `fs.writeFile` 落 Mizuki 根；`backup.service.ts` / 恢复通道零触碰 | 逐字 diff |
| I4 | 蔓延闸：所有新 schema 全 `.strict()`；侧车 schema **仅增可选键**（旧侧车文件必须仍可解析，version 保持 1，无迁移）；不受管键（见 K2 清单）一个都不许进 schema | schema 审读 |
| I5 | 探针门禁完备：三个新 PUT 各自的探针目标全部存在且 409 路径有 e2e；**不重置漂移轴**（无需重新 capture 基线，ADR-024 两轴独立） | e2e + 代码审读 |
| I6 | 零新增依赖；`pnpm-lock.yaml` / `apps/web/package.json` / `vite.config.ts`（ADR-027）零变动 | 逐字 diff |
| I7 | 生效链不变：保存不自动触发 build，页面保留「保存后需经构建生效」提示；路由表 / 菜单 / MainLayout 零改动 | 逐字 diff |
| I8 | UI 不越界：全部新表单走既有 schema-form / JSON textarea 模式与 U1 token 体系（K7/K8）；禁新增硬编码色值/圆角/阴影 | 代码审读 |

## 4. 预裁决（K1~K10，执行时不再问）

- **K1 端点面（3 新 PUT，全量覆盖语义）**：
  `PUT /admin/config/site-info`（body = SiteInfoSchema 直载，15 键全必填，同 comments 先例）、
  `PUT /admin/config/profile`（body = ProfileConfigSchema 直载）、
  `PUT /admin/config/announcement`（body = AnnouncementConfigSchema 直载）。
  **无 per-key / 整档清除端点**（commentConfig 先例：覆盖写入即管理权转移，无显式清除路径；
  originals 留档仍写，供未来批次做还原，报告「已知限制」节记一笔）。GET 视图扩展见 K4。
- **K2 siteInfo 物化 = siteConfig 对象内逐属性置换（lang 先例），禁整声明替换**：
  siteConfig 声明含大量非受管键，本批受管 = 且仅 =
  `title / subtitle / siteURL / siteStartDate / timeZone / themeColor / featurePages /
  navbarTitle / postListLayout / tagStyle / wallpaperMode / banner / pageScaling / font / toc`。
  **明确不受管（schema 与 splice 一概不碰）**：`lang`（既有端点独占）、`keywords`、`bangumi`、
  `bilibili`、`anime`（≡A-GAP-11，后批）、`showCoverInContent`、`generateOgImages`、`favicon`、
  `showLastModified`、`pageProgressBar`、`thirdPartyAnalytics`。
  originals 键名 `'siteConfig.<key>'` × 15（首次覆盖前留档，仅首次）；基线缺可选属性
  （如 navbarTitle / pageScaling / tagStyle）而 body 含该键 → `insertPropertyAssignment`
  追加到对象字面量末尾。
- **K3 profile / announcement 物化 = 整声明置换（commentConfig / nav 先例）**：
  `getVariableDeclarationOrThrow('profileConfig' | 'announcementConfig')` →
  `setInitializer(valueToTsLiteral(value))`；originals 键名 `'profileConfig'` / `'announcementConfig'`
  首次留档；声明缺失 / 形态不符 → 404（C7 对齐基线源被破坏语义）。
- **K4 侧车与 GET 视图**：`ConfigOverrideFileSchema` 新增可选键 `siteInfo` / `profile` /
  `announcement`（全 `.strict()`，version 仍 = 1）。`AdminSiteConfigView` 新增四字段：
  `siteInfo: SiteInfoValues | null`（= carrier.siteInfo ?? baselineSiteInfo，基线可缺键→面板空字段起步）、
  `baselineSiteInfo: Partial<SiteInfoValues> | null`（基线逐键解析，未支持字面量键省略）、
  `profile: ProfileConfigValue | null`（override ?? 基线整体求值，commentConfig 同构）、
  `announcement: AnnouncementConfigValue | null`（同上）。
- **K5 表单形态分派**：
  - siteInfo 13 个简单键（title/subtitle/siteURL/siteStartDate/timeZone/themeColor/featurePages/
    navbarTitle/pageScaling/postListLayout/tagStyle/wallpaperMode/toc）→ schema-form 驱动
    （CommentConfigSchema 同构用法）；
  - `banner` / `font`（深嵌套 + 联合类型）→ **JSON textarea 兜底 + 保存前 zod 现场校验**
    （nav 先例：格式化 `JSON.stringify(v, null, 2)`、非法 JSON/校验失败 ElMessage.error 不发请求）；
  - `profileConfig.links`（对象数组）→ JSON textarea；其余 profile 字段（avatar/name/bio/typewriter）
    → schema-form；
  - `announcementConfig` 全部 → schema-form（link 嵌套对象有 twikoo/giscus 先例）。
- **K6 探针扩展**：`theme-registry.service.ts` 的 `PROBE_SCHEMAS` 补三映射
  （siteInfo→SiteInfoSchema 等，value-parses-schema 口径）；探针目标清单在
  `packages/shared/src/theme-profile.ts` 档案目录——打开它，**照 `siteConfig.lang` /
  `commentConfig` 既有条目的样式**补 `siteConfig.<15 键>`、`profileConfig`、`announcementConfig`
  的 declaration-exists 条目（探针是档案驱动还是代码驱动以你读到的实际结构为准，原则：
  新受管目标全覆盖、409 可复现）。PUT 接线：site-info →
  `assertProbesPass(['siteConfig', 'siteConfig.title', …15 键…])`；profile →
  `assertProbesPass(['profileConfig'])`；announcement → `assertProbesPass(['announcementConfig'])`。
- **K7 校验细则（zod，字段面与可选性逐字对齐主题类型，只加值域不改可选性）**：

  | 键 | 细则 |
  |---|---|
  | title | `z.string().min(1)`；subtitle / bio 等普通串 `z.string()`（空串合法） |
  | siteURL | `/^https?:\/\/.+\/$/`（官方文档「必须以斜杠结尾」口径） |
  | siteStartDate | `/^\d{4}-\d{2}-\d{2}$/` |
  | timeZone | `z.number().int().min(-12).max(12)` |
  | themeColor | `{ hue: int 0..360, fixed: boolean }` 全必填 |
  | featurePages | 8 布尔全必填：anime/diary/friends/projects/skills/timeline/albums/devices |
  | navbarTitle | `{ mode?: 'text-icon'｜'logo', text: string, icon?: string, logo?: string }` |
  | pageScaling | `{ enable: boolean, targetWidth?: number }` |
  | postListLayout | `{ defaultMode: 'list'｜'grid', allowSwitch: boolean, categoryBar?: { enable: boolean } }` |
  | tagStyle | `{ useNewStyle?: boolean }` |
  | wallpaperMode | `{ defaultMode: 'banner'｜'fullscreen'｜'none', showModeSwitchOnMobile?: 'off'｜'mobile'｜'desktop'｜'both' }` |
  | banner.src | `z.union([z.string(), z.string().array(), z.object({ desktop?: string｜string[], mobile?: string｜string[] }).strict()])`；banner 其余子键（position?/carousel?/waves?/imageApi?/homeText?/credit 必填/navbar?）按类型定义 L141-182 逐字 |
  | font | `{ asciiFont, cjkFont }` 同构 `{ fontFamily: string, fontWeight: string｜number, localFonts: string[], enableCompress: boolean }` |
  | toc | `{ enable/mobileTop/desktopSidebar/floating: boolean, depth: 1｜2｜3, useJapaneseBadge?: boolean }` |
  | profile.links | `{ name: string, url: string, icon: string }[]`（必填数组，`[]` 合法清空） |
  | profile.typewriter | `{ enable: boolean, speed?: number }` |
  | announcement.type | `'info'｜'warning'｜'success'｜'error'`；content `z.string().min(1)`；link `{ enable: boolean, text: string, url: string, external?: boolean }` |

- **K8 UI 组织**：`SiteConfigPage.vue` 单页内用 `el-collapse` 分区：
  站点信息（13 表单键 + banner/font 两个 textarea）/ 评论（现状不动）/ 导航（现状不动）/
  个人资料 / 公告。无新路由、无新菜单、无新组件文件（页面长了允许抽 `sections/`
  子组件，但必须仍是本页私有）。基线对照 = siteInfo 区尾部一个只读折叠 `<pre>`（baselineSiteInfo
  JSON，null 显示「基线不可得」），**不做逐键 diff UI**（本批裁剪，报告记一笔）。
- **K9 保存编排**：一次「保存站点信息」= `PUT site-info`（一个请求，15 键整档）；
  banner/font textarea 内容先 JSON.parse + schema 校验再并入 payload。profile / announcement
  各自独立保存按钮。保存成功提示沿用现有 ElMessage 风格 + 「需构建生效」提示保留。
- **K10 命名与导出**：shared 新导出 `SiteInfoSchema / SiteInfoValues / ProfileConfigSchema /
  ProfileConfigValue / AnnouncementConfigSchema / AnnouncementConfigValue`，经
  `packages/shared/src/index.ts` 既有导出模式透出；e2e 新文件
  `apps/server/test/p7i-site-sidepanel-override.e2e-spec.ts`（p7i 已核实空闲）。

## 5. 任务分解

### T1 — shared 层（先做，改完先 build）

1. `packages/shared/src/site-config.ts`：三个新 schema（K7 全表）+ 侧车三可选键（K4）。
2. `packages/shared/src/theme-profile.ts`：探针目录扩展（K6）。
3. `packages/shared/src/index.ts`：导出（K10）。
4. 跑 `tsc -p packages/shared/tsconfig.json`（或 `pnpm --filter @mizuki/shared build`）确认 0 错。

### T2 — server service 层

`site-config.service.ts`：
1. `readBaseline` 扩展：siteConfig 逐键解析 15 键（`astToValueWithConsts`，banner 等纯字面量
   可求值；未支持节点该键 null）、`profileConfig` / `announcementConfig` 整体求值
   （commentConfig 同构，UnsupportedLiteralError → null + warn 日志）。
2. `spliceSiteInfo(configPath, carrier, values)`：15 键逐属性置换 / 缺失插入（K2）。
3. `spliceProfileConfig` / `spliceAnnouncementConfig`：整声明置换（K3）。
4. `putSiteInfo` / `putProfile` / `putAnnouncement`：探针门禁 → splice → persistConfigTs
   （before===after 跳过写入的既有语义复用）→ 侧车更新 → 日志 → 返回 getConfig()。
5. `AdminSiteConfigView` 四新字段 + `getConfig()` 装配（K4）。

### T3 — server controller 层

三个新 PUT 端点（K1）：`@Put('site-info'|'profile'|'announcement')` + `ZodValidationPipe`
+ 中文 `@ApiOperation` summary，风格逐字对齐既有四端点。

### T4 — e2e（fixture 主题，mkdtemp，p7f 骨架照抄）

`test/p7i-site-sidepanel-override.e2e-spec.ts`，目标 **12~20 条**，覆盖：
- site-info：PUT 往返（物化文本断言 + 侧车键 + originals['siteConfig.title'] 留档）；
  基线缺 navbarTitle → 插入属性；GET override??基线 合并；越界键 400；timeZone=13 → 400；
  siteURL 无尾斜杠 → 400；
- profile：PUT 往返 + links=[] 合法 + 越界键 400；
- announcement：PUT 往返 + content 空 → 400 + type 非法枚举 → 400；
- 探针 409：fixture 主题 siteConfig 声明被破坏形态 → PUT site-info 409 且 config.ts 零变更；
- 旧侧车兼容：写一个「只有旧键」的侧车文件 → 服务启动读侧车不炸，GET 正常（I4）。

### T5 — web 层

1. `apps/web/src/api/config.ts`：三个 put + 视图类型（shared 透出）。
2. `SiteConfigPage.vue`：el-collapse 五区改造（K8）+ 表单分派（K5）+ 保存编排（K9）+
   CONFIG_LABELS 中文标签表扩充（沿既有 labels 参数模式）。

### T6 — 验证与交付

1. 三连：`pnpm build`（shared 先行）、`pnpm lint`、`pnpm test`（分批 + `--maxWorkers=1`）；
   记录**新基线总数**（490 + 新增 N）。
2. 交付物：`docs/audits/u3-p1/README.md`（证据表：每条 e2e 一行 = 用例名 → 断言结果；
   禁 PNG 伪留证）+ `docs/SESSIONS.md` 追加交付段（数账、已知限制）+ `CHANGELOG.md` 顶部条目。
3. 改动留在工作树，**不 commit / 不 push**。

## 6. 禁止清单（红线）

1. 禁 `git commit` / `git push` / `git stash`；禁改 `.git/`。
2. 禁碰 `/public/**`、`backup.service.ts`、posts/media/albums/collections 模块、路由表、
   `MainLayout.vue`、`vite.config.ts`、`pnpm-lock.yaml`、两处 `package.json`。
3. 禁新增依赖；禁 `any`；禁残留 `console.log`；禁裸 `fs.writeFile` 落 Mizuki 根。
4. 禁在测试中写真实主题目录（mizukiRoot 只读参考；fixture 一律 mkdtemp）。
5. 禁重置/重捕获主题基线（漂移轴不动）；禁改 `MIZUKI_*` env 语义与侧车路径推导逻辑（p7h 域）。
6. 禁给 site-info / profile / announcement 做清除端点或逐键还原 UI（K1/K8 已裁剪）。
7. 禁把不受管键（K2 清单）塞进 schema 或表单——包括看着眼馋的 `keywords` / `anime` / `bilibili`。
8. 完成即停：不越界「顺手优化」；未列文件的改动须在报告首节说明缘由。

## 7. 停止条件

- T1~T6 全绿 + 三连通过 + e2e 目标条数达成 → 写交付报告 → **停**，等架构师验收。
- 任一不变量 I1~I8 无法满足 → **停**，报告写明卡点与已尝试方案，勿绕行。
- schema-form 无法承载某个简单键（K5 分派内确实搞不定）→ 该键降级 JSON textarea 可自行决定
  （K5 精神内），但须在报告列出降级清单；除此之外的范围变化一律停。
- 工作量失控（预计改动 ~10 文件：shared×3 + server×3 + web×2 + test×1 + docs×3）→ **停**。

—— 架构师签发，2026-10-19
