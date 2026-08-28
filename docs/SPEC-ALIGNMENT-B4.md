# SPEC-ALIGNMENT-B4 — Mizuki 真实主题规格对齐审计（Phase2-B4）

- 日期：2026-08-28
- 审计基座：`docs/refs/mizuki-docs/` 官方文档快照（唯一依据，禁止外网）；逐字摘录见 `docs/audits/b4-doc-excerpts.md`（下称「摘录卡」，引用格式 `<文件名> §小节`）。
- 处置标记四类：**【本批已修】**（无风险对齐，已落地）/ **【B2 落地（待裁决）】**（涉服务行为/存量数据/新端点，与 B2 同批）/ **【维持现状】**（必须给理由）/ **【需裁决】**（本文件 T4 章呈报，本批不实施）。
- 硬性边界遵守：幽灵字段禁令（六类 mapper 驱动 schema 禁新增字段）、albums/posts 控制器与 service 行为零改动（白名单常量与错误文案除外）、公开 API 四路径冻结、/site-assets 边界（ADR-012）不可触碰。

## 审计总表（T2）

| # | 条目 | 官方规格（摘录引用） | Server 现状（代码文件:行号） | 处置 |
|---|---|---|---|---|
| a1 | friends 必填面：desc | 「`desc: string`: (必填)」（special-friends §2） | `packages/shared/src/collections/friends.ts:16` 原为 `desc: z.string().optional()` | 【本批已修】`desc` 改必填；fixture f-002 补 desc；p4 e2e friends 创建体同步 |
| a2 | friends 必填面：tags≥1 | 「`tags: string[]`: (必填)……**至少包含一个标签**」（special-friends §2） | 原 `tags: z.array(z.string()).optional()`（friends.ts:15） | 【本批已修】`tags: z.array(z.string()).min(1)`；schemas.spec 补「缺 desc / 空 tags 均拒」用例 |
| a3 | friends id 类型 | 「`id: number`……**必须是数字，且不能重复**」（special-friends §2） | Server id 为 nanoid string：`friends.ts:12`、registry idField 定位 `collections.service.ts`（`item[idField] === id` 字符串比较）、POST 自动生成 nanoid；fixture `src/types.ts:12` 同 | 【需裁决】→ 见 T4 追加裁决项 9（涉及集合服务 id 生成/定位行为与存量数据，非校验面可落地项） |
| a4 | friends 其余字段 | title/imgurl/siteurl 全必填、需含协议（special-friends §2） | `friends.ts:13-17` 三者必填；siteurl 未校验协议前缀 | 【维持现状】协议校验属输入 UX 增强，收紧会拒既有合法数据（如相对路径头像），与官方「需要包含协议」为建议性描述一致；面板侧可加 tooltip 引导（R2-13 既有机制） |
| b1 | info.json 模型：mode/hidden/cover/photos[] | 通用字段表 + 外链模式详解：`mode:"external"`、`hidden`、外链 `cover` + `photos[]` 富元数据 src/thumbnail/alt/width/height/camera/lens/settings（special-gallery §通用字段说明/§外链模式详解） | `AlbumInfoSchema` 仅 title/description/date/location/tags/layout/columns 七字段（`apps/server/src/modules/albums/albums.service.ts:62-71`）；无 mode/hidden/cover/photos | 【B2 落地（待裁决）】R2-14 已立项但形状须按官方修订：R2-14 原文 `source:"external" + urls[]` 与官方 `mode:"external" + photos[]` 不符——**B2 必须以官方快照为准**（详见 §B2 输入增量） |
| b2 | 本地模式封面必须 cover.jpg | 「**封面图必须命名为 `cover.jpg`**」（special-gallery §文件命名规则） | Server 创建/列表只校验 info.json，不检查 cover.jpg 存在（albums.service list `tryReadInfo` 跳过无 info 目录） | 【B2 落地（待裁决）】属相册服务行为（创建时校验或告警），随 b1 同批 |
| b3 | layout 枚举 grid/masonry、columns 默认 3 | 「布局方式："grid" 或 "masonry"」「列数，默认 3」（special-gallery §通用字段说明） | `albums.service.ts:68-69` layout 为自由 string、columns 正整数（无默认值、无枚举） | 【B2 落地（待裁决）】校验收紧会拒存量数据，随 b1 同批 |
| c1 | 图片格式矩阵：tiff/tif | 官方支持 `.tiff`/`.tif`（special-gallery §支持的图片格式） | magic-sniff 原四格式无 tiff（ADR-006） | 【本批已修】`magic-sniff.ts:20,28-30,57-66` 补 tiff 双端序魔数；`EXTENSION_FORMAT` 增 `.tif/.tiff`（:23-31）；`media.service.ts:56-71` FORMAT_MIME/FORMAT_EXT、`:235-236` reencode tiff；单测补正反用例 |
| c2 | 图片格式矩阵：bmp | 官方支持 `.bmp`（special-gallery §支持的图片格式） | sharp 0.35 预编译版实测无法解码 BMP（`Input buffer contains unsupported image format`，本批 probe 实证），解码兜底/重编码全链路不存在 | 【需裁决】→ T4-3（放行即「必 400 死入口」，除非放弃重编码直存原字节） |
| c3 | 图片格式矩阵：svg | 官方支持 `.svg`（special-gallery §支持的图片格式） | 上传面排除 svg；`/site-assets` 白名单含 svg（ADR-012 边界 3：仅对既有文件通道） | 【需裁决】→ T4-3（XSS 面） |
| c4 | 图片格式矩阵：avif | 官方支持 `.avif`（special-gallery §支持的图片格式） | 上传面无 avif（sharp 支持 avif 编解码；魔数为 ISO-BMFF `ftyp` 盒，嗅探实现较现有格式复杂）；`/site-assets` 白名单含 avif（ADR-012） | 【需裁决】→ T4-3 一并定终集 |
| d | 「非 JPG 强转 JPG」 | 官方本地相册原生多格式并存（special-gallery §本地模式详解：图片1.jpg/图片2.png/图片3.gif 示例） | albums 上传「统一转 JPG」（`albums.service.ts:212-218,222`）；posts 封面转 JPG（`posts.service.ts:241-277`）；媒体库已保原格式（`media.service.ts:114-127,223-238`） | 【需裁决】→ T4-2（ albums/posts 侧与官方相悖，但 R2-7/R2-14 已立项且涉及产物后缀/引用契约） |
| e1 | posts frontmatter 字段集 | 必需 title/description；published/pubDate/date/draft/permalink/tags/category/pinned/author/licenseName/sourceLink/image（press-file §Frontmatter 字段详解） | `PostFrontmatterSchema` 12 已知字段 + `.passthrough()`（`apps/server/src/modules/posts/posts.service.ts:57-72`）；licenseName/sourceLink 虽非已知字段但 passthrough 原样保留（`common/markdown/frontmatter.ts:4-7` 未知字段原样保留） | 【维持现状】字段集覆盖官方全集（未知字段走 passthrough 不丢失）；perm不存在字段无服务语义，B2 如需面板级编辑控件属 UI 增强 |
| e2 | posts description 必填性 | 「**必须包含 `title` 和 `description` 字段**」（press-file/press-folder §创建文章） | `description: z.string().optional()`（posts.service.ts:61）；title 必填 ✓ | 【需裁决】→ T4-8 |
| f | 文件夹方案相对路径图片预览 | 「可以直接使用相对路径：`![图片描述](image1.png)`……图片与文章一同打包部署」（press-folder §管理图片）；图片存 `src/content/posts/<slug>/`（§目录结构） | `/site-assets` 只挂 `<root>/public`（ADR-012 §决策 1）；文章图片在 `src/content/posts/` 不在 public/（`posts.service.ts:108` POSTS_REL_DIR），`<img>` 经 `imageSrc()` 只能命中 public 子树 → 相对路径图片在面板无预览通道 | 【需裁决】→ T4-1 |
| g | timeline icon/color 默认映射 | 官方用 **Iconify 图标集**；education 示例 `material-symbols:school`/`#059669`、work 示例 `material-symbols:work`/`#DC2626`（special-timeline §2/§3） | `TIMELINE_DEFAULTS`（`collections.service.ts:37-42`）原全 Lucide 暂定（ADR-004） | 【本批已修】education 按官方示例值修订；certificate/project/other 无官方示例，暂定保留并逐行注记；ADR-004 遗留义务勾销（见其 §B4 修订） |
| g2 | timeline type 枚举 | `"education" \| "work" \| "project" \| "achievement"`（special-timeline §2） | `TimelineTypeSchema = education\|certificate\|project\|other`（`packages/shared/src/collections/timeline.ts:8`） | 【B2 落地（待裁决）】枚举变更连带 TIMELINE_DEFAULTS、fixture、e2e、存量数据迁移——与服务行为同批（幽灵字段禁令同理由） |
| h1 | diary 字段 | interface DiaryItem：id/content/date 必填，images/location/mood/tags 可选（special-diary §2） | `DiaryItemSchema`（`packages/shared/src/collections/diary.ts:8-21`）字段集与必填面逐字一致 | ✅ 已对齐（id 类型差异归 a3 同一裁决项） |
| h2 | diary 图片路径约定 | 「建议 `public/images/diary/`」「路径从 public 开始计算」（special-diary §3） | SchemaForm 引导文案与 `imageDir: 'public/images/diary'`（`registry.ts:37`）一致 | ✅ 已对齐 |
| h3 | projects 字段 | description/image/category/techStack/status/startDate 必填；category/status 为枚举（special-projects §2） | `ProjectsItemSchema` 全字段可选、category/status 自由 string（`packages/shared/src/collections/projects.ts:8-27`） | 【B2 落地（待裁决）】收紧即拒存量数据（fixture p-002 的 `status:'active'`/`category:'工具'` 均非官方值），须与数据迁移/表单升级同批 |
| h4 | timeline 缺失字段 | endDate/position/achievements/links（special-timeline §2） | `TimelineItemSchema` 无此四字段（`timeline.ts:11-23`） | 【B2 落地（待裁决）】**幽灵字段禁令**：新增持久化字段必须与服务/UI 接线同批（§4 硬性边界 1） |
| h5 | skills 字段 | description/icon/category/level/experience 全必填；level 为字符串枚举；icon 用 Iconify；projects/certifications 可选（special-skills §2） | `SkillsItemSchema`（`skills.ts:13-22`）：全可选、level 为 number、无 projects/certifications | 【B2 落地（待裁决）】level number→字符串枚举是类型变更（非校验强度），连带 fixture 覆盖点（负号用例 s-003）与表单控件；同批处理 |
| h6 | devices 字段 | 五字段全必填 string；分组对象形态（special-devices §2） | `DeviceItemSchema` 五字段但仅 name 必填（`devices.ts:10-21`）；grouped 结构 ✓ | ✅ 结构已对齐；必填面【B2 落地（待裁决）】（收紧拒存量空字段数据） |
| i | 内容仓库结构兼容性 | 目录约定：`src/content/posts/`、`src/data/`、`public/images/{albums,diary}`（other-structure §推荐的目录结构；special-gallery/diary §路径） | registry `file: 'src/data/*.ts'`（`registry.ts:30-87`）、`POSTS_REL_DIR='src/content/posts'`（posts.service.ts:108）、`ALBUMS_REL_DIR='public/images/albums'`（albums.service.ts:48）、`UPLOADS_REL_DIR='public/images/uploads'`（media.service.ts:50） | ✅ 已对齐（证据如左）；内容分离（other-separation）属博客前端 CI 面，Server 以 mizukiRoot 指向仓库根即天然兼容 |
| i2 | anime.ts（第 7 数据文件） | data/ 含 `anime.ts`（other-structure §推荐的目录结构） | 六类 registry 无 anime；Server 对未知数据文件零触碰 | 【维持现状】官方文档无 anime 数据结构规格页（未快照到 interface），无对齐依据；文件保留不受影响；如需面板管理待官方规格页补抓后另行立项 |
| j | P5 偏差 1：article.category_id 存分类名 | 官方 frontmatter `category: Examples` 为分类名字符串，无分类表机制（press-file §内容分类） | P5 偏差 1 原文（SESSIONS P4/P5 报告）：`article.category_id` 直接存 frontmatter category 名称 | 【维持现状】官方语义即「分类名」而非 id 引用——现存实现与官方机制语义一致；P8 公开 API 按名称消费已成立（P5 偏差 1 的「届时确认」条件就此闭环） |
| k | slug 唯一性与命名约定 | 「文件名将被用作文章的 URL 路径……不含特殊字符」（press-file §注意事项）；文件夹名即 slug（press-folder）；permalink 相对 posts 构建（press-permalink） | `PostSlugSchema` 拒路径分隔符与 `..`、max 200（posts.service.ts:43-48）；slug 唯一性由目录名唯一天然保证；permalink 走 passthrough 保留 | 【维持现状】路径安全最小拒绝面（安全边界）；「不含特殊字符」为作者侧建议性约定，服务端收紧会破坏既有 slug 兼容；面板侧命名提示可后续增强 |

**统计**：条目 27 行（a1–a4、b1–b3、c1–c4、d、e1–e2、f、g、g2、h1–h6、i、i2、j、k）。
处置分布：【本批已修】4（a1/a2/c1/g）｜✅ 已对齐 4（h1/h2/i/j）｜【维持现状】4（a4/e1/i2/k，均附理由）｜【B2 落地（待裁决）】8（b1/b2/b3/g2/h3/h4/h5/h6）｜【需裁决】7（a3→追加裁决项 9；c2/c3/c4→T4-3；d→T4-2；e2→T4-8；f→T4-1）。合计 4+4+4+8+7=27。

---

## 裁决呈报（T4）

> 以下八项 + 审计追加一项。每项：背景 / 候选方案（≥2）/ 各自利弊 / 建议。**建议仅为呈报者意见，标注「建议，待人工裁决」；本批一律未实施。**

### T4-1 相对路径图片预览通道

- **背景**：官方推荐文件夹方案图片与文章同目录（摘录卡 §4 press-folder），存于 `src/content/posts/<slug>/`，不在 `public/`；ADR-012 `/site-assets` 只挂 `<root>/public`。面板编辑文章时 `![](./x.png)` 无法渲染预览（fixture `relative-images` 样例即测试靶）。
- **候选方案**：
  1. `/site-assets` 扩挂 `src/content/posts` 只读出口：守卫链复用（认证/逐段 decode/白名单/safeRealJoin/statSync），把 posts 子树并入静态服务；
  2. 专用管理端点（如 `GET /admin/posts/:slug/assets/*`）+ cookie 通道：经 controller/服务层，路径解析按 slug+相对段；
  3. 依赖 P9 preview 真实预览：面板不做内联预览，等 dev server 预览形态（文章经 Astro 真实渲染）。
- **利弊**：
  1. 前端零改动（`imageSrc()` 加一条前缀映射即可）；改动点集中 main.ts 一处守卫；但 `/site-assets` 语义从「public/ 资产」扩为「public/ + posts 内容目录」，扩大了认证静态面（相对路径图片可被任何持 token 者读取——与面板可见性一致，无越权），且 ADR-012 边界需修订记 ADR；
  2. 语义边界干净（文章资产单独端点），但新建 controller/service 违反本批边界、前端需第二套 URL 映射，改动面大；
  3. 零安全面变化，但编辑体验缺口长期存在，且 P9 preview 是 dev 形态，生产面板仍无解。
- **建议**：方案 1（扩挂只读出口，守卫链四条安全边界原样复用 + 扩展名白名单与 ADR-012 对齐），同时修订 ADR-012 或另记 ADR。**建议，待人工裁决。**

### T4-2 「非 JPG 强转 JPG」去留

- **背景**：官方本地相册多格式原生并存（摘录卡 §2）；Server albums 上传与 posts 封面仍统一转 JPG（`albums.service.ts:212-218`、`posts.service.ts:241-277`），媒体库已保原格式（P7 语义）。R2-7/R2-14 已立项（转 B2），本裁决定方向。
- **候选方案**：
  1. 全移除：albums 与 posts 封面均保留原格式（产物后缀以实际格式为准，info.json/frontmatter.image 同步实际文件名）；
  2. 仅对官方不支持格式转码：官方 8 格式内保原样，白名单外（如 tiff→jpg）兜底转码；
  3. 维持现状（全转 JPG）。
- **利弊**：
  1. 与官方完全对齐；但产物文件名从「恒 .jpg」变为可变，删除/引用检查/info.json 记录的文件名口径须同步改，改动面 = albums + posts 两个 service 及其 e2e；
  2. 折中：官方格式全覆盖时几乎不触发转码；保留对「不可服务格式」的兜底能力；复杂度介于两者之间；
  3. 与官方相悖（gif/webp 被转成 jpg：丢动画、丢透明通道），但零改动。
- **建议**：方案 2（官方 8 格式保原样 + 白名单外兜底转 JPG），与 T4-3 白名单终集联动；B2 落地时按 R2-7「info.json 记录的文件名以实际产物后缀为准」执行。**建议，待人工裁决。**

### T4-3 上传白名单终集与 svg/bmp/avif 处置

- **背景**：官方支持 jpg/jpeg/png/gif/webp/svg/avif/bmp/tiff 八类（摘录卡 §2）；本批后上传面 = jpg/jpeg/png/webp/gif/tif/tiff（tiff 已落地）。svg 可携带脚本（`<script>`、事件属性、外链引用），公开博客直接服务用户上传 SVG 存在 XSS 面；bmp sharp 无法解码（本批实证）；avif sharp 可编解码但魔数嗅探实现复杂（ISO-BMFF ftyp 盒）。
- **候选方案**：
  1. svg 上传时消毒（如 DOMPurify/svgo 清洗脚本节点）后入库；bmp 拒绝（技术不可行注记）；avif 补 ftyp 嗅探进入白名单；
  2. 媒体库排除 svg（维持现状）、bmp 拒绝、avif 进入；
  3. 全维持现状（svg/bmp/avif 均不进上传面）。
- **利弊**：
  1. 与官方支持面最大对齐；但需新增 sanitize 依赖（违反零新增依赖惯例，须 ADR-001 记录）且 svg 消毒库本身是攻击面；avif 嗅探实现+用例成本高；
  2. 零依赖增量；svg 用户可手工放置到站点目录（官方路径约定仍可用），仅面板上传面不含；avif 补齐官方格式；bmp 官方支持但服务端技术不可行，显式记录；
  3. 最保守，但 avif 明明可行却缺席，对齐面收窄。
- **建议**：方案 2。bmp 以「sharp 无法解码」记录为已知限制（若未来 sharp 支持，重开）；avif 补嗅探进白名单可随 B2 的 R2-7 批次一并做；svg 维持排除（如人工坚持支持，须先裁决消毒依赖）。**建议，待人工裁决。**

### T4-4 运行期变更 mode 端点 + 设置页 UI

- **背景**：R2-5 已按 mode 过滤菜单，但变更运行模式（minimal/管理 全量）须手改 `config.json` 并重启；官方无对应概念（Server 自有设计）。
- **候选方案**：
  1. `PATCH /admin/system/mode`（写 config.json mode 字段 + 面板设置页下拉）：写路径复用 settings 既有管线（zod + 备份 + 事件）；mode 变更实时生效（R2-5 每次拉状态）；
  2. 维持手改 + 重启：零代码。
- **利弊**：1 便捷且审计链完整（事件/备份），但新增管理端点须过公开 API 冻结审查（admin 面新增不在冻结范围，仍须 Swagger 分组更新）+ 越权风险面（mode 降级语义须明确：minimal→full 恢复全部菜单）；2 无风险但体验差且易改坏 config.json。
- **建议**：方案 1，随 B2 批次与 R2-5 联动落地。**建议，待人工裁决。**

### T4-5 改密能力 PATCH /admin/auth/password

- **背景**：认证密码只在 init 设置，遗忘/轮换无自助通道。
- **候选方案**：
  1. `PATCH /admin/auth/password`（body 含 oldPassword + newPassword；旧密码 argon2 verify → 新密码 argon2id 重哈希落 config/DB）+ 面板改密表单；子裁决：改密后既有 access/refresh token 是否失效（推荐：改密即旋转 JWT secret 或 token 版本号 → 全端下线重登）；
  2. 仅 CLI/手改（无端点）。
- **利弊**：1 完整闭环；须防暴力猜测旧密码（限流复用全局 throttler）；token 失效策略影响在线会话（失效=安全优先，不失效=体验优先）；2 无攻击面但运维成本高、密文轮换无人执行。
- **建议**：方案 1，且「改密后既有 token 全部失效」（旋转 token 版本）——改密往往正因凭据疑似泄露。**建议，待人工裁决。**

### T4-6 生产形态 Swagger 开关

- **背景**：公网暴露已实证 52 端点定义可匿名浏览（P11 三分组 docs-json/docs-ui 公开）；虽不含敏感数据，但给攻击者完整 API 地图。
- **候选方案**：
  1. 生产默认关闭 docs-json/docs-ui（配置项 `swaggerEnabled` 默认 false，dev/test 默认 true）；
  2. Swagger 移入认证面（/admin/docs）；
  3. 维持现状。
- **利弊**：1 攻击面直接归零，调试时可用配置打开；2 保留浏览能力但增加认证逻辑分支，且 docs 面进入 admin 分组影响 Swagger 分组语义；3 信息泄露持续存在。
- **建议**：方案 1（配置开关 + 默认生产关闭）。**建议，待人工裁决。**

### T4-7 manage 模式隐藏范围

- **背景**：R2-5 minimal 模式隐藏「富文本文章与六类集合」；粒度粗（一刀切），用户可能只想藏富文本而保留集合管理。
- **候选方案**：
  1. 维持现状（一刀切）；
  2. 仅藏富文本、保留集合；
  3. 菜单级自定义开关（config.json 维护隐藏项列表）。
- **利弊**：1 简单、语义可预期；2 灵活性稍增但仍硬编码两档；3 最灵活但 config 面扩大、fail-open/fail-closed 语义须定义（未知项默认显隐）。
- **建议**：方案 1 维持现状（mode 语义 = 「仅管理站点运行」而非「细粒度权限」；细粒度需求出现时再上方案 3）。**建议，待人工裁决。**

### T4-8 posts description 必填策略

- **背景**：官方 frontmatter title/description 必填（摘录卡 §3/§4）；Server 仅 title 必填（`posts.service.ts:61`）；面板创建文章时 description 可空。严格必填会卡「先建草稿后补描述」流。
- **候选方案**：
  1. Server 强制（CreatePostBodySchema description 必填）：与官方逐字对齐；草稿须填占位描述；
  2. 面板必填 + Server 宽松（表单校验必填，服务端保持 optional）：体验兼容无 description 草稿/API 直建；非面板写入（手放 md 文件）不受限；
  3. Server 对「发布态」强制、草稿豁免（创建/修改时 draft!==true 则必须 description）。
- **利弊**：1 与官方一致但破坏草稿场景且影响存量无描述文章的下次 PATCH（合并后整体过 schema → 400）；2 官方约束由 UI 保证、服务端零风险，但 API 绕过面存在（管理面本就认证后使用）；3 语义最精准但状态推导逻辑进入校验层（published 派生规则与 P5 deriveStatus 联动，复杂度高）。
- **建议**：方案 2（面板必填 + Server 宽松），并保留方案 3 为后续收紧路径。**建议，待人工裁决。**

### 追加裁决项 9（审计产生）：六类集合 id 类型（string nanoid vs 官方 number/名称）

- **背景**：官方 friends/diary `id: number`（special-friends/special-diary §2）、timeline/projects/skills 为字符串名称（小写连字符）；Server 六类统一 nanoid string id（POST 自动生成、路径参数字符串定位）。Server 写出的 `friends.ts`/`diary.ts` 若 id 为字符串，真实主题按 TS interface 编译会类型报错。
- **候选方案**：
  1. 按官方逐类对齐（friends/diary 数值自增 id，其余名称 slug id）：idField 生成/冲突/定位逻辑按类型分派；
  2. 维持 nanoid string：真实主题消费前需人工/脚本转换（或主题侧宽松容忍）；
  3. 折中：仅 friends/diary 对齐 number（TS 编译必炸的两类），其余维持。
- **利弊**：1 全对齐但改动 collections.service 核心定位/生成逻辑 + 存量数据迁移 + P10 表单（id 只读展示）；2 零改动但「面板产出的数据文件不能直接被主题编译」是硬伤；3 覆盖编译必炸面，改动面最小。
- **建议**：方案 3 过渡、方案 1 为终态（B2 与 T2-h 字段对齐同批设计）。**建议，待人工裁决。**

---

## B4 与 B2 的边界确认

- 本批已动：shared friends schema 必填面、magic-sniff/上传白名单（tiff）、fixture 官方化（friends 数据/外链相册/相对路径图片文章）、ADR-004 修订、错误文案同步（albums/media 白名单提示）。
- 本批未动（待裁决/B2）：albums/posts 服务行为、全部八+一项裁决、五类集合 schema 收紧、timeline/projects/skills/devices 字段面。
