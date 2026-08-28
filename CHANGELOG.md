# 变更日志

## Phase3-C0 — 三期规划对齐（纯文档批）

- **T1 官方文档快照三件**（`docs/audits/phase3/`，每件头部注明来源 URL 与「快照内容由架构师 2026-08-28 抓取，执行会话无网，以本文件为准」）：`press-key.md`（文章客户端加密：bcryptjs 哈希比对 + crypto-js 对称加密，全流程访客浏览器内完成，加密发生于构建期，Server 无参与义务；frontmatter `encrypted`/`password` 用法 verbatim）、`twikoo.md`（主题 `src/config.ts` `commentConfig` 结构 verbatim、envId/持久化/审核语义、文章级 `comment: false` 开关）、`giscus.md`（giscus 键语义、Announcements 建议、前置三条件）
- **T2 三期规格起草**：`docs/REQUIREMENTS-PHASE3.md` —— §1 决议登记 8 条（人工裁决 2026-08-28：评论经主题、文章密码锁 C1、C3 四层解析链、C4 /preview+缩略图、C6 撤销、B2.1 疑问两裁决、流程规则、批次序列 C0→C1→C2→C3→C4→C5→C7→收官）；§2 批次范围一句话表；§3 遗留入册（B4 审计 8 项、R2-16、description 存量体检、p9 隔离、外链 photos 子规格、工程债清单）
- **T3 ADR-016**（`docs/decisions/ADR-016-comment-via-theme.md`）：评论采用主题自带 Twikoo/Giscus，Server 零自建；comment 表休眠；`/public/comments` 永久冻结（P8 冻结表第 5 行 ⏳→🔒）；C7 仅管理 commentConfig 配置面
- **T4 状态注记**：REQUIREMENTS-PHASE2 新增 R2-18 评论条目（三期 C0 关闭，见 ADR-016）+ R2-16「三期 C3 认领」注记；README「API 概览」补 `/public/comments` 永久不实现注记
- **T5 台账**：CHANGELOG 本节 + SESSIONS C0 报告
- **纪律**：仅变更 docs/**；零代码、零测试、零依赖变更；测试基线保持 **295/295 不变**

## Phase2-B2.1 — 裁决 8 补齐 + 判卷残留消除（二期收官补丁批）

- **背景**：B2（HEAD=b7cc691）判卷发现九项裁决中裁决 8「posts description：server 端创建/修改强制必填」被静默漏项（`posts.service.ts` 仍为 `description: z.string().optional()`，且 B2 任务表/偏差清单/三期输入均未记录）。本批补齐，B2 报告完整性缺陷记入台账。
- **T1 裁决 8 落地**：新增 `PostFrontmatterWriteSchema`（description `z.string().trim().min(1)`，拒绝缺失/空串/纯空白），仅用于创建入口（`CreatePostBodySchema` + 服务内纵深防御）；PATCH 为增量合并语义——body 中出现 description 才过必填校验、不出现则放行保留既有值，存量盘上文件缺 description 不误伤；读取/列表/sync/公开 API 零复用必填面（`scanPosts` 直接 `parseMarkdown`），`uploadCover` 维持 optional schema；错误形态走既有 ZodValidationPipe → 400 {code, message, detail.issues}（P1 语义）；面板 PostEditPage description 字段必填校验（空值/纯空白阻止提交 + 字段级提示）；e2e `p5b-description-required` 2 用例（创建缺 description → 400 且目录零落盘；PATCH description="" → 400 且 md 文件 sha256 字节不变）
- **T0 avif 单测核查**：`magic-sniff.spec.ts` 已存在 avif 用例（L33-40 正例 + isom 反例），零新增
- **T2 判卷残留**：新建 ADR-015 改密窗口语义（改密 → token_version +1 → refresh 401；已签发 access 15min 内自然过期前仍可用、无黑名单，风险接受理由关联 ADR-005 logout 无状态先例）
- **受影响基线修复**（9 处，均经 POST /admin/posts 写入口，body 补 description）：p5 ×4（e2e-first / restore-me / draft-flip / fm-round 重复 slug 409 用例）、p7 ×1（ref-cover）、p8 ×4（MD 日期循环 / xss-md / draft-md / inc-post）；`../evil` 用例断言 `[400,403]` 天然兼容未动
- **验收**：test 293 → 295（+2 e2e，T0 未触发）、build 0、lint 0/0；纪律：零新增依赖、零表结构变更、fixture 零变更、禁触文件零触碰

## Phase2-B2 — 后端增强（二期收官批：外链相册 / id 迁移 / 四件套 / 预览通道）

- **T1 相册外链模式（R2-14 重定义落地）**：shared 新增 `AlbumInfoExternal`（`mode:"external"` + cover + `photos[]`，除 src 外全可选：thumbnail/alt/width/height/camera/lens/settings），与本地模式（缺省/local）组成 union；albums 服务读写外链 info.json（以 B4 fixture `external-demo` 官方样例为准）；外链照片 CRUD + 外链相册管理路由；mode 切换精确规则——切 external 要求本地照片目录与记录为空否则 409（错误信息含现存本地照片数），切 local 要求 photos 为空否则 409；e2e `p7b-external-albums` 12 用例（创建→加照片→改字段→删照片→删相册全生命周期 + 双向拒绝/放行）
- **T2 转码拆分与 tiff 注记（裁决 2/3）**：相册上传管线移除「非 JPG 强转 JPG」，png/webp/gif/avif 原格式落盘（posts 封面 cover.jpg 硬约定维持转码、媒体库直传维持现状）；tiff 能力层（magic-sniff 双端序签名 + 单测）保留、放行层（上传白名单）排除——手动放置的文件仍可正常渲染，仅管理面上传不支持；README 与 ADR-013 追加注记两层关系
- **T3 id 类型迁移（裁决 9，ADR-014）**：五类集合（diary/friends/projects/timeline/skills）id 由 nanoid string 迁移为 number（devices 官方 grouped 规格无数字 id，idField=name 保持 string）；迁移触发于引擎载入文件时——zod parse **之前**对原始 JSON 检测（防死锁），max+1 换新并经引擎既有文件锁 + temp+rename 原子写回，幂等、不保留旧映射、不做旧引用兼容；POST 自动生成改 max+1（冲突重试上界 1000 次）；`:id` 路由改数字校验无双兼容；shared mapper 与 media-reference 类型同步；面板 SchemaForm id 字段只读展示（「id 自动分配」）、集合页 id 只读窄列；fixture 六类数据 number 化并 grep 全仓同步引用点；备份导出 JSON id 为 number + round-trip 断言；迁移 e2e `p4b-id-migration` 6 用例（①死锁证明：setup 直写临时 string 文件→列表接口→响应与磁盘均 number 化）
- **T4 四件套（裁决 5/4/6）**：① `PATCH /admin/auth/password`——旧密码 argon2id verify + 新密码哈希，admin_user 表新增 token_version（migration 机制 ALTER，非删库），改密 +1 吊销全部 refresh；refresh 校验 token 内 ver 与表内 ver 不一致即 401，access 15min 自然过期不吊销；② `PATCH /admin/system/mode`——写 config.json + resetAppConfigCache 活取值生效，进程不重启；③ Swagger 开关——config 新增 `swagger` 字段（默认 true），main.ts 按值挂载 docs，README 生产部署清单注记公网建议置 false；④ 面板设置页「修改密码」卡片（旧/新/确认新 + 强度校验同注册），成功后提示「已吊销所有会话，请重新登录」并自动登出；e2e `p2b-t4-auth-system` 9 用例（旧 refresh 401 / 新密码可登录 / 旧 access 有效期内仍可用）
- **T5 manage 菜单收窄（裁决 7）**：`MINIMAL_HIDDEN_PREFIXES` 仅保留 `/articles`（富文本文章），六类集合菜单保留、路由守卫同步放行 `/collections/*`；e2e `p2b-t5-manage-narrow` 2 用例（manage 模式下六类集合 API 200、富文本 API 仍 200——数据层语义，UI 隐藏效果转手动走查）
- **T6 content-posts 预览通道（裁决 1）**：`/site-assets/content-posts/<slug>/<rel>` → `src/content/posts/<slug>/<rel>`（GET only 只读），四条安全边界（JWT/逐段解码走私拒绝/扩展名白名单/safeRealJoin 路径监狱 + isFile 复查）全部复用 ADR-012 既有机制零新语义；预览层两分支定案——相对路径解析后落在 slug 目录内即改写（含子目录 `./sub/x.png`），逃出 slug 目录（../）不改写；无条件改写不做文件存在性检查（纯函数，破图即「图未就位」）；web 端 `contentPostSrc()` 纯函数 + VditorEditor `contentSlug` prop 接线（保存前 restoreValue 还原，源文件零改动）；e2e `p2b-t6-content-posts` 8 用例（相对路径/子目录改写 200 字节一致、认证穿越三变体 404、无 JWT 401、不存在文件 404）
- **T7 台账**：ADR-014（id 迁移语义：自动换新/载入触发/原始值层/无兼容/devices 例外）；ADR-013 追加（白名单终集/转码拆分/tiff 两层注记）；REQUIREMENTS-PHASE2 R2-14 勾销并按官方形状重定义、R2-16 状态注记（ADR-011 设计先行、实现未落地转三期输入）；README 注记（Swagger 开关/上传白名单）
- **受影响基线断言修复**：`app-config.spec` ×2（toEqual 补 `swagger: true` 默认字段）；`schemas.spec` id 字面量 `'x'` → `1`（number id 后字符串字面量反而干扰失败原因定位）；`p8 §6.7` `one.jpg` → `one.png`（裁决 2 直接行为变化）；`p4 §6.4` tsc 编译用例超时放宽 30s→120s（全量并行下 worker 争抢 CPU 实测 37s）
- **纪律**：公开 API 四路径冻结零变化；/site-assets 既有行为不变（仅新增 content-posts 出口）；六类集合 schema 除 id 类型迁移外零新增字段（幽灵字段禁令）；token_version 走 drizzle migration（0001_add_token_version.sql）非删库重来；零新增依赖
- **验收**：三连全绿（test 293/293 = B4 尾数 254 + 新增 39、build 含 web、lint 0/0）

## Phase2-B4 — Mizuki 真实主题规格对齐审计（R2-17，裁决呈报批次）

- **官方文档快照落盘**：`docs/refs/mizuki-docs/` 16 页（来源 docs.mizuki.mysqil.com，快照 2026-08-28，CC-BY-4.0；清单与快照说明见其 README）；摘录证据基座 `docs/audits/b4-doc-excerpts.md`
- **审计总表**：`docs/SPEC-ALIGNMENT-B4.md` 27 行逐条三列（官方规格含摘录引用 / Server 现状含代码行号 / 处置四分类）——【本批已修】4、【维持现状】4（附理由）、✅已对齐 4、【B2 落地（待裁决）】8、【需裁决】7
- **friends 必填面对齐官方（本批已修）**：shared `FriendsItemSchema` desc 必填、tags `min(1)`（官方 FriendItem §2 逐字）；fixture f-002 补 desc/非空 tags；schemas.spec 新增「缺 desc/空 tags 均拒」用例；p4 e2e friends 创建体同步；**id 类型（官方 number vs Server nanoid string）涉服务行为，转追加裁决项 9**
- **上传格式扩展（本批已修）**：magic-sniff 补 TIFF 双端序魔数（`II*\0`/`MM\0*`）+ `.tif/.tiff` 入白名单 + media/albums FORMAT 映射与 reencode 分支 + 白名单提示文案同步；单测补 tiff 正反用例与「bmp/svg/avif 不在白名单」回归锚。**bmp 实证不落地**：sharp 0.35 预编译版无法解码 BMP（本批 probe 实测），放行即必 400 死入口——与 svg（XSS 面）、avif（ftyp 嗅探成本）一并转 T4-3 裁决
- **fixture 官方化（本批已修，B2 测试靶就位）**：新增官方外链模式相册样例（`public/images/albums/external-demo/info.json`，mode:"external"+cover+photos[] 富元数据，逐字对齐 special-gallery §外链模式详解）；新增文件夹方案相对路径图片文章样例（`src/content/posts/relative-images/` index.md+figure.png，`![](./figure.png)`）；friends/timeline 数据对齐官方示例值
- **ADR-004 兑现（本批已修）**：`TIMELINE_DEFAULTS.education` 按官方示例逐字修订为 `material-symbols:school`/`#059669`（官方图标集为 Iconify 非 Lucide）；certificate/project/other 无官方示例暂定保留并逐行注记；fixture t-001 同步；ADR-004 遗留义务勾销
- **裁决呈报（未实施）**：T4-1 相对路径图片预览通道 / T4-2 非 JPG 强转 JPG 去留 / T4-3 上传白名单终集与 svg 处置 / T4-4 运行期 mode 端点 / T4-5 改密端点 / T4-6 生产 Swagger 开关 / T4-7 manage 隐藏范围 / T4-8 posts description 必填策略 / 追加项 9 六类 id 类型——各含背景/候选≥2/利弊/建议（标注「建议，待人工裁决」）
- **台账**：ADR-013（对齐基线原则：快照唯一依据、处置四分类、幽灵字段禁令）；REQUIREMENTS-PHASE2 追加 R2-17；R2-14 的外链相册形状与官方不符（source:"external"+urls[] vs 官方 mode:"external"+photos[]）已列入 B2 输入增量
- **纪律**：albums/posts 控制器与 service 行为零改动（仅白名单常量与错误文案同步）；公开 API 冻结路径零变化；/site-assets 边界未触碰；零新增依赖
- **验收**：三连全绿（test 254/254 = B3.6 尾数 250 + 新增 4、build 含 web、lint 0/0）

## Phase2-B3.6 — Vditor 暗色内容区修复 + 日期控件补齐 + 相册上传接线（人工裁决补丁）

- **Vditor 暗色内容区修复（真缺陷）**：根因——`options.theme` 只换 chrome 变量，`.vditor-reset` 内容层排版由 content-theme（`preview.theme.current`，默认 `light`）独立承载，暗色下内容层仍亮色硬编码 → 深底深字。修复双链：主链路为构造选项 `preview: { theme: { current } }` + `setTheme` 第二参同步内容主题（官方 content-theme 样式，自托管 `/vditor/3.11.3/dist/css/content-theme/` 已含）；兜底层为 `theme.css` 新增 `--mizuki-vditor-*` 11 变量（亮色值与官方默认逐一对齐、暗色值对齐官方 dark.css）+ VditorEditor `:deep(.vditor-reset)` 规则（文字/背景/标题分隔线/引用/表格/行内码/代码块/kbd）；sv 模式由 chrome 变量接管不受影响；三模式明暗截图取证
- **日期控件补齐（真缺口）**：PostEditPage 的 date/pubDate（×2）、AlbumsPage 创建对话框、AlbumDetailPage 编辑对话框的日期字段由裸 `el-input` → `el-date-picker`（`value-format="YYYY-MM-DD"`、默认当天）；`mapper.ts` 的 `todayString()` 改导出，自定义表单页复用 B1 同一实现；清空回调 `null → ''` 保持 string 语义；grep 断言三页无裸 el-input 日期残留。AboutEditPage 经核查无日期字段；RichArticleEditPage 属 TipTap 页，恪守规格未触碰（唯一残留，报告注明）
- **相册上传接线修复（真缺陷）**：AlbumDetailPage 上传原走 ImageUploader → `POST /admin/media`（媒体库端点，且会写入 media_file 索引），改为直调 `albumsApi.uploadImage` → `POST /admin/albums/:id/images`（multipart 字段 `file`，以 `albums.controller.ts` 服务端契约为准）；原名保存、非 JPG 后端转 JPG、上传后网格刷新、不写媒体库索引（P7 偏差 2 边界）；删除本就走相册端点（既有正确，未动）；移除该页 ImageUploader 依赖
- **编辑区宽度（调查结论：无需改码）**：grep 证实 `apps/web/src` 不存在编辑容器人为 max-width——PostEditPage 为 flex 布局（内容区 `flex:1` + 320px 侧栏）、AboutEditPage 全宽，编辑器已铺满可用宽度；选「无需改动」少改选项，1280/1920 双宽度截图取证
- **预览改写泄漏防护（取证中发现的真缺陷）**：Vditor wysiwyg/ir 的可见 DOM 在 `getValue`/input 回调时被反向序列化为 markdown——B3 的预览层 `img.src` 重写（`/images/...` → `/site-assets/...`）会随之泄漏回保存文本，且 `imageSrc()` 对 `/site-assets` 输入不幂等，反复保存累积多重前缀。修复（均在 `VditorEditor.vue`）：重写打 `data-mz-rewritten` 标记保证幂等 + `srcReverse` 逆映射 + `update:modelValue`/watch 比较/`getValue` 三出口统一 `restoreValue` 还原；取证断言保存文本无 `/site-assets`、原图路径保真、预览层仍单前缀 200
- **编辑器加载竞态（取证中发现的真缺陷）**：构造期 `setValue` 依赖 Vditor 内部件（`currentMode`/`wysiwyg`/`lute`）就绪，`after` 回调前调用被静默吞掉 → 编辑器空白。修复：`after` 回调内再同步一次 `setValue`
- **纪律**：后端零改动；TipTap 未触碰；B3 走查项 3（保存往返字节一致）/ 5（站内图通道）复跑通过
- **验收**：三连全绿（test 250/250、build 含 web、lint 0/0）；截图取证：编辑器明暗一对、三模式暗色可读、1280/1920 宽度一对、相册上传 Network 鉴识（POST URL 为 albums 路径）；保存往返字节断言——未编辑 `strictEqual`（52B）与编辑后（API 编辑→UI 重载→UI 保存，含泄漏/竞态两缺陷回归）双双通过

## Phase2-B3.5 — Vditor 静态资源自托管（人工裁决补丁）

- **自托管 CDN**：`node_modules/vditor/dist` 全量拷贝至 `apps/web/public/vditor/3.11.3/dist/`（**必须保留 `dist/` 层级**——Vditor 源码对运行时资源统一拼 `cdn + "/dist/..."`）；`VditorEditor.vue` 构造选项增加 `cdn: '/vditor/3.11.3'` + `lang: 'zh_CN'`，移除对外网 CDN 的任何隐式依赖
- **升级漂移防护**：`VditorEditor.vue` 顶部 `VDITOR_VERSION` 常量 + 注释链（升级时同步 public 目录、常量、ADR-001 条目三处）；ADR-001 vditor 条目补记自托管维护义务
- **`.gitignore` 负向例外**：根 `.gitignore` 的 `dist/` 规则会吞掉自托管资源，追加 `!apps/web/public/vditor/*/dist/`（版本段通配，升级免改）
- **dev/prod 双形态**：dev 由 vite 直接服务 `public/`；生产由 `setupStaticPanel` 托管 dist（vite build 自动拷贝 public/），零后端改动
- **验收**：三连全绿（test 250/250、build 含 web、lint 0/0）；断网状态下三模式可用、中文 i18n 加载、代码高亮正常、零外网请求

## Phase2-B3 — Vditor Markdown 编辑器与引擎切换（R2-11）

- **Vditor 编辑器封装**：新建 `src/lib/editors/VditorEditor.vue`（`modelValue` + 300ms 防抖 `update:modelValue`；`wysiwyg`/`ir`/`sv` 三模式由父级 `mode` 传入；Vditor 初始化后无法切换模式，mode 变化时销毁重建且内容经 `modelValue` 保持；`cache.enable=false`；默认 20 项 toolbar，不含脑图/甘特/图表等）。CSS 显式 `import 'vditor/dist/index.css'`，`vite.config.ts` 已加 `optimizeDeps.include: ['vditor']`
- **暗色复用同一信号源**：Vditor 主题切换接入 `lib/theme.ts` 的 `resolvedTheme` 三态广播（`classic`↔`dark`），与 CodeMirror 同一信号源，无独立 MutationObserver/监听
- **站内图片预览层重写**：VditorEditor 内对容器内 `<img>` 用 `MutationObserver` 监听子树变化，经 `imageSrc()` 把 `/images/...`、`public/images/...` 重写为 `/site-assets/...`；modelValue 存储文本不被改写，保证保存往返字节级一致
- **引擎切换**：`PostEditPage.vue`/`AboutEditPage.vue` 右上角增加引擎选择器（默认 Vditor，持久化 `localStorage['mizuki.editor.engine']`）；切换前调用当前编辑器 `getValue()` 把最新内容刷入 `content`，再切换组件，防止丢字符；保存仍走既有提交链路
- **依赖（ADR-001 追加）**：`vditor ^3.11.3`（apps/web）。零后端改动；未触碰 TipTap、RichArticle、后端
- **验收（§6）**：根三连全绿（test 250/250、build 含 web、lint 0/0）。无新增 e2e（纯前端交互），B1.5 用例数基线不变

## Phase2-B1.5 — 暗色适配修补 + /site-assets 站点资产通道（第三次规格补白，ADR-012）

- **`/site-assets` 通道（ADR-012，人工裁决）**：`src/main.ts` 新增 `setupSiteAssets`——认证托管 Mizuki `public/`（`express.static`，`index:false`/`fallthrough:false`/`dotfiles:'ignore'`）；守卫链「配置活取值（init 后免重启，一次性 warn latch）→ JWT 认证（Bearer 头优先 + `mizuki_asset_token` cookie 兜底，无 query token）→ 逐段 decode + 走私拒绝 → 图片扩展名白名单（jpg/jpeg/png/webp/gif/svg/avif）→ `safeRealJoin` 路径监狱 → statSync 常规文件复查」；mizukiRoot 未配置或 public 缺失时该前缀整体 404，不影响其他路由；bootstrap 挂载顺序 Swagger → SiteAssets → StaticPanel，SPA 回退谓词排除 `/site-assets`
- **前端统一换源**：新建 `src/lib/image-src.ts`（`imageSrc()` 一处封装：外链原样 / `public/` 前缀剥离 / 段级编码拼 `/site-assets/`）；媒体库缩略图+灯箱（新增预览列，P10d 疑问 1 收口）、相册网格+灯箱换源；`stores/auth.ts` `syncAssetCookie()` 四时机同步通道 cookie（`Path=/site-assets; SameSite=Lax`，非 HttpOnly 无新增暴露面）；TipTap 插图对话框维持用户输入原文（外链语义不经通道）
- **B1 临时方案回收**：`vite.config.ts` 删除 dev-only `publicDir` 指向 Mizuki `public/` 逻辑，改 dev 代理 `/site-assets` → 20154（dev/prod 同一套通道语义）
- **编辑器暗色完整适配（§3.1 追加规格）**：CodeMirror 6 引 `@codemirror/theme-one-dark`（oneDark 全量接管暗态 chrome），Compartment 双仓随 `resolvedTheme` 三态广播即时重配（明暗切换不刷新、卸载断开 observer）；全部手写 hex/rgb 清扫改 CSS 变量——CodeMirrorEditor（边框/焦点/亮色规则 `html:not(.dark)` 作用域）、TipTapEditor（工具栏/表格边框/代码块复用 `--mizuki-terminal-*`/引用块/正文底色文字色/行内 code）、PostEditPage/AboutEditPage/RichArticleEditPage（三页 hex 回退清除）
- **依赖（ADR-001 追加）**：`express ^5.2.1`（server，传递依赖显式化，非新能力）/ `@codemirror/theme-one-dark ^6.1.3`（web）
- **e2e 新增**：`test/p12-site-assets.e2e-spec.ts` 10 用例——header/cookie 双通道 200 字节相等、无凭据 401、伪造 401、穿越三变体 404、白名单外 404、尾部斜杠 404、未配置时整体 404 不影响 health、上传→通道渲染往返
- **验收（§6）**：根三连全绿（test 250/250 = B1 尾数 240 + 新增 10、build 含 web、lint 0/0）；puppeteer 截图 11 张目检通过（md/富文本/about 明暗 6 + 明↔暗切换中间帧无闪烁 1 + 相册明暗 2 + 媒体库明暗 2，缩略图/网格均经通道渲染）；grep 断言 `apps/web/src` 无裸 `/images/uploads`、`/images/albums` 拼接残留（仅注释与 imageSrc 入参形态）；API 冻结证据——控制器路由装饰器 before(70e44f1)/after diff 为空 + docs-json 52 端点清单落盘 `.test-tmp/b15-shot/api-freeze/`

## Phase2-B1 — 视觉主题与交互打磨（纯前端：主题系统/向导修复/菜单过滤/裁切/灯箱/日期选择器/字段提示）

- **R2-1 主题系统**：新建 `src/styles/theme.css`——Mizuki 品牌调色板（primary 粉系）+ 明/暗两套 `--el-color-primary` 全梯度覆盖 + 终端/页面/卡片 CSS 变量集中处；Element Plus 暗色经官方 `theme-chalk/dark/css-vars.css` + `html.dark` class；新建 `src/lib/theme.ts` 三态循环（浅色→深色→跟随 system，`localStorage` 键 `mizuki.theme`，auto 态挂 matchMedia 监听）；`index.html` 内联首帧脚本（暗色偏好刷新不闪白）；`main.ts` 统一 import 顺序（dark vars → theme.css）
- **R2-1 控制台皮肤**：`LogTerminal.vue` 重构为 CSS 变量分级（stdout 灰白 / stderr 淡红 / exit 失败高亮；暗色终端底 `#0d1117` 基调非纯黑）；DashboardPage/AlbumsPage/PostEditPage/SettingsPage/ReferenceDetailDialog/ConsolePage/CodeMirrorEditor 硬编码颜色清扫改走变量
- **R2-3/R2-4 向导修复**：`InitWizardView.vue` 步骤条 `el-steps` 窄窗（1280px）不换行（simple 模式 + nowrap CSS）；运行模式三选项卡对齐（label/desc 两行结构 + 选中态粉色高亮）
- **R2-5 菜单过滤**：新建 `src/stores/system.ts`——`ensureSystemMode()` 拉取 `/admin/system/status` 的 mode（失败/缺失 fail-open 显示全部，不阻塞登录）；`isMinimalMode()`（manage 视为最小，含 minimal 字面值）；`MainLayout.vue` 按 `minimalHidden` 过滤菜单；`router/index.ts` 守卫 minimal 下 `/collections/*`、`/articles*` 重定向 `/`（含模式变化后的已登录页重定向 watch）
- **R2-6/R2-9/R2-13 表单增强**：`mapper.ts` 新增 date widget 分支（`ZodDate` 或键名 date/*Date 的 `ZodString` → el-date-picker，`value-format="YYYY-MM-DD"`，必填默认今天）+ `descriptionOf()` 描述提取；optional 字段空值改 `undefined`（zod v4 `.optional()` 拒 null）；`SchemaForm.vue` 渲染日期选择器 + 字段下方灰字说明；新建 `FieldHint.vue`（必填问号 tooltip，内容优先 schema description 否则通用必填提示）；`packages/shared` 四个 schema（friends/diary/projects/devices 图片字段）补 `.describe()` 元数据
- **R2-12 头像裁切**：新建 `CropperUploader.vue`（选择图片 → vue-cropper 对话框实时裁切 → getCropBlob → POST /admin/media 上传 → emit 回填相对路径）；接入 `CollectionListPage.vue` 友链新增/编辑抽屉（「裁切上传头像」按钮，与直传/手动填 URL 并存）
- **R2-8 相册灯箱**：`AlbumDetailPage.vue` 图片网格缩略图（object-fit 容器 + 文件名）+ 点击 v-viewer 命令式灯箱（`api as viewerApi`，缩放/旋转/多图切换/Esc 关闭）+ 60/页分页保留；vite dev-only `publicDir` 指向 Mizuki `public/`（读 `apps/server/data/config.json`，本地图片 `/images/...` 同源可预览；生产 build 不设置，与 ADR-009 面板不托管站点产物边界一致）
- **依赖（ADR-001 Phase2-B1 追加）**：`vue-cropper ^1.1.4`（npm latest 指 Vue2 版，须显式版本）/ `v-viewer ^3.0.23` / `viewerjs ^1.12.0`
- **工程**：根 `eslint.config.mjs` ignores 补 `.test-tmp/**`（P11 起临时验证区，gitignored，内含 CommonJS 工具脚本不入 lint 面）
- **验收（§6）**：根三连全绿（test 240/240、`pnpm -r build` 含 web、lint 0/0）；puppeteer 截图取证 15 张（manage 模式 6：登录/仪表盘明暗/重定向/控制台明暗；additive 模式 9：向导 1280 步骤条/全量菜单/友链表单/tooltip/日记日期默认+弹开/相册网格/灯箱/缩放）——步骤条 scrollHeight 断言不换行、minimal 菜单 8 项 vs additive 15 项、日期默认当天 2026-08-27、灯箱开/Esc 关断言全过；后端零改动（§5 不得触碰 apps/server/** 遵守）

## P11 — 收尾：Swagger 三分组/README/bin 启动脚本/安全复查/面板静态服务（含第二次规格补白）

- **Swagger 三分组（§3.1）**：新增依赖 `@nestjs/swagger` 11.4.7（ADR-001 追加，传递依赖 `@scarf/scarf` 遥测在 pnpm-workspace.yaml `allowBuilds` 显式置 false）；`src/main.ts` 挂载 SwaggerModule 于 `/api/v1/docs`（JSON 规格于 `/api/v1/docs-json`）；CSP 定点放宽——仅 `/api/v1/docs*` 路径允许 `script-src/style-src 'unsafe-inline'`（swagger-ui 官方 HTML 含内联初始化脚本，人工裁决「按需放宽、不整体关闭 helmet」），面板与 API 路径维持 helmet 默认；全部 12 个控制器补 `@ApiTags`（公开/管理/系统三分组：公开 4 / 管理 44 / 系统 5，admin/system/logs 双标 系统+管理）+ 每端点中文 `@ApiOperation` 摘要 + 认证端点 `@ApiBearerAuth` + 上传端点 `@ApiConsumes('multipart/form-data')` binary schema
- **面板静态服务（ADR-009，人工裁决方案 1）**：`src/main.ts` `setupStaticPanel`——默认 dist `apps/web/dist`（`MIZUKI_WEB_DIST` 可覆盖）；无 `index.html` 时跳过全部静态逻辑（开发模式零行为变化，pino 记录原因）；有则 `useStaticAssets` 托管 + SPA 回退（仅「非 /api 前缀 GET」返回 index.html，深链刷新不 404；API 404 JSON 语义不变）；导出 `setupSwagger`/`setupStaticPanel`/`bootstrap` 供 e2e 与 bin 复用
- **bin 启动脚本（§3.3）**：新建 `apps/server/bin/mizuki-server`——解析 `dist/main.js`、端口遵循 `MIZUKI_SERVER_PORT`（默认 20154）、启动横幅（面板/API + Swagger 地址）、产物缺失报错退出码 1；显式调用 `main.js` 导出的 `bootstrap()`；`apps/server/package.json` 补 `bin` 字段
- **README 重写（§3.2）**：双形态快速开始（生产：`pnpm install && pnpm build && node apps/server/bin/mizuki-server` → localhost:20154 面板/API/Swagger；开发：`pnpm dev` + `pnpm --filter @mizuki/web dev` 20155 代理）+ 目录速览 + API 概览（三分组 + 认证/限流说明）+ 文档索引
- **安全复查（§3.4）**：新建 `docs/SECURITY-REVIEW.md`——MASTER-PLAN §7 九条 + REQUIREMENTS §15 十六条逐项「落实（文件:行号）+ 证据（测试名）」全 ✅；补充核查（SSRF 零出站 HTTP / fs.writeFile 域限制含两处已裁决例外 / as any 与 @ts-ignore 零命中）；备注级观察 4 条（argon2 默认成本参数、相册上传平行实现、Swagger DTO 深度、MVP 范围确认），无 ❌/⚠️
- **§6.1 全新链路冒烟实测发现并修复 3 处缺陷**（均补 e2e 回归）：
  1. bin 脚本 `require(dist/main.js)` 下 `require.main === module` 守卫不成立 → 服务不启动；修复：`main.ts` 导出 `bootstrap()`，bin 显式调用（`test/p11-fresh-chain.e2e-spec.ts` 依赖同一导出）
  2. SPA 回退 `res.sendFile(绝对路径)` 在 dist 位于点目录（如 `.test-tmp`）内时被 send 点目录检查拦截 404→500；修复：改 `res.sendFile('index.html', { root: webDist })` 相对形式（`test/p11-static-panel.e2e-spec.ts` 新增点目录 2 用例）
  3. `BACKUP_OPTIONS` 为启动时快照，init 后不重启进程则 collections/posts/albums 全 400「项目根目录未配置」，违反「登录→面板可用」验收；修复：`infra/backup/backup.module.ts` mizukiRoot 改 getter 活取值（backupDir/dbPath 不随 init 变化仍静态）；新建 `test/p11-fresh-chain.e2e-spec.ts` 5 用例（不覆写 BACKUP_OPTIONS，走真实工厂，固化 init→登录→collections 无重启可用）
- **e2e 新增**：`test/p11-static-panel.e2e-spec.ts`（12 用例：有 dist 5 + 点目录 2 + 无 dist 2 + Swagger 3）+ `test/p11-fresh-chain.e2e-spec.ts`（5 用例）
- **验收（§6）**：根三连全绿（test 240/240、build 含 web、lint 0/0）；§6.1 全新环境链路实测（D 盘同盘 store）：`pnpm install` 30s（673 包）→ `pnpm build` 0 → `node apps/server/bin/mizuki-server` → health 200 → init 201（二次 409）→ login 200 双 Token → collections/diary 200（fixture 数据，无重启）→ GET / 200 含 div#app → /login 200 → /api/v1/public/nonexist 404 JSON；§6.2 Swagger 三分组抽查 6 端点全过（docs 200 + CSP 放宽仅限 docs 路径）；§6.4 `@types/tree-kill` 全仓零残留；ADR-009 记录第二次规格补白（人工裁决）

## P10d — 管理面板剩余模块：媒体库/相册/备份/控制台/仪表盘/设置

- `src/api/{media,albums,backups,process,dashboard,settings}.ts`（新建 6 个）：端点客户端，封装对应后端 REST，复用 http.ts 的 401 自动 refresh；`process.ts` 含 SSE 日志 fetch+ReadableStream 消费（EventSource 无法带 token，P9 踩坑）；`dashboard.ts` 聚合多端点（status/posts/collections/albums/backups/logs），单端点失败降级不阻塞整体展示
- `src/components/{ImageUploader,ReferenceDetailDialog,LogTerminal}.vue`（新建 3 个）：ImageUploader（选图→POST /admin/media→emit uploaded，六类内容与媒体库复用）；ReferenceDetailDialog（409 引用明细展示 refType+targetLabel，纯文本禁 v-html）；LogTerminal（SSE 日志终端，fetch 流消费，stderr 标红，纯文本渲染禁 v-html，组件卸载退订，exit 事件 emit finished 通知父刷新）
- `src/views/media/MediaLibraryPage.vue`（新建）：媒体表格（原名/尺寸/大小/路径）+ 上传 + 删除（409 引用明细 ReferenceDetailDialog）+ 复制路径到剪贴板；缩略图暂不实现（后端无 Mizuki public/ 静态文件服务，记报告）
- `src/views/albums/{AlbumsPage,AlbumDetailPage}.vue`（新建 2 个）：相册卡片列表 + 创建对话框（info.json 全字段）+ 详情（图片网格 + 上传 + 删图二次确认 + 编辑 info 对话框）
- `src/views/backups/BackupsPage.vue`（新建）：备份列表 + 创建（scope 选择 full/data/content/db + 备注）+ 恢复（二次确认，明确提示"将覆盖当前内容" + 说明覆盖前自动快照）+ 删除（二次确认）
- `src/views/process/ConsolePage.vue`（新建）：四任务按钮（install/dev/build/preview）→ POST /admin/process/tasks + SSE 日志终端 LogTerminal + 停止 DELETE + 任务状态徽标（running/exited/killed）+ 端口检测 GET /admin/process/ports/:port
- `src/views/DashboardPage.vue`（新建，替换 P10a DashboardPlaceholder）：统计卡片（服务状态/文章数/草稿数/日记数/友链数/相册数/备份状态/版本/运行时长）+ 最近操作日志（对接 P6 GET /admin/system/logs）；进入拉取 + 手动刷新（不实现 SSE 实时刷新，ADR-008）
- `src/views/settings/SettingsPage.vue`（新建）：对接 P8 settings REST（GET/PUT/DELETE），按值类型渲染控件（布尔→开关、数字→文本输入、字符串→文本框、复杂对象→JSON 文本编辑 + 前端 JSON.parse 校验），按 key 前缀分组（site/theme/nav/social/feature/service/其他），支持新增 key；注明边界（仅 site_setting，config.json 不在此改，Mizuki config 接管属二期）
- `src/router/index.ts`（重写）：接入 /media、/albums、/albums/:id、/backups、/console、/settings、/（仪表盘替换占位），placeholderRoutes 全部清空，菜单指向真实页面；DashboardPlaceholder 与 PlaceholderView 不再引用
- `src/views/collections/CollectionListPage.vue`（修改）：抽屉加 ImageUploader 快速上传区，上传后回填 formValue 图片字段（diary.images 追加、projects/devices.image 设置，无图片字段提示复制路径），不改 SchemaForm 既有交互（文本输入仍在，上传为辅助入口，§2"不改既有交互语义"）
- `src/components/LogTerminal.vue` 加 `finished` 事件（exit 事件后 emit，ConsolePage 据以刷新任务终态）
- ADR-008（新建）：不实现 GET /admin/events SSE 事件转发——§3.5 标注实时刷新可选；EventSource 无法带头需 fetch 流或 query token 方案；后端例外最小化（P10d 主体为前端）；仪表盘进入拉取+手动刷新满足 MVP 实时性
- 零新增依赖（fetch/ReadableStream/clipboard 浏览器原生 + Element Plus + 既有栈）；后端零改动（不实现 GET /admin/events，§2 后端例外最小化）
- 验收：根三连全绿（test 223/223、`pnpm -r build` 含前端 vue-tsc strict + vite build、`pnpm lint` 0/0）；手动交互项（媒体/相册/备份/控制台/仪表盘/设置/端到端场景）列人工补验清单（SESSIONS）

## P10c — 管理面板文章模块：Markdown 编辑、富文本编辑与 about 页

- `src/views/posts/PostListPage.vue`（新建）：Markdown 文章列表——三 tab 视图（全部 / 草稿箱 / 回收站）：草稿箱按 `status==='draft'` 前端筛选（与后端 status 口径一致）；回收站为**前端 localStorage 跟踪**（后端无 list-deleted 端点）——删除时记录 `{slug, backupIds}`，恢复 = 逐备份 `POST /admin/backups/:id/restore {confirm:true}` → `POST /admin/posts/sync` 重建索引（取舍记报告）；操作：新建 / 编辑 / 删除（二次确认）/ 置顶切换（PATCH frontmatter.pinned）
- `src/views/posts/PostEditPage.vue`（新建）：Markdown 编辑页——CodeMirror 6 正文编辑（语法高亮 + 行号 + 等宽字体）；侧栏 frontmatter 表单（§6.10 全部 12 个已知字段）；**往返保真**：编辑时持有读取的完整 frontmatter，提交 `{...fullFm, ...formFm}` 合并，未知键原样保留并在侧栏展示「额外字段」区块；封面上传（`POST /admin/posts/:slug/cover`，先保存后上传）；「上传 Markdown 文件」入口（读文本填入编辑器）；新建时输入 slug（目录名）→ `POST /admin/posts` → 跳编辑态
- `src/views/posts/AboutEditPage.vue`（新建）：about 页编辑器——CodeMirror 复用，编辑 `src/content/spec/about.md`；`PUT /admin/about` 保存（后端 pre_write 自动备份），保存后展示「已自动备份」提示；「上传替换」入口读本地 .md 文本后走同一保存链路（§6.11）
- `src/views/articles/RichArticleListPage.vue`、`RichArticleEditPage.vue`（新建）：富文本列表（新建 / 编辑 / 删除二次确认；软删不可从面板恢复，提示用户）与 TipTap 编辑页——`editor.getJSON()` → `doc_json` → `POST/PATCH /admin/articles`（服务端生成 html_cache）；元数据表单（title / slug / status / pubDate / pinned / summary / cover / categoryId）；**导出 HTML** 用服务端 `html_cache`（编辑态未保存时先触发保存）；**导出 Markdown 降级**为「HTML 包入代码块」（不引入重型转换器，取舍记报告）
- `src/lib/editors/CodeMirrorEditor.vue`（新建）：CodeMirror 6 封装——v-model 双向绑定（单向数据流：输入时 emit、外部值变化时 dispatch 重建，`applyingExternal` 标记防回环）；`@codemirror/{state,view,commands,language}` 子包直接导入（元包不导出基础构件，见 ADR-001 修订）
- `src/lib/editors/TipTapEditor.vue`（新建）：TipTap 3 封装——工具栏（H1-3 / 粗斜删除 / 有序无序列表 / 引用 / 代码块 / 链接 / 图片 / 表格 / 撤销重做）；图片与链接经 URL 提示框插入（媒体库打通留 P10d）；v-model（JSON）；**前端不执行后端返回的 HTML**（v-html 零使用，预览仅 TipTap 自身渲染）
- `src/api/posts.ts`（新建）：posts 端点客户端（list / read / create / update / remove / uploadCover / sync / readAbout / writeAbout）+ `recycleStore`（localStorage 回收站）+ `restorePost` 恢复链
- `src/api/articles.ts`（新建）：articles 端点客户端（list / read / create / update / remove）+ `extractArticleIssues`（后端 400 `detail.issues` → 字段错误映射）
- `src/api/http.ts`：追加 FormData 支持（multipart 上传封面不设 Content-Type，让浏览器带 boundary）
- 路由与菜单：`/posts`、`/posts/new`、`/posts/:slug/edit`、`/about`、`/articles`、`/articles/new`、`/articles/:id/edit` 七条路由接入主布局；菜单「文章」拆分为「Markdown 文章」「富文本文章」两项并新增「关于页」菜单项（§4.2 授权接线）
- 依赖（已记 ADR-001 P10c 修订）：`@codemirror/state` 6.7.1 / `@codemirror/view` 6.43.9 / `@codemirror/commands` 6.11.0 / `@codemirror/language` 6.12.4 / `@codemirror/lang-markdown` 6.5.2；`@tiptap/vue-3`、`@tiptap/starter-kit`、`@tiptap/extension-{link,image,table,table-row,table-header,table-cell}` 均 3.30.3；**移除 `codemirror` 元包**（仅导出 basicSetup/minimalSetup，代码零引用）；`vite.config.ts` optimizeDeps 同步更新
- 验收：根三连全绿（test 223/223、`pnpm -r build` 三项目、lint 0/0）；`pnpm --filter @mizuki/web build`（vue-tsc strict + vite build）通过；手动交互项（Markdown 往返 / 草稿箱 / 回收站恢复 / 置顶封面 / 富文本往返 / 导出）列人工补验清单（SESSIONS）

## P10b — 六类集合管理页（zod schema 驱动表单）

- `src/lib/schema-form/`（新建，核心）：`mapper.ts` 自写 zod→表单描述符映射器（ADR-007）——遍历 `ZodObject.shape`，按 `constructor.name` 分派到 string/boolean/number/array/object/enum/optional 八类分支，产出 `FieldDescriptor[]`（含 widget/required/options/children）；`SchemaForm.vue` 按描述符渲染 Element Plus 控件，提交前用**同一份 schema** 在浏览器端 `safeParse` 一次（错误按 `issue.path` 逐字段提示）；后端 400 的 `detail.issues` 同样按 path 映射到字段
- 映射规则：`ZodString` 长文本字段（content/description 白名单）→ textarea、URL 字段（含 url/site）→ 带占位提示、`ZodBoolean`→switch、`ZodNumber`→input-number、`ZodArray<ZodString>`→标签输入（回车追加/删尾）、`ZodEnum`→select、嵌套 `ZodObject`（skills.experience）→子字段组、`ZodOptional`→解包+非必填
- `src/views/collections/CollectionListPage.vue`（新建）：单组件按路由 `:type` 复用六类——array 形表格展示+新增/编辑/删除；grouped 形（devices）先选分组再展示、新增带 group、删除后重新拉取（空分组由后端清理）；表格列由 schema 顶层字段推导；长文本/数组截断展示
- `src/api/collections.ts`（新建）：collections 端点客户端——list/create/update/remove 四方法 + `isGrouped` 类型守卫 + `extractFieldIssues`（后端 `detail.issues`→字段错误映射）；复用 `src/api/http.ts` 的 401 自动 refresh
- 路由：`/collections/:type` 单动态路由接入主布局（替换 P10a 占位），`:type` 非法时 404 占位；`MainLayout.vue` 菜单六类指向真实路由
- 跨包：`packages/shared/package.json` 追加 `typescript` devDep（构建产物 tsc 需要）；`apps/web/package.json` 追加 `@mizuki/shared` workspace + `zod` 依赖；`apps/web/vite.config.ts` 加 `resolve.alias`（@mizuki/shared→src/index.ts，避开 CJS 产物 `__exportStar` 的 rollup 静态分析缺口）+ `optimizeDeps.include:['zod']`
- 渲染策略 ADR-007：自写映射器，不引入 `zod-to-json-schema`（字段类型面 ≤8 分支，零新依赖，zod v4 直连内省 API）
- 验收：根三连全绿（test 223/223、`pnpm -r build` 三项目、lint 0/0）；`pnpm --filter @mizuki/web build`（vue-tsc strict + vite build）通过；手动交互项（六类 CRUD/浏览器端 schema 校验/grouped 空分组清理/409 明细）列人工补验清单（SESSIONS）

## P10a — 管理面板外壳：工程、登录、向导、布局与请求层

- `apps/web` 完整 Vite + Vue 3 + TS(strict) 工程落地：`index.html`、`vite.config.ts`（dev 端口 20155，`/api` 代理 → `http://localhost:20154`）、`tsconfig.json`（strict + noUncheckedIndexedAccess，独立于根 base 的 CJS 配置）、`src/{main.ts, App.vue, env.d.ts}`
- `src/router/index.ts`：路由表 + 守卫——白名单 `/login`、`/init`（meta.public）；无 accessToken 一律回 `/login`（携带 redirect）；已登录访问 `/login` 重定向主页；主布局子路由 13 项（仪表盘 + 12 占位，P10b/c/d 替换）
- `src/views/`：`LoginView.vue`（表单 → login → 存 token → `me` → 主布局；401/423/429 分别提示；挂载时经 `GET /system/health` 的 `initialized` 判断未初始化并引导向导——P6 §3.2 定口径）、`InitWizardView.vue`（四步：欢迎 → 目录 + `detect` 逐项明细展示 + 包管理器探测 → 三模式说明选择 → 账号（含确认密码）→ `init`；409 → 提示并跳登录）、`DashboardPlaceholder.vue`、`PlaceholderView.vue`（单组件复用，标题取自路由 meta）
- `src/layouts/MainLayout.vue`：顶栏（项目名 + 管理员 + 登出）+ 侧边栏（仪表盘/文章/日记/友链/项目/时间线/技能/设备/相册/媒体库/备份/构建预览/设置 全 13 项，el-menu router 模式）+ 内容区
- `src/api/`：`http.ts` 统一请求层（**401 自动 refresh 并重放一次；并发 401 共享同一 refresh Promise 去重**；刷新失败清 token + 会话失效回调；适配 `{code,message,detail}` 异常格式抛 `ApiError`）、`auth.ts`、`system.ts`（路径常量集中，组件零裸 URL）
- `src/stores/auth.ts`：reactive store + localStorage 持久化（`mizuki.accessToken` / `mizuki.refreshToken`）；refreshToken 仅用于 refresh 调用（纪律）
- 依赖（已记 ADR-001）：vue 3.5.41 / vue-router 4.6.4 / element-plus 2.14.5（**完整引入**，取舍记报告）/ vite 7.3.6 / @vitejs/plugin-vue 6.0.8 / vue-tsc 3.3.11 / typescript 5.9.3；**未引入 axios/pinia**（fetch 封装 + reactive store，取舍记报告）
- 根 `eslint.config.mjs`：ignores 追加 `apps/web/**`（§4.2「显式排除」选项，不新增 lint 依赖）；`apps/web/README.md` 更新
- 验收：根三连全绿（test 223/223、`pnpm -r build` 三项目、lint 0/0）；`pnpm --filter @mizuki/web build` 成功（`dist/` 产物）；集成冒烟：后端 dist 全路由注册 + 前端产物经 `vite preview` 可服务；手动交互项（登录/守卫/401 刷新/向导走查）列人工补验清单（SESSIONS）

## P9 — 进程管理：白名单子进程与 SSE 日志

- `process/{process.module, process.controller, process-manager.service}.ts`：三 stub 转正——任务白名单硬编码 `install/dev/build/preview`（zod enum，注入串/未知任务 → 400）；参数映射逐字固定（`install`：yarn 无参、其余 `<PM> install`；`dev/build/preview`：`<PM> run <task>`），不接受用户附加参数；包管理器按工作目录 lockfile 探测（pnpm > yarn > npm，均无默认）
- spawn 安全规格（MASTER-PLAN §7 逐字）：cross-spawn `shell:false`；env 仅透传 `PATH/HOME/APPDATA`（`childEnv` 白名单）；POSIX `detached:true` 进程组（Windows 按平台行为，取舍记报告）；工作目录锁定 `mizukiRoot`（safeJoin）；停止统一 `tree-kill(pid)` 整组
- 日志：内存环形缓冲 2000 行（超丢最旧），stdout/stderr 合并按行切分（`[stderr] `/`[error] ` 标源，半残片保留）；`GET /admin/process/tasks/:id/logs`（@Sse）先回放缓冲再实时推送，终态发 `exit` 事件后 `complete`，连接断开清理订阅
- 生命周期：内存任务表（status running/exited/killed、pid、exitCode、startedAt/finishedAt）；`POST /admin/process/tasks`（201 返回 id/pid）；`GET tasks/:id`；`DELETE tasks/:id`（tree-kill → killed）；`GET ports/:port`（`net.createServer().listen` 探测法，取舍记报告）
- 优雅停机：`ProcessManagerService implements OnApplicationShutdown`——停全部 running → 等 5s → 超时 SIGKILL 强杀 → 关闭全部 SSE 观察者 → pino 停机摘要（停止数/强杀数）；停机后拒绝新任务；`main.ts` 追加 `app.enableShutdownHooks()`（§2 授权的唯一既有文件改动）
- 事件：`process.finished`（自然/异常/被 kill 均发射；被杀无实际退出码时记 `-1`，约定记报告），`ProcessFinishedPayload.parse` 后恰好一次
- 夹具：`test/fixtures/mini-project/`（§2 授权的最小子项目：零依赖，`dev/preview` 长驻心跳、`build` 同步写 2500 行后自然退出；不复用假 Mizuki 执行真实构建）
- 测试新增 2 文件 14 用例：安全单测 6（shell:false / env 白名单泄漏断言 / 白名单恰四项 / 注入拒绝 / 参数映射 / 探测优先级）+ e2e 8（含 4 条 slow：启停+SSE、优雅停机、白名单四项、事件断言）。全仓 223/223 绿

## P8 — 富文本文章、混合公开 API（路径定型）与 settings（关卡：公开 API 定型）

- `articles/{articles.module, articles.controller, articles.service}.ts`：三 stub 转正——富文本 CRUD（`POST/PATCH` 收 `docJson`：对象含 `type` 即合法，深层按信任源不过度约束，取舍记报告；服务端经转义渲染器 + sanitize 生成 `html_cache`；slug 显式指定冲突 409 / 未指定由 title 生成自动避碰；`status` 双态；DELETE 软删）；发布出口发射 `article.published`（`sourceType:'richtext'`，payload 先 parse）；`@OnEvent(post.changed)` 订阅者：删除→软删行，否则按 `file_hash` 幂等 upsert（哈希一致且未软删 → 零写入）；`@OnEvent(article.published)` → 公开列表首页缓存置空失效；公开列表（`status='published'` 且未软删，`pub_date` 降序 + `created_at` 次序，两源交错）；公开详情（markdown 读源文件 → marked + sanitize 渲染 + frontmatter；richtext 返回 `html_cache`）
- `articles.controller.ts` 双控制器：`ArticlesController`（admin）+ `PublicArticlesController`（@Public，`/public/articles` 与 `/public/articles/:slug`）；分页 `?page=&limit=`（默认 1/10，limit>50 → 400）
- `settings/{settings.module, settings.controller, settings.service}.ts`：三 stub 转正——`site_setting` key-value（GET 全量 / PUT `:key` upsert JSON 序列化 / DELETE，缺键 404；key 安全字符集校验）；写入成功发射 `content.changed`（scope='settings'，filePaths=[]）；**路径为规格补白**（MASTER-PLAN §5 未列，见交付报告疑问清单）
- `common/render/`（新建）：渲染统一安全出口——`renderMarkdownToSafeHtml`（marked → sanitize-html）、`renderTipTapDoc`（最小 TipTap JSON → HTML 渲染器：文本/属性值全转义、未知节点仅渲染子节点、marks 支持 bold/italic/code/strike/link）、`sanitizeHtmlFragment`；白名单 = 排版标签集 + `a/img` 受限属性 + scheme 仅 `http/https/mailto/tel`，`script`/`on*`/`javascript:` 全部剥离；附 `sanitize-html.d.ts` 最小环境声明（@types 不在依赖清单且禁新增）
- `articles/media-reference.ts`（新建）：第四个媒体引用贡献者（`article.cover` 非空未软删行 → `article-cover`），`ArticlesModule.onModuleInit` 注册——P7 注册表四方就位
- `collections/public-collections.controller.ts`（新建）：`GET /public/collections/:type`（@Public；`:type` 白名单同 P4 未知 400；`public: false` → 404；读取经 DataFileService value-cache）；`albums/public-albums.controller.ts`（新建）：`GET /public/albums`（@Public；元信息 + 图片文件名列表）；两模块 `controllers` 数组追加（§2 授权）
- **公开路径自此冻结**（MASTER-PLAN §9 守则 8）：`/public/articles`、`/public/articles/:slug`、`/public/collections/:type`、`/public/albums`；评论端点二期不实现（表已建，P0b）
- 测试新增 2 文件 22 用例：render 单测 8（双渲染路径 × 三类注入 + 结构输出 + iframe 剥离）+ e2e 14。全仓 209/209 绿

## P7 — 媒体上传管线、相册与引用检查注册表

- `media/{media.module, media.controller, media.service}.ts`：三 stub 转正——上传五件套顺序执行：① 扩展名白名单（`jpg/jpeg/png/webp/gif`）→ ② 魔数嗅探与扩展名比对（不符即拒）→ ③ 配置上限（默认 10MB，413）→ ④ 随机文件名 `<nanoid>.<ext>` 写 `public/images/uploads/`（safeJoin + 自动建目录）→ ⑤ sharp 按原格式重编码（`.rotate()` 应用 EXIF 方向后剥离全部元数据）并读宽高的确；`media_file` 索引入库（path/original_name/mime/size/width/height/sha256）；列表倒序；`DELETE /admin/media/:id`：注册表 `collectAll()` 聚合引用 → 命中 → **409 + `detail.references[{refType,targetLabel}]`**；无引用 → `preWriteBackup` → 删文件与行；成功出口发射 `media.changed`
- `albums/{albums.module, albums.controller, albums.service}.ts`：三 stub 转正——目录 `public/images/albums/<名>/` + `info.json`（REQUIREMENTS §6.9 字段逐字，zod 校验）；创建（重名 409）/ 修改（增量合并整体校验 + pre_write 备份）/ 删除（引用前缀检查 → 逐文件备份 → 删目录）；图片上传复用五件套校验 + **非 JPG 自动转 JPG**（文件名保持 `<原名>.jpg` 语义，同名冲突追加 `-${nanoid(6)}` 并记日志）；图片删除（引用检查后备份删除）；相册元数据写入发射 `content.changed`（scope='album'），图片保存/删除发射 `media.changed`
- `packages/shared/src/media-reference.ts`（新建）：`MediaReference` / `MediaReferenceContributor` 纯类型（P7 §3.4 签名逐字，字段名不可改）；`index.ts` 追加导出
- `common/registry/media-reference.registry.ts`（新建）：注册表宿主 + `@Global MediaReferenceRegistryModule`——`register`（重名拒绝告警）/ `names()` / `collectAll()`（单贡献者失败记日志不冒泡）；`app.module.ts` 注册
- 注册方检查器（新建）：`posts/media-reference.ts`（frontmatter `image` → `post-cover`；无前缀 `/` 的值按相对文章目录归一）、`collections/media-reference.ts`（diary `images[]`/projects `image`/devices grouped `image`，按注册表 `imageDir` 归一，DataFileService 只读）；`posts.module.ts` / `collections.module.ts` 以 `onModuleInit` 注册；`AlbumsService` 自身实现贡献者（info 无封面字段 → 空集占位，取舍记报告）。**articles 注册留 P8**
- `common/security/magic-sniff.ts`（新建）：最小魔数嗅探器纯函数（JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF…WEBP` / GIF `GIF87a|GIF89a`）+ 扩展名映射表——**人工定案不引入 `file-type`**（v16 停维、v17+ ESM-only 与 CJS 不兼容），已记 **ADR-006**
- 分层决策：上传文件结构接口 `UploadedFileLike` 在 media/albums 各自局部声明（与 posts 同构），避免 L2 互 import（boundaries error 拦截过一次，见交付报告）
- 测试新增 2 文件 20 用例：magic-sniff 单测 6（四格式 + 非图片 + 映射表）+ e2e 14（伪造拒绝、合法入库、413、EXIF 剥离、引用 409 + 明细、无引用删除、四模块注册 + 第 4 插槽、相册 CRUD + 转 JPG、路径防护、事件、边界）。全仓 187/187 绿

## P6 — 认证与初始化（关卡：安全边界定型）

- `auth/{auth.module, auth.controller, auth.service}.ts`：三 stub 转正——登录（argon2id 校验、用户不存在时哑元哈希恒定时间行为、失败计数 5 次 → `locked_until` 锁 15 分钟并清零计数、锁定期正确密码也拒 423）、jose HS256 双 Token（access 15m / refresh 7d；claims：sub/username/type/jti/iat/exp；`setExpirationTime` 相对时间串——jose v6 无 setExpirationIn）、`POST /admin/auth/refresh` 轮换签发新对（校验 type='refresh' + 用户仍存在）、无状态 `logout`、`GET /admin/auth/me`；JWT secret 三级解析（env `MIZUKI_JWT_SECRET` → config.jwtSecret → 兜底生成持久化，见 **ADR-005**）；`initialize`：已初始化 409 先行 → detector 四项检测（失败 400 附 checks 明细）→ argon2id 建管理员 → config.json 合并原子写（mizukiRoot/mode/jwtSecret）→ 刷新配置单例。登录路由级 `@Throttle` 5 次/分（独立于 P1 全局 60 次/分）
- `common/guards/jwt-auth.guard.ts`：全局守卫转正——经 `APP_GUARD` 注册（顺序在 ThrottlerGuard 之后：限流先于认证）；`@Public()` 豁免（`IS_PUBLIC_KEY` 元数据）；Bearer 提取 + `verifyAccessToken`（签名/时效/类型/用户存在四重校验）；拒绝日志不输出 token 内容。**跨层解耦**：守卫（L0）不 import auth 模块（L3），经 `ACCESS_TOKEN_VERIFIER` Symbol token 注入 `AccessTokenVerifier` 接口，AuthModule 以 `useExisting: AuthService` 提供（boundaries 合规）
- `common/decorators/public.decorator.ts`：`SetMetadata` 实现转正；豁免清单逐字：`/system/health`、`/admin/auth/login`、`/admin/auth/refresh`、`/system/detect`、`/system/init`（+ `/public/**` P8 落地）
- `common/interceptors/operation-log.interceptor.ts`：转正——`APP_INTERCEPTOR` 全局（DI 注入 drizzle；与 §4.3 `useGlobalInterceptors` 等效的取舍见交付报告）；审计 `/api/v1/admin/**` 的 POST/PATCH/DELETE；detail = body 递归脱敏（键名含 password/token/secret/authorization/credential → `***`）+ authorization 头掩码；异步写失败仅记 pino 不影响响应
- `modules/system/mizuki-detector.service.ts`：转正——MASTER-PLAN §4.3 四项检测（package.json 含 astro / astro.config.{mjs,ts,js} / src/data 含 diary|friends / src/content/posts）+ 包管理器 lockfile 探测（无 lockfile 默认 npm 并在 checks 注明）
- `modules/system/system.controller.ts`：扩展——`GET /system/health` 标 `@Public()` 且响应追加 `initialized`（admin_user 有无行）；`GET /system/status`（需认证：initialized/mode/version/uptime）；`POST /system/detect`（@Public）；`POST /system/init`（@Public，一次性）；**`GET /admin/system/logs`（规格补白：operation_log `?page=&limit=` created_at 倒序，MASTER-PLAN §5 未列，处理同 P8 settings 补白，见交付报告疑问清单）**；控制器改 `@Controller()` 显式全路径以容纳双前缀路由
- `modules/system/system.module.ts`：提供并导出 `MizukiDetectorService`；与 AuthModule 互为依赖（detector ← init 端点）双侧 `forwardRef` 破环（L3 互导合法）
- `app.module.ts`：providers 追加 `{APP_GUARD: JwtAuthGuard}`（ThrottlerGuard 之后）与 `{APP_INTERCEPTOR: OperationLogInterceptor}`
- `config/app-config.ts`：`AppConfigSchema` 追加可选 `jwtSecret`；`defaultConfigPath()` 支持 `MIZUKI_CONFIG_PATH` 覆盖（测试钩子，同 `MIZUKI_DB_PATH` 模式，见 ADR-005）
- 测试：新增 2 文件 24 用例（p6 e2e 17 + detector 单测 7）+ `test/helpers/admin-auth.ts`（initAndLogin + withAuth 代理）；既有 e2e 守卫适配（交付报告 §6.11）：p2/p4/p5 经 init+login 取 token 全请求附加、p1 测试控制器 `@Public()`、p2 补齐检测结构。全仓 167/167 绿
- 新增 ADR-005（JWT secret 管理与配置路径测试钩子）；零新增依赖（jose/argon2/@nestjs/throttler 均在 P0a 清单）

## P5 — Markdown 文章（Posts）读写与索引同步

- `common/markdown/frontmatter.ts`（新建）：gray-matter 包装提升至 L0 纯工具层（MASTER-PLAN §4 合法解耦通道，供 posts 与 P8 复用）——`parseMarkdown`/`stringifyMarkdown` 往返保真：未知字段原样保留、键序不变、已知字段类型不漂移；补偿 gray-matter stringify 追加换行行为，正文逐字节精确往返；空 frontmatter 不产生分隔符块
- `posts/posts.service.ts`：文章目录管理转正——列表（含 frontmatter 摘要与派生 status）/ 读单篇 / 创建（目录已存在 409）/ 修改（frontmatter 增量合并 + 正文可选）/ 删除（目录逐文件 `preWriteBackup` 后删目录，返回 backupIds 可经备份恢复；索引行软删对齐回收站语义）；封面上传（扩展名白名单 `jpg/jpeg/png/webp/gif` + sharp 可解码校验替代魔数嗅探 + 配置上限检查 → `sharp().rotate().jpeg()` 转 JPG 去 EXIF → 原子写 `cover.jpg` → frontmatter `image` 更新）；`syncIndex` 重建 `article` 表 `source_type='markdown'` 索引（磁盘有表无→insert；哈希变化或软删态→update；哈希一致→零写入；表有磁盘无→`deleted_at` 软删；幂等）；about 页读写（`src/content/spec/about.md`，pre_write 备份 + 原子写，覆盖不删除）。全部写入走统一管线：safeJoin 路径监狱（越界 403）→ zod → `preWriteBackup` → 同目录 `.tmp-<nanoid>` + rename 原子写；slug 白名单校验（禁分隔符与 `..`，纵深防御再过 safeJoin）；创建/修改成功出口 upsert 索引行（published 事件需行 id）
- `posts/posts.controller.ts`：REST 转正——`GET/POST /admin/posts`、`POST /admin/posts/sync`、`GET/PATCH/DELETE /admin/posts/:slug`、`POST /admin/posts/:slug/cover`（multipart `file`，FileInterceptor）、`GET/PUT /admin/about`（归入 posts 控制器）；全部输入参数级 `ZodValidationPipe`；状态推导 `draft===true || published===false → 'draft'`
- `posts/posts.module.ts`：controllers/providers 填充（DbModule/InfraBackupModule 为 @Global 无需 imports）
- 事件发射（写入成功出口恰好一次，payload 先过 zod parse）：`post.changed`（创建/修改/删除，删除场景 `deleted:true` 携带删除前 frontmatter 与哈希）、`article.published`（结果状态 published 时，`sourceType:'markdown'`，upsert 后以行 id 发射）、`content.changed`（scope='post' 与 about 写入的 scope='about'，后者落地 events.ts 的 'about' 枚举）
- 零新增依赖（gray-matter/sharp/nanoid/multer 均在既有清单，multer 经 @nestjs/platform-express 内置引入；上传文件以最小结构接口 `UploadedFileLike` 类型化，不依赖 @types/multer）
- 测试新增 2 文件 23 用例：frontmatter 单测 6（解析/往返保真 12+1 字段/键序/空 frontmatter/YAML 日期语义）+ e2e 17（CRUD 全循环、`../` 穿越三路径拒绝、frontmatter 往返、封面转 JPEG + 伪造扩展名拒绝、删除经 REST restore 恢复、sync 三篇入库 + sha256 断言 + 幂等零写入、事件四类场景断言、about 往返/备份/恢复、404/409、列表）。全仓 143/143 绿

## P4 — 注册表驱动六类集合 CRUD

- `packages/shared/src/collections/`：六个 zod schema 转正（`DiaryItemSchema` / `FriendsItemSchema` / `ProjectsItemSchema` / `TimelineItemSchema`（含 `TimelineTypeSchema`）/ `SkillsItemSchema` / `DeviceItemSchema` + `DeviceGroupedSchema`），字段逐字对齐 REQUIREMENTS §6.3–6.8；**放 shared 的动机：P10 管理面板将由这些 schema 驱动生成表单，前后端复用同一份字段规格**；`src/index.ts` 追加导出
- `collections/registry.ts`（新建）：`CollectionDef` 接口 + `REGISTRY` 六类配置（MASTER-PLAN §4.2 逐字：diary/friends/projects/timeline/skills 为 array+idField=id；devices 为 grouped+idField=name+imageDir=public/images/device；全部 public:true）——新增内容类型 = 加一个配置对象
- `collections.service.ts`：CRUD 编排，全部读写经 DataFileService（P3 引擎唯一通道）——POST 无 id（devices 无 name）自动 nanoid、id 冲突 409、PATCH/DELETE 不存在 404；grouped：POST body 含 `group`（flat 结构）、PATCH 跨分组定位（stripGroup）、DELETE 后空分组键自动清理；timeline POST 未给 icon/color 按 type 填默认映射（**ADR-004 暂定值**，待真实 Mizuki 主题源码核对）；每次写入成功出口恰好一次发射 `content.changed`（scope='collection'、type、filePaths，payload 先过 zod parse）
- `collections.controller.ts`：单一控制器 + `:type` 动态路由（GET/POST/PATCH/DELETE `/admin/collections/:type[/:id]`）；路由第一步注册表白名单校验，未知 type → 400 且零文件读写
- `collections.module.ts`：imports DataFilesModule，providers CollectionsService，controllers CollectionsController
- 微调：`data-file.service.ts` 的 schema 参数放宽为 `z.ZodType`（P4 传入的 array/record schema 输出类型不定，引擎只用 parse 校验）
- 未建任何数据库表（文件即数据库，MASTER-PLAN §2 决策 1）
- 测试新增 2 文件 19 用例：e2e 13（五类全循环、devices 分组+空分组清理、未知 type 四方法 400、事件 payload 断言、非法 body 400+文件未改、id 生成+409、timeline 默认映射、写后 6 文件 tsc --noEmit、404）+ schema 单测 6（fixture 全条目过 schema、必填/类型拒绝、未知字段剥离）。全仓 120/120 绿

## P3 — ts-morph 数据文件引擎（关卡：引擎定型）

- `modules/data-files/` 7 个 stub 全部转正：
  - `evaluator.ts`：AST → JS 值——节点分派表逐字实现（Array/Object 递归、字符串/无插值模板取字面值、数字/布尔/null、as const / satisfies / 括号解包、前缀负号取负；模板插值/标识符/属性访问/Shorthand/Spread/Getter 抛 `UnsupportedLiteralError` **含文件名+行号**）；每次操作新建一次性 Project，彻底规避陈旧 AST
  - `serializer.ts`：`valueToTsLiteral`（JSON 即合法 TS + 键去引号纯美化）
  - `syntax-check.ts`：`assertSyntaxValid`（ts.transpileModule reportDiagnostics，syntax error 必须为 0，错误含行号）
  - `file-lock.ts`：`Map<path, Promise>` 链——同一文件串行、不同文件并行
  - `value-cache.ts`：mtime+size 键读缓存；写管线第 8 步失效
  - `data-file.service.ts`：8 步写管线（顺序不可变）——读盘记哈希 → AST 求值 → 深拷贝变更（支持 async mutate）→ zod 整体校验（schema 由调用方传入，未传跳过）→ 序列化+语法校验 → 陈旧检测（整体重试 1 次，仍冲突 409）→ `BackupService.preWrite` 备份 → `.tmp-<nanoid>` + rename 原子写 → 缓存失效返回新值；所有路径过 safeJoin
  - `data-files.module.ts`：providers（FileLock/ValueCache/DataFileService）+ exports DataFileService（P4 注入）
- 初始化表达式替换采用 `initializer.replaceWithText()`（规格备选方案）：实测 `setInitializer` 对多行文本追加 10 空格缩进（合法但难看）；replaceWithText 精确替换节点区域，golden 字节断言前缀/后缀逐字节一致
- fixture：`test/fixtures/mizuki/` 假 Mizuki 项目定型（package.json 含 astro、astro.config.mjs、src/content/posts、src/types.ts 集中类型定义）；6 个数据文件覆盖块/行注释、单引号、尾随逗号、as const、satisfies、嵌套对象、字符串含引号换行、无插值模板、前缀负号、grouped 中文字符串键
- 修复：InfraBackupModule 补导出 `BACKUP_OPTIONS`（P3 新消费者 DataFileService 注入需要）
- 测试新增 2 文件 30 用例：golden 7（六文件往返 + 外部字节不变 + tsc --noEmit 可选集成）+ engine 23（5 类不支持节点含行号、支持语法不误伤、语法校验、陈旧 409×2、文件锁串行/并行、value-cache 命中/失效/写失效、pre_write 快照、原子写无残留、新文件首写、zod 失败不落盘、路径逃逸 403、getter 抛错）。全仓 101/101 绿

## P2 — 备份与恢复：唯一备份实现与 REST API

- `infra/backup/backup.service.ts`：全项目唯一备份实现转正——`preWriteBackup`（单文件前置快照，每文件保留最近 10 份自动清理）、`manualBackup`（full/data/content 集合备份，full = data ∪ content 见 ADR-003）、`dbBackup`（better-sqlite3 `.backup()` API）；manifest.json 记录每个文件原路径 + sha256 及元信息；`restore` 恢复前先做当前状态快照（可回滚）→ manifest 完整性逐文件 sha256 校验 → 文件原子回写（临时文件 + rename）/ db 用 `.backup()` 逆向写回；所有 Mizuki 根路径解析经 safeJoin（越界 403）；备份成功出口恰好一次发射 `backup.completed`
- `infra/backup/backup.module.ts`（新建）：`@Global() InfraBackupModule`，提供 `BACKUP_OPTIONS` 注入（mizukiRoot/backupDir/dbPath）并导出 BackupService 供后续阶段直接调用
- `modules/backup/backup.controller.ts` + `backup.module.ts`：REST 四路由转正——`POST /admin/backups`（scope ∈ full/data/content/db，文件类 scope → 记录层 manual；mizukiRoot 未配置 400）、`GET /admin/backups`（列表）、`POST /admin/backups/:id/restore`（必须 `confirm: true`，否则 400）、`DELETE /admin/backups/:id`（目录 + 记录同删）；body 一律过 ZodValidationPipe
- `app.module.ts`：imports 头部追加 InfraBackupModule（早于业务模块）
- db 恢复的记录重登记：db 文件整体回滚会丢失备份时刻之后写入的记录行（恢复前快照记录、被恢复备份自身记录），恢复完成后自动补录（磁盘产物未动）
- 测试新增 2 文件 27 用例：单测 14（备份→篡改→恢复→哈希一致 ×2、保留策略 11→10、manifest 完整性 ×2、db 备份恢复 + 快照可查、事件、路径逃逸 ×2、mizukiRoot 未配置、0 文件空备份、删除）+ e2e 13（四 scope 创建、列表、restore 400/200/404、DELETE、事件订阅者、未配置 400）。全仓 71/71 绿
- 新增 ADR-003（full scope 备份集合 = src/data/*.ts + src/content/**）

## P1 — 安全基建：路径监狱、zod 管道与全局防护

- `common/security/safe-join.ts`：路径监狱转正——`safeJoin`（resolve + 前缀校验，越界抛 `ForbiddenPathError`；空字节入口直接拒绝，URL 编码与 Windows 风格反斜杠做防御性复查）；`safeRealJoin` 在其上对已存在祖先链做 realpath 校验，防止 root 内符号链接把路径引到 root 之外（内部互指 symlink 放行）。全项目唯一合法路径入口（MASTER-PLAN §9 守则 4）
- `common/pipes/zod-validation.pipe.ts`：`ZodValidationPipe(schema)` 转正——`safeParse` 失败抛 `BadRequestException`，经统一过滤器输出 `{ code, message, detail }`，detail 携带 zod issues（字段路径 + 错误信息）；用法为路由级 `@UsePipes` 显式声明
- `app.setup.ts`：追加 helmet 默认安全头、CORS 白名单（默认仅 `http://localhost:20154`，端口沿用 `MIZUKI_SERVER_PORT` 环境变量逻辑；AppConfig 若声明 `corsOrigins` 字段将自动并入——当前 schema 无该字段，见 SESSIONS P1 偏差说明）、全局 zod 管道挂载点注释
- `app.module.ts`：`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])` + `APP_GUARD` 全局 `ThrottlerGuard`（60 次/分钟/IP；登录 5 次/分独立限流留待 P6）
- 测试新增 2 文件 27 用例：safe-join 攻击 9 条（`../`、绝对路径、多层穿越、`..\`、`%2e%2e%2f`、`..%5C`、混合编码、空字节×2）+ 正常 4 条 + realpath 防护 6 条；e2e 8 条（zod pipe 合法/非法、helmet 头、CORS 白名单/非白名单/预检、61 次限流 429）。全仓 44/44 绿
- 无新增依赖（helmet 8.3.0、@nestjs/throttler 6.5.0、zod 4.4.3 均在 P0a 清单内）

## P0b — 配置加载、数据库 11 表与统一异常

- `config/app-config.ts`：`data/config.json` zod 校验加载（非法即启动失败、错误含字段路径；缺省返回默认值），进程内单例 + pino 日志
- `infra/db/schema.ts`：Drizzle 定义全部 11 张表（逐字对齐 MASTER-PLAN §3）；`drizzle/0000_*.sql` 首个迁移由 drizzle-kit 生成
- `infra/db/migrate.ts` + `db.module.ts`：`runMigrations()` 幂等迁移（migrator 记账表处理见 ADR-002）；`@Global` DbModule 提供 better-sqlite3 / drizzle 双实例，启动自动迁移
- `common/filters/all-exceptions.filter.ts`：全局统一异常格式 `{ code, message, detail }`，未知异常对外固定「内部服务器错误」，堆栈仅入日志
- `packages/shared/src/events.ts`：事件目录骨架——6 个事件常量 + 各 payload zod schema（MASTER-PLAN §4.4 逐字）
- `common/logger.ts`：pino 共享日志实例（`MIZUKI_LOG_LEVEL` 控制级别）
- 根 `eslint.config.mjs`：eslint-plugin-boundaries 四层依赖规则（L0/L1/L2/L3），L2 互导禁止、L3 互通允许，error 级；配 `eslint-import-resolver-typescript` 解析 TS import
- 接线：`app.setup.ts` 挂全局过滤器；`app.module.ts` 注册 `EventEmitterModule.forRoot()` 与 DbModule
- 新增依赖：`@nestjs/event-emitter` 3.1.0、`pino` 10.3.1、`@types/better-sqlite3` 9.6.0、`eslint-plugin-boundaries` 7.2.0、`eslint-import-resolver-typescript` 4.4.5、shared 声明 `zod`（见 ADR-001 追加记录、ADR-002）
- 测试：5 个文件 17 用例全绿（迁移建表/幂等、config 三态、过滤器双单测、事件目录、health 回归 + 启动迁移断言）；分层拦截人工验证两轮（违规 import → lint error → 移除 → 恢复绿）

## P0a — 仓库骨架与可启动 NestJS 服务

- 初始化 pnpm monorepo（apps/server、apps/web、packages/shared）
- 建立 NestJS 服务端骨架，默认端口 `20154`，全局 API 前缀 `/api/v1`
- 实现 health 健康检查端点（`GET /api/v1/system/health`）
- 建立 stub 文件体系，按阶段 P0a–P11 标注（见各文件头注释）
- 文档占位：MASTER-PLAN / STRUCTURE / ADR / prompts 归档目录
