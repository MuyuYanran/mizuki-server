# 功能-文档对齐核查（2026-10-18，三方模型 · 架构师合成）

> 任务：检查项目有哪些功能没有与文档对齐（PM 原话「查看缺少哪些功能」）。
> 方法：三把尺子并行核查——
> **A 尺** = Mizuki 官方文档镜像（76 页，`…/BlogFiles/mizuki-docs/`）vs 面板能力面；
> **B 尺** = 项目自身规格（REQUIREMENTS 一/二/三期 + MASTER-PLAN）vs 实现；
> **C 面** = 实现功能底账（64 路由 / 18 页面全量盘点），供差集基准。
> 产出：本清单交 PM 裁定批次归属；其中「缺陷级」三条建议先行直修。
> 子代理：A 尺 / B 尺 / C 面各一，全部只读；架构师另对 6 条关键证据做了独立抽验。

---

## 0. 总体结论（一句话）

**内容域（集合/文章/相册/媒体/about）零缺口、零字段漂移**；缺口集中在**配置域**（config.ts 25 对象仅管 3）、**构建域**（pagefind 索引缺失）、**备份域**（bilibili-data.json 漏收）与**规格欠账**（二期两项 P1 承诺无裁剪记录地未落地）；另抓出 **3 条缺陷级问题**（1 条面板断链 + 1 条构建埋雷 + 1 条备份漏收）。

---

## 1. 缺陷级发现（建议 U3-defect 批先行直修）

### DEF-01 devices 集合前后端断链（面板「设备」页不可用）

- 后端 registry 七类含 devices（grouped 形，`apps/server/src/modules/collections/registry.ts:96-105`），菜单有入口（`apps/web/src/layouts/MainLayout.vue:45`「设备」→ `/collections/devices`），路由 `/collections/:type` 也通。
- 但 `apps/web/src/views/collections/CollectionListPage.vue:52-60` 的 CONFIGS 只登记 **6 类**（diary/friends/projects/timeline/skills/anime），无 devices 条目 → 点击菜单渲染「未知的集合类型」占位。`DeviceItemSchema` 已 import（:18）未使用。
- 文件头注释（:4-6）声称「复用于 …devices」——**注释与实现不符，属漏登记而非有意裁剪**。
- 修法（一行级）：CONFIGS 补 `{ type: 'devices', title: '设备', schema: DeviceItemSchema, idField: 'name', shape: 'grouped' }`（idField/grouped 语义以 registry 为准，需核对后端 grouped 定位键）。

### DEF-02 新建文章预填 `pubDate` 而非必填的 `published`（主题构建埋雷）

- 主题 schema（`Mizuki/src/content.config.ts:9`）`published: z.date()` **必填**；schema 中无 pubDate/date。
- 面板新建文章默认表单（`apps/web/src/views/posts/PostEditPage.vue:122-126`）：`published: ''`（空=不写键），`pubDate: todayString()`、`date: todayString()`（预填当天）→ 用户不动日期直接保存的文章**落盘只有 pubDate，无 published**。
- **Astro 6.1.2 行为已实证（架构师直验，非猜测）**：glob loader → `content-layer.js:237` parseData → `utils.js:143` `schema.safeParseAsync` → `utils.js:172` `throw formattedError`（InvalidContentEntryDataError）——**缺 published 的文章使主题构建直接报错，不是静默跳过**。面板 build 任务（经服务端跑 `astro build`）会因此失败。
- 修法：新建表单预填 `published: todayString()`（编辑时 populateForm 覆盖语义不变）；`date/pubDate` 兼容字段保留不动。

### DEF-03 bilibili-data.json 不入备份（数据丢失窗口）

- BiliBili 模式 API 缓存落 `<mizukiRoot>/src/data/bilibili-data.json`（本机实测存在，123KB）；官方文档 `special/08-番剧页面.md:42-48`。
- `apps/server/src/infra/backup/backup.service.ts:274-282` data/full scope 收集只认 `name.endsWith('.ts')` → **该 JSON 缓存既不进 data 备份也不进 full 备份**。
- 修法：data scope 收集规则放宽为 `*.ts` + `*.json`（仍限 `src/data/` 顶层，不递归），或按 manifest 显式追加该文件名。恢复路径无需改动（manifest 回灌按原路径）。

### DEF-04（小）相册上传文案漂移

- `apps/server/src/modules/albums/albums.controller.ts:80` Swagger summary 及前端多处注释仍写「非 JPG 自动转 JPG」；实际 B2 裁决 2 已改**原格式落盘**（`albums.service.ts:404`）。文案订正项。

### DEF-05（小）媒体白名单文案少 tif

- 文案 8 扩展名（`media.service.ts:44`、`albums.service.ts:418`），放行层实为 9（含 `.tif`，`common/security/magic-sniff.ts:36-45`）。文案订正项。

---

## 2. A 尺缺口（官方文档能力 vs 面板覆盖）

> 详证见子代理 A 尺报告；此处为裁定用摘要。档位含义：P1=高（功能完整性/官方主链路）、P2=中、P3=低/机会型。

| 编号 | 缺口 | 文档依据 | 实现侧证据 | 档位 |
|---|---|---|---|---|
| A-GAP-01 | siteConfig 站点信息档未管（title/subtitle/siteURL/siteStartDate/timeZone/themeColor/featurePages/navbarTitle/postListLayout/tagStyle/wallpaperMode/banner/pageScaling/font/toc，lang 已管） | basic-layout/01:20-142 | `shared/src/site-config.ts:70-86` 仅 3 对象；主题 config.ts:26-158 含全部键 | **P1** |
| A-GAP-02 | 侧栏内容未管（profileConfig/announcementConfig） | sidepanel/02:55-60、03:55-60 | 主题 config.ts:284/390 无受管面 | **P1** |
| A-GAP-06 | ~~pagefind 索引后置缺失~~ **改判：审计误诊，销案**（主题 build 脚本已内联 pagefind，面板参数原样透传，dist/pagefind 实存） | guide/deploy/07:104 原文是 `\|\|` 兜底链，非后置步骤 | 主题 package.json:16 `... && pagefind --site dist && ...`；process-manager 参数透传 | **销案** |
| A-GAP-08 | bilibili-data.json 不入备份（= DEF-03） | special/08:42-48 | backup.service.ts:274-282 只收 *.ts | **P1**（并入 DEF-03） |
| A-GAP-07 | 任务级环境变量注入缺失（BILI_SESSDATA、ENABLE_CONTENT_SYNC 等无法经面板注入） | special/08:107-131、separation/01:40-41 | process-manager.service.ts:414-431 env 白名单仅 PATH/HOME/APPDATA+CI | P2 |
| A-GAP-09 | ~~frontmatter 已知字段表缺 7 键~~ **已闭环（U3-P2）**：七键入写入口 schema + NULL_DELETE_KEYS + 面板表单项，KNOWN_FM_KEYS 16→23，p5f 7 用例 | writing/05:56-60 | posts.service.ts:74-141；PostEditPage.vue（七键表单/回填/提交）；test/p5f-*.e2e-spec.ts | **闭环** |
| A-GAP-10 | ~~LinkPreset 面板不可解析且用户无感知~~ **已强化闭环（U3-P2）**：AdminSiteConfigView 增 `baselineNavRaw` 原文对照 + 接管保存二次确认，p7f ⑯⑰ 锚；**children 封顶 1 层维持 ADR-020 已知限制**（本批不动） | basic-layout/04 | site-config.service.ts（baselineNavRaw）；SiteConfigPage.vue（原文折叠区 + 接管确认）；test/p7f ⑯⑰ | **闭环（children 除外）** |
| A-GAP-11 | 番剧非 local 模式 config 未管：bangumi.userId、bilibili.vmid/fetchOnDev/coverMirror/useWebp、anime.mode（≡ B-P2-05，合并裁定） | special/08:54-96、:238-245 | 主题 config.ts:57-69；site-config.ts 无此键 | P2 |
| A-GAP-12 | Markdown 增强语法（::github/5 类提示框/:spoiler/mermaid/数学公式/w-%/视频 iframe）在面板预览与公开 API 渲染中不支持（落盘原文无损，构建期主题自渲染）；公开 API 契约已冻结 P8 | writing/Markdown/02:18,50,87、03:11、06:14、special/01:44-68 | render.ts:20-48（marked+sanitize 子集） | P3 |
| A-GAP-03 | 布局外观档未管（footer/sidebarLayout/share/license/permalink/relatedPosts/randomPosts/showLastModified/expressiveCode/字体/fullscreenWallpaper） | basic-layout/layout/01-03、02、03、05；article-layout/01-05 | 主题 config.ts:159-633 均 0 纳入 | P3 |
| A-GAP-04 | 特效外链档未管（musicPlayer 含 meting_api 敏感键、pio Live2d、sakura） | feature/01:12、02:17、03:12 | config.ts:402/584/556 无受管面 | P3 |
| A-GAP-05 | Umami 统计无面板通道。**裁定建议：不做写管理**（跨 astro.config.mjs+Layout.astro 两文件，超 config.ts 物化边界），可做只读状态展示 | feature/04:37-92 | config.ts:633 注释明示迁出 | P3（仅状态展示） |
| A-GAP-13 | 迁移导入器（Markdown 系★易 / Hexo/Hugo/Jekyll ★ / Halo/Typecho/WordPress ★★★）无任何通道 | transfer/01-10 | 无 importer 模块 | P3（待 PM 表态） |

**frontmatter 命名裁定（已闭合，记录在案）**：主题真名 = `published`（z.date() 必填）+ `image`；`pubDate`/`cover` 是官方文档 transfer 系列的内部漂移，**不采信**。面板字段名与主题 schema 一致，**无需改任何一侧**。若立项导入器，日期一律产出 `published`。

---

## 3. B 尺缺口（自身规格承诺 vs 实现）

### P1（规格明文「必须」，无裁剪记录）

| 编号 | 缺口 | 规格依据 | 实现侧证据 | 备注 |
|---|---|---|---|---|
| B-P1-01 | R2-2 向导目录点选器整条未落地（GET /admin/system/browse-dirs + 树形点选 UI） | REQUIREMENTS-PHASE2:17-29 | system.controller.ts 六路由无 browse-dirs；InitWizardView.vue:186 仍为 el-input | B2 终版报告三期输入增量未提此项 |
| B-P1-02 | R2-10 控制台历史持久化 + 任务模板整条未落地（task_run 表 + /admin/process/runs + config 模板 + 面板历史区） | REQUIREMENTS-PHASE2:72-89 | schema.ts 11 表无 task_run；process.controller 无 /runs；app-config.ts 无 tasks 键 | C3 仅裁决了 command_snapshot 内存承载，四件均无裁剪记录 |
| B-P1-03 | R2-14 子项「列表端点输出统一 items 数组」未实现 | REQUIREMENTS-PHASE2:120 | AlbumView={name,info,images[]}，本地与外链未合并输出 | **UNSURE**：B2 终版提示词不在仓，无法证实是否有意裁剪；建议补裁决 |

### P2（清单/规划级承诺，措辞较软，无裁剪记录）

| 编号 | 缺口 | 规格依据 | 实现侧证据 |
|---|---|---|---|
| B-P2-01 | Mizuki 设置接管范围大幅收窄：网站基础信息（lang 外）、社交链接、功能开关无接管面（与 A-GAP-01/03 同源，config 域合并裁定） | REQUIREMENTS:126-128、320 | 受控面仅 lang/comments/nav 三键 |
| B-P2-02 | config.json 服务参数（API/端口/上传上限/备份目录）无面板编辑入口 | REQUIREMENTS:320 | SettingsPage.vue:9-11 明示「不在此修改」；无管理端点 |
| B-P2-03 | 媒体「重命名、格式转换」未实现（二期「媒体库完善」整体无裁剪记录） | REQUIREMENTS:321、386 | MediaLibraryPage 操作列仅复制/删除 |
| B-P2-04 | 自动备份未实现（规格：手动/自动） | REQUIREMENTS:322 | backup.controller 4 路由无调度器 |
| B-P2-05 | anime.mode/bangumi/bilibili 归 C7，C7 实落未含，三期文档内部口径张力未销账（≡ A-GAP-11） | REQUIREMENTS-PHASE3:90、ADR-018:37,51 | server/shared grep 零命中 |
| B-P2-06 | 二期清单「友链申请审核、文件 diff」未实现且无裁剪记录（评论系统已由 ADR-016 有意关闭，不计） | REQUIREMENTS:386 | 全仓 grep 仅规格原文一处 |
| B-P2-07 | 「模式二/三前端侧接入」仅有模式枚举/菜单过滤，无「向主题写入 API 客户端/组件」行为 | REQUIREMENTS:79-85、386 | **UNSURE**：若解读为主题侧工作则不属本仓缺口，建议裁决划界 |
| B-P2-08 | 一期路线图「三期」八项（浏览量/点赞/说说/全文搜索/访客分析/RSS/缓存/PG-MySQL）被实际三期规格静默跳过 | REQUIREMENTS:387 | PHASE3 全文无一项 |
| B-P2-09 | ~~外链相册封面未纳入媒体引用注册表~~ **已闭环（U3-P2/K4）**：collectReferences 实装，cover + photos[].src 双注册（`album-cover` / `album-photo`），media 模块零改动，p7j 8 用例 | REQUIREMENTS:431-432；PHASE2:114 | albums.service.ts（collectReferences + toMediaPath）；test/p7j-*.e2e-spec.ts | **闭环** |

### P3 状态确认（有意裁剪/显式移交/冻结，有据，非缺口）

| 编号 | 事项 | 依据 |
|---|---|---|
| B-P3-01 | 评论系统自建：有意关闭（comment 表休眠、/public/comments 冻结、commentConfig 面板化已落） | R2-18 L163-167「三期 C0 关闭，见 ADR-016」 |
| B-P3-02 | 富文本软删恢复入口：显式移交四期裁量 | REQUIREMENTS-PHASE3 §3.6 + §4.2 L133-134 |
| B-P3-03 | REQUIREMENTS §13 L390 MVP 不做项（统计/搜索/AI/多主题/插件/自动部署）——一期有意裁切，状态不变 | REQUIREMENTS §13 |
| B-P3-04 | E 批 E1.5/E3b/E2 冻结（解冻顺序 E1.5→E3b→E2） | SESSIONS.md L13-14 |
| B-P3-05 | 未清项维持：C7 疑问②（config.ts 物化态面板警示）、C3 项 6（POSIX 真机抽查） | SESSIONS.md L15-16、REQUIREMENTS-PHASE3 L137-138 |

### 有据偏差（DEV，实现偏离规格文本但裁决在案——欠的是**规格文本修订**）

| 编号 | 偏差 | 裁决依据 | 欠账 |
|---|---|---|---|
| B-DEV-01 | minimal 菜单只隐藏富文本（规格文本写「与六类集合」） | B2 终版裁决 7 | 修订 PHASE2:40 |
| B-DEV-02 | timeline type 用官方四值 + 载入迁移（一期基线表未修订） | ADR-018 | 修订 REQUIREMENTS:222 |
| B-DEV-03 | posts 封面维持转 JPG（R2-7 点名应撰的 ADR-010 文件缺失） | B2 裁决 2/3 | 补 ADR-010 或以 ADR-028 记录归并 |
| B-DEV-04 | 富文本「导出 Markdown」为 HTML 包降级实现 | P10c §3.3 授权降级 | 修订 REQUIREMENTS:318 加注 |

---

## 4. 实现盘点异常（非缺口，杂项维护清单）

1. preview 任务无启动按钮（ConsolePage TASK_OPTIONS 只三项）——**语义合理**（服务端自有静态预览通道，astro preview 属冗余），建议文案注明而非补按钮。
2. MINIMAL_HIDDEN_PREFIXES 双份维护（router/index.ts:79 与 MainLayout.vue:72）——收敛为 shared 单源。
3. 遗留占位组件 DashboardPlaceholder.vue / PlaceholderView.vue 未被路由引用——移除或留档。
4. theme 端点（/admin/theme/status、capture）无前端消费——**E3b 冻结的一部分**（漂移呈现面板），解冻顺序 E1.5→E3b→E2；零消费本身即 E3b 未做。
5. ADR-021/022/023/025 引用无文件——AGENTS §12 已文档化，维持「以代码内标签为准」口径。
6. bmp 双口径（媒体库面防御拒绝/相册面准入）——ADR-017 已文档化，非缺陷。

---

## 5. 建议批次划分（交 PM 裁定）

| 批次 | 内容 | 量级估计 |
|---|---|---|
| **U3-D（缺陷先行）** | DEF-01 devices 登记、DEF-02 published 预填、DEF-03 备份收 *.json、DEF-04/05 文案订正 | 小（3 行级修复 + 2 文案） |
| **U3-P1（配置域一期）** | A-GAP-01 站点信息档 + A-GAP-02 侧栏内容（即对接报告 U3-P1/P2 档） | 中（schema+物化器+表单） |
| **U3-P2（构建与杂项）** | ~~A-GAP-06 pagefind 后置钩子~~（改判销案）、A-GAP-09 frontmatter 补 7 键表单、B-P2-09 相册封面注册表、A-GAP-10 LinkPreset 警示强化 | 中（已交付，见 §6） |
| **U3-P3（裁定销账）** | B-P1-01/02/03 补裁决或立项、B-P2-05/07/08 划界裁决、DEV 四项规格文本修订 | 文档轮 |
| **U3-P4（低优档）** | A-GAP-03/04/05/07/11/12、A-GAP-13 导入器（待表态） | 大，逐项独立裁定 |

---

## 6. A-GAP-06 改判销案（U3-P2，2026-10-19）

**原判**：pagefind 索引后置缺失 —— 「官方 Docker 口径 build 后须 `pnpm exec pagefind --site dist`，面板 build 产出无搜索索引」，P1。

**改判：误诊，销案。** 四条独立证据：

1. **主题 build 脚本已内联 pagefind**：主题 `package.json:16` 为
   `"build": "node scripts/update-anime.mjs && astro build && pagefind --site dist && node scripts/compress-fonts.js"`
   —— pagefind 是 build 链内的顺序一步，`pagefind ^1.4.0` 还是运行时依赖（:68），不是可选后置钩子。
2. **面板参数原样透传**：`process-manager.service.ts:129` 的 `taskArgs(task)` → `['run','build']`（:407-412）。
   pm-resolver 的垫片穿透只改写 **调用 pnpm 自身**的那一层（`pm-resolver.ts:220`，file=process.execPath + 入口 js），
   `run build` 这两个参数不经过任何改写 ⇒ 面板执行 build 必然跑完主题完整脚本链（含 pagefind）。
3. **产物实存**：`Mizuki/dist/pagefind/` 内 `pagefind-entry.json` 等 8+ 文件在（2026-09-08 构建产物）。
4. **审计引用的文档原文被误读**：`guide/deploy/07-Docker部署.md:104` 原文是
   `RUN pnpm run build || pnpm exec astro build && pnpm exec pagefind --site dist`
   —— 这是**失败兜底链**（`&&` 优先级高于 `||`：整条 build 成功就短路，只有 build 失败才退回
   astro-only + 补跑 pagefind），不是「build 之后还须补跑 pagefind」的口径。

**动作**：仅台账改判（本节 + 上表行 + SESSIONS 记录）。**零产品代码、零测试**——
刻意**不**写「断言主题 build 脚本含 pagefind」这类测试：主题源码内容不属于本仓契约，
主题哪天改脚本也不该让本仓 CI 变红。

**连带记录（防后续误判）**：主题 `.npmrc` 有 `manage-package-manager-versions = true`、
`packageManager=pnpm@10.22.0`，宿主 pnpm 12 会自切到 10.22.0 执行；这**与本裁断无关**
（pagefind 在主脚本而非 pre/post 钩子，任何 pnpm 版本行为一致），单独记下来以免下次又被当成变量。

---

## 附：核查方法与证据可信度

- A 尺对前期《对接分析报告》5 条结论做了抽查验证，全部属实（含行号）；B 尺对「裁剪查证链」穷尽了在库证据（B2 终版报告 + 注记体例缺失比对）；C 面全量列出 64 路由无一遗漏。
- 架构师独立抽验坐实：DEF-01（CONFIGS 六类实读）、DEF-02（**Astro 6.1.2 源码级实证 throw 行为**）、DEF-03（主题 data 目录实测 + collectSources 实读）、A-GAP-09（主题 schema 22 键 vs 面板 16 键实读）、A-GAP-10（LinkPreset 两侧 grep）、theme 端点零消费（grep 全无）。
- 所有子代理全程只读，未写任何文件。
