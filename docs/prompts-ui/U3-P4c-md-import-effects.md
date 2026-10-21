# U3-P4c — Markdown 通用导入器（A-GAP-13 ★ 档）+ 特效非敏感开关纳管（A-GAP-04）

> [签发] 架构师 2026-10-21。执行方：用户指定模型通道。**完成即停**，交回报告等验收。
> [前置] HEAD = `fcfe914`（v1.0.0 + CI 修复收尾）。基线 **546 用例 / 62 文件**（`apps/server/test` 实测
> = 21 个 `*.spec.ts` + 41 个 `*e2e-spec.ts`）；三连全绿。本包所有仓内 `file:line` 均按该 HEAD 实读；
> 主题侧 `file:line` 为**跨仓抽验**（见 §1.0 末行注记）。
> [PM 裁定] `docs/audits/feature-alignment/README.md` §8.1/§8.4：本批兑现 **A-GAP-13（★ 仅 Markdown 通用导入）**
> 与 **A-GAP-04（仅非敏感特效开关）**。★★ 方言（Hexo/Hugo/Jekyll）与 ★★★ CMS（Halo/Typecho/WordPress）
> **明示不做**，A-GAP-03/05/12 不排期——本包不为其留任何钩子。

## 0. 三处架构师再裁（执行方不得偏离；发现与事实冲突**停下报告**）

**再裁 A（YAML 解析留在服务端，前端零解析）**：仓库唯一的 frontmatter 解析器是 `gray-matter`
（`common/markdown/frontmatter.ts:13` 导入、`:25-31` `parseMarkdown`），属 **server 依赖**；`apps/web`
无 YAML 依赖。裁定：**浏览器只做 File→ArrayBuffer→文本读取与上限预检，YAML 解析 / 键映射 / 校验全部在
服务端**（新端点复用 `parseMarkdown` + `PostFrontmatterSchema`）。否决「只接受已解析好的结构化 JSON，
让前端做文本切分」：那会把 YAML 边界判断（BOM、CRLF、`---` 前空行、正文里的 `---` 分隔线）在浏览器里
复制成第二份口径，与 posts 写入口的解析单源分叉——正是 P5 §3.2「往返保真」要防的事。

**再裁 B（提交阶段不新增写端点）**：预览新增**只读**端点；提交**逐条复用既有
`POST /admin/posts`**（`posts.controller.ts:59-64` → `PostsService.createPost`，`posts.service.ts:304-341`）。
否决「服务端批量 commit 端点内部循环 `createPost`」：它必然另造一套批量结果契约（状态码、聚合形状）扩张
管理 API 面，且天然诱导出一个「覆盖已存在」开关——那会拆掉 `createPost` 的 409 语义。逐条提交让
「最小事务单元 = 一次 createPost」成为唯一语义，部分失败无需回滚（见 K4）。

**再裁 C（T2 落点不是 `siteConfig` 成员）**：特效三档在主题里是 **`config.ts` 的顶层声明**
`musicPlayerConfig` / `sakuraConfig` / `pioConfig`，`musicPlayer`/`sakura`/`pio` 只是 `widgetConfigs`
对象的**成员名**（成员值是标识符引用，不是字面量）。故「沿用 U3-P4a 的逐属性置换」= 对**各自对象字面量
初始化器**逐属性置换，**不得**置换 `widgetConfigs` 的成员（把 `music: musicPlayerConfig` 换成字面量会让
顶层声明变死代码，`originals` 还原语义也随之错位）。审计表 §8.1 的「复用 site-config 逐属性置换模式」指
**手法**（`spliceSiteInfo` 同款），不指**位置**——`siteConfig` 15 键契约与 `ConfigOverrideFileSchema.siteInfo`
本批**一行不动**。

## 1. 事实基座（已实读核实，执行方可抽验）

### 1.0 锚点清单

| # | 锚点 | 一句结论 |
|---|---|---|
| 1 | `posts.service.ts:304-341` | `createPost` 是唯一写盘入口：`:310-318` 目录/单文件双向 409、`:320` 富文本 slug 占用 409、`:329` 序列化、`:330` pre_write 备份、`:331` 原子写、`:333-338` 索引 upsert + `post.changed`/`content.changed`/`article.published` |
| 2 | `posts.service.ts:75-132` | `PostFrontmatterSchema`：23 键 + `.passthrough()`；`title` **必填**、`description` 可选（`:135-144` S5 裁定放宽） |
| 3 | `posts.service.ts:190-195` | `CreatePostBodySchema = { slug, frontmatter, content, form?: 'dir'\|'file' }` |
| 4 | `posts.service.ts:61-65` + `common/validation/segment-name.ts:36-44` | slug = 单段名：`min(1)/max(200)`、正则 `^[^\\/]+$`、拒绝 `..` 与 `.`；中文文件名合法 |
| 5 | `posts.service.ts:823-852` | `BARE_DATE_KEYS = ['published','updated']` + 自拼序列化：日期键输出**裸 `YYYY-MM-DD`**（引号形剥离、ISO 零点截断），其余行零触碰 |
| 6 | `common/markdown/frontmatter.ts:13,25-31,41-50` | 全仓唯一 YAML 面 = `gray-matter`；`parseMarkdown` / `stringifyMarkdown` 往返保真（未知键保留、键序保持） |
| 7 | `posts.controller.ts:59-64` | `POST admin/posts` 201；body 过 `ZodValidationPipe(CreatePostBodySchema)` → 失败 **400 + `detail.issues[]`**（`zod-validation.pipe.ts:19-21` → `zod-issues.ts:39-52`，path 为点号拼接） |
| 8 | `common/validation/zod-issues.ts:54-81` | `safeParseIssues` 存在且专为「自行决定处置」而建——导入预览的条目级校验**必须**用它（不得用会抛的 `parseOrBadRequest`，否则一个坏文件毁整批） |
| 9 | `app.module.ts:30-33` | 全局限流 **60 次/分钟/IP**（`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])`）——导入批量的硬上界由它推出（K2） |
| 10 | `app.setup.ts:41-60` | `configureApp` **未**设 body parser 上限（全仓 grep `bodyParser`/`useBodyParser`/`json({` 零命中）→ Nest/Express 缺省 `100kb` 生效，故导入走 **multipart** 而不走 JSON（K1） |
| 11 | `posts.controller.ts:94-107` | 既有 `FileInterceptor('file')` 用法（封面）；`@nestjs/platform-express` 已在依赖内，`FilesInterceptor` 同包导出 → 零新依赖，但**本仓首次使用多文件变体**，须用一条用例证实 multer 上限错误的实际状态码（K2/§4） |
| 12 | `site-config.service.ts:612-659` | `spliceSiteInfo`：`siteConfig` 对象内**逐属性** `setInitializer` + 首次覆盖前 `originals['siteConfig.<key>']` 留档；缺失属性按 body 追加；未提交键零触碰 |
| 13 | `site-config.service.ts:238-253` | `putSiteInfo` 三步序：探针门禁 → `splice*` → 侧车整档合并 + `writeOverride`（`:311-313` 原子写） |
| 14 | `site-config.service.ts:358-366` | `readBaseline` 返回域清单（`siteLang/commentConfig/nav/navRaw/siteInfo/profile/announcement`）——新增特效三档须在此扩展点接入 |
| 15 | `theme-registry.service.ts:143-156` | `assertProbesPass` 按 `targets.includes(probe.target)` 过滤：**未注册的 target 永不拦**（所以「传了新 target」并不等于「有门禁」，K16） |
| 16 | `packages/shared/src/theme-profile.ts:89,249` | 探针档案 `declarationProbes` 是**版本化产物**（`profileVersion` 同档）；扩探针 = 改指纹/漂移基线语义 |
| 17 | `packages/shared/src/site-config.ts:65-67` | 显式不受管键清单（含 `showLastModified` / `pageProgressBar` / `thirdPartyAnalytics` 等）；其中 anime 三键由**另一批次（U3-P4a）**负责解禁，本批**一概不碰**；本批只新增特效域，该清单一行不改 |
| 18 | `packages/shared/src/site-config.ts:340-362` | `ConfigOverrideFileSchema`：`originals: z.record(z.string(), z.string()).optional()`（键名自由 → 特效可用 `musicPlayerConfig.<key>` 形态，无需改该字段） |
| 19 | `apps/web/src/views/posts/PostListPage.vue:176-182` | 「新建文章」按钮位（导入按钮并列落点）；`:192-220` 列表表格（导入完成后 `load()` 刷新即可） |
| 20 | `apps/web/src/api/posts.ts:80-82` | `postsApi.create(body)` 已存在 → 提交阶段零新客户端 |
| 21 | `apps/web/src/views/settings/SiteConfigPage.vue:80,498-689` | `activeSections = ['site-info']`（默认只展开站点信息）+ 五区 `el-collapse`；新分区 `name="effects"` 不入默认 → 天然满足「默认收起」 |
| 22 | `test/p7i-…:32-136,166,223,259-262` | 配置域 spec 的既有范式：fixture `cpSync` 副本 + **spec 内联写 `src/config.ts`**（fixture 里**没有** `config.ts`）+ 逐例 `reset()` 复位 + 清侧车 |
| 23 | `test/p5f-…:31-45` | posts 域 spec 范式：`mkdtemp` + `overrideProvider(BACKUP_OPTIONS)` 指到临时 `mizukiRoot`；真机主题零触碰 |
| 24 | **跨仓** `<mizukiRoot>/src/content.config.ts:7-37` | 主题 posts schema（硬事实）：`title: z.string()` **必填**、`published: z.date()` **必填无默认**、`description: z.string().optional().default("")`（**非必填**）、`image/tags/category/lang/pinned/comment` 可缺省；**schema 中无 `date`、无 `pubDate`**（这两个键不在契约内，zod 对象缺省 strip） |
| 25 | **跨仓** `<mizukiRoot>/src/config.ts:402,556,584` + `:618-630` | `export const musicPlayerConfig` / `sakuraConfig` / `pioConfig` 三个顶层声明；`widgetConfigs = { …, music: musicPlayerConfig, sakura: sakuraConfig, pio: pioConfig, … }`（`:623/625/627`） |
| 26 | **跨仓** `<mizukiRoot>/src/types/config.ts:350-360` | `MusicPlayerConfig` 8 键：`enable / showFloatingPlayer / floatingEntryMode? / mode("meting"\|"local") / meting_api / id / server / type`；`:355` 即 `meting_api: string` |
| 27 | **跨仓** `<mizukiRoot>/src/types/config.ts:415-444` | `SakuraConfig`：`enable / sakuraNum / limitTimes / size{min,max} / opacity{min,max} / speed{horizontal{min,max},vertical{min,max},rotation,fadeSpeed} / zIndex` |
| 28 | **跨仓** `<mizukiRoot>/src/types/config.ts:463-500` | `PioConfig`：`enable / models? / position? / width? / height? / mode? / hiddenOnMobile? / dialog?{welcome,touch,home,skin,close,link,custom[]}` |

> **跨仓抽验说明（据实披露）**：本仓 `docs/refs/mizuki-docs/` **只有 16 篇**，且**没有** `feature/` 与
> `transfer/` 子目录、没有 `feature-*.md`——审计表引用的 `feature/01:12`、`feature/02:17`、
> `feature/03:12`、`transfer/01-10` 在仓内**不可得**（`docs/refs/mizuki-docs/README.md` 的「未快照页面」
> 一节明写 Feature/ 与 transfer/ 未抓）。本机存在主题源码（`apps/server/data/config.json` 的
> `mizukiRoot`，绝对路径不入库），上表 #24~#28 是我对它的**只读抽验**。执行方**仍须**以自己环境的
> `<mizukiRoot>/src/types/config.ts` 与 `<mizukiRoot>/src/content.config.ts` 逐字复核；**键面/类型不符即停下报告**，
> 不得按本文表头照抄当契约。

### 1.1 导入的写盘路径（复用点已定位）

- 目录式 `<posts>/<slug>/index.md`：`postFileAbs`（`posts.service.ts:777-779`）；单文件式 `<posts>/<slug>.md`：
  `postFileFormAbs`（`:782-784`）。两形态共用 `createPost`，冲突为**双向**检测（`:310-318`）。
- 路径监狱：`toMizukiAbs(options.mizukiRoot, rel)`（`common/fs/mizuki-root.ts` → `safeJoin`），越界 403、
  未配置 root 400；slug 已在管道层过 `PostSlugSchema`，落盘前再 `validateSlug`（`:854-856`）。
- 写后出口：`upsertArticleRow`（`:674-693`）保证 `article.slug` UNIQUE 不炸（先 `assertMarkdownSlugFree`），
  **导入无需额外调 `POST /admin/posts/sync`**（K10）。
- `posts` 模块依赖面：`PostsModule` 只依赖 common/infra/shared（`posts.module.ts` 头注），新增预览端点不引入跨模块 import。

### 1.2 配置物化侧（T2 要复用的手法）

`spliceSiteInfo`（`:612-659`）的五个可复用要件：①`getVariableDeclarationOrThrow` 取声明；
②`unwrapExpression` 判对象字面量；③`indentationOf` 取自同层属性（制表符/空格自适应）；
④`valueToTsLiteral`（`data-files/serializer`）序列化；⑤`originals[...]` 首次留档 + `persistConfigTs` 原子落盘。
`readBaseline`（`:358-366`）用 `astToValueWithConsts` 逐个声明求值，`UnsupportedLiteralError` → null（不炸 GET）。

### 1.3 面板现状

`PostListPage.vue` 三 tab（全部/草稿箱/回收站）+ 顶部「新建文章」；`SiteConfigPage.vue` 是「一页一查一存」：
`GET /admin/config` 整体读，各区独立保存按钮，页内已有「保存后需跑 build 才生效」口径（`SiteConfigPage.vue` 头注）。

### 1.4 测试现状

62 文件 = 21 `*.spec.ts` + 41 `*e2e-spec.ts`（`apps/server/test` 实测）。posts 域已用到 `p5`~`p5f`；
config 域已用到 `p7`~`p7j`（`p7k` 由 **U3-P4a** 预留，本包**不得**占用）。`fixtures/mizuki` 下
`src/content/posts/` 仅 `hello-world/`、`relative-images/`、`standalone.md`，**无 `src/config.ts`**。

## 2. 架构裁定 K

### T1 — Markdown 通用导入器（A-GAP-13 ★）

**K1（端点形态：预览只读 + 提交复用）**：新增**唯一**端点
`POST admin/posts/import/preview`，`multipart/form-data`，字段 `files`（多文件），
`@UseInterceptors(FilesInterceptor('files', 30, { limits: { fileSize: 65536 } }))`。
语义：**纯解析、零落盘、零缓存、无会话态**（同一次请求内的批内自查除外）。响应 200 + 逐条结果；
**提交不新增端点**，由面板对每条 `status==='ok'` 的条目调用既有 `POST admin/posts`。
*为什么*：写盘单源只能有一个（`createPost`），预览是只读能力，二者混在一个端点会造出「半写」状态；
而 multipart 是为绕开 §1.0#10 的 100kb JSON 缺省上限（否决：JSON 传全文 —— 30 个 md 必超；否决：抬全局
body limit —— 会放松所有路由的 DoS 面，为一条导入端点不值）。

**K2（三道上限）**：① **单次导入 ≤ 30 文件**；② **单文件 ≤ 65536 字节**（UTF-8）；③ 只接受
`.md` / `.markdown`（大小写不敏感）。30 这个数的**依据是全局限流 60 次/分**（`app.module.ts:33`）：
一次导入最多 1 次 preview + 30 次 create = 31 次请求，留 29 次余量给面板其它请求；超 30 → 面板在选文件
阶段就拒绝（不进网络）。服务端仍要独立设 `maxCount=30`（不信任前端）。*为什么*：不设上限时一次
「全站 md 搬家」会同时压 multer 内存、SQLite 写锁与 60/min 限流，用户看到的是散落的 429/413 而不是
一条可读的拒绝理由。

**K3（frontmatter 映射表：改什么、不改什么）**：

| 输入 | 处置 | 产出键 | 标记 |
|---|---|---|---|
| `published`（`YYYY-MM-DD` / Date / 可解析日期串） | 归一为 `YYYY-MM-DD` | `published` | — |
| `published` 缺 + `pubDate` 有 | **改名** | `published` | `renamed: pubDate→published` |
| `published`/`pubDate` 皆缺 + `date` 有 | 取 `date` 值 | `published` | `renamed: date→published` |
| `pubDate` / `date`（无论是否被采用） | **删除**（主题 schema 无此二键，§1.0#24） | — | `dropped` |
| `cover` 有 + `image` 缺 | **改名** | `image` | `renamed: cover→image` |
| `cover` 有 + `image` 也有 | 删除 `cover`（`image` 为准） | — | `dropped` |
| `title` 缺 | 文件名 stem（去扩展名，**不 slugify**） | `title` | `derived` |
| `published` 三源全缺 | 导入当日（服务器本地日期） | `published` | `derived` |
| `description` 缺 | **不派生**（主题 `default("")`，§1.0#24） | — | `warn`（仅提示） |
| 其余键（含未知键） | `.passthrough()` 原样 | 同名 | — |

*为什么*：只做审计已裁的两处改名（日期→`published`、封面→`image`）+ 两处必要兜底（`title`、`published`
缺失会使主题构建**直接报错**，不是静默跳过）。否决「全量规范化」（tags 字符串切分、category 数组取首、
布尔归一……）：没有一条有主题类型依据，全是猜测式改写用户内容，而导入是**一次性、不可逆**的动作。
`date` 与 `pubDate` 同为「非契约名」，但 `pubDate` 与 `published` 语义完全重复（文档原文「与 published
类似」），保留即制造第二个日期源；`date` 语义不同故**先取值再删除**——值不丢，键不留。

**K4（冲突与失败的语义：四格 + 逐条）**：

| 情形 | 预览 `status` / `code` | 提交行为 |
|---|---|---|
| slug 已占用（目录式 `<slug>/` 或 `<slug>.md`） | `conflict` / `slug-taken` | **不提交**；面板内改 slug（可编辑单元格）后重预览；强行提交仍 409（由 `createPost:310-318` 给） |
| slug 被**富文本**文章占用 | `conflict` / `slug-taken-richtext` | 不提交；强行提交 409（`assertMarkdownSlugFree:702-712` 文案） |
| 批内 slug 重复（第 2 条起） | `conflict` / `duplicate-in-batch` | 不提交 |
| 不冲突 | `ok` | 提交 → 201 |
| 非法 frontmatter（类型/值域，如 `tags: "a,b"`） | `error` / `frontmatter-invalid` + `issues[]{path,message}`（与提交阶段 400 的 `detail.issues` **同形**） | 不提交；强行提交 → 400（K9） |
| 空文件（0 字节或全空白） | `error` / `empty-file` | 不提交 |
| 无 frontmatter 块但正文非空 | `ok` + `derived: [title, published]` + 1 条 `warn` | 提交 → 201 |
| 扩展名非白名单 | `error` / `unsupported-extension` | 不提交 |
| 单文件超限 / 文件数超限 | 请求级：multer 拒绝（413，K2 待证）或自检 400 | — |

**部分失败 = 逐条结果，不做整体回滚。** *为什么*：`createPost` 一次即一个最小事务单元（pre_write 备份 →
原子写 → 索引 upsert → 事件，四步全在一处）；「整体回滚」必须反向 `deletePost` 已成功条目——那会再生成
一批 `pre_write` 备份（顶掉 10 份上限里别人需要的份额）、软删索引、发 `deleted` 事件，且在 slug 冲突场景下
有误删风险。否决「临时目录暂存 + 校验全过才提交」：暂存目录本身要新建写盘旁路（违反 §4-1 单源），
且导入的失败模式（重名、脏 frontmatter）是**可预期**的，逐条列给用户比整体回滚更可用。

**K5（预览响应契约进 shared）**：`packages/shared/src/posts-import.ts` 新增
`ImportPreviewItemSchema` / `ImportPreviewResponseSchema`（`.strict()`）：

```ts
item = {
  name: string,              // 原文件名 basename，仅展示（绝不参与路径拼接）
  ext: string,               // '.md' | '.markdown'
  slug: string,              // 建议 slug = 文件名 stem
  form: 'dir',               // 本批固定目录式（K6）
  status: 'ok' | 'conflict' | 'error',
  code?: 'unsupported-extension' | 'empty-file' | 'frontmatter-invalid'
       | 'date-invalid' | 'slug-invalid' | 'slug-taken' | 'slug-taken-richtext'
       | 'duplicate-in-batch',
  issues: { level: 'warn' | 'error', path: string, message: string }[],
  mapped: { renamed: string[], derived: string[], dropped: string[] },
  frontmatter: Record<string, unknown>,   // 映射后、可直接提交的 frontmatter
  content: string,                        // 已剥离 frontmatter 块的正文
}
response = { items: item[], summary: { total, ok, conflict, error } }
```

`content` 必须回传：面板提交时 `POST /admin/posts` 需要 `frontmatter` 与 `content` 两段，而浏览器**不得**
自行切 YAML（再裁 A）。*为什么*把契约放 shared：前端零本地类型复制（U3-P4a/K3 同款纪律）。

**K6（提交语义）**：对每条勾选且 `status==='ok'` 的条目，`postsApi.create({ slug, frontmatter, content,
form: 'dir' })`，**顺序**发起（不并发：60/min 限流 + SQLite 写锁），逐条收 `201/400/409`。
`form` 固定 `'dir'`。*为什么*目录式：官方文档明示单文件方案会让 RSS 的本地图片路径失效
（`docs/refs/mizuki-docs/press-file.md:5`）；导入是「把别人的文章搬进来」，落最稳形态。

**K7（日期归一实现）**：预览侧对 `published` 只接受 `z.date()` 或 `^\d{4}-\d{2}-\d{2}$`（其它字符串先
`new Date(...)` 试解析，成功则截日期段，失败 → `date-invalid`）。落盘时无需额外处理：
`stringifyPostMarkdown`（`posts.service.ts:823-852`）已把 `published` 的 Date/ISO 形态统一成**裸日期**
（否决：在预览里自己拼 YAML 文本 —— 序列化单源在 `frontmatter.ts:41-50`，自拼必然二次漂移）。

**K8（面板：Markdown 列表页「导入」三步弹窗）**：`PostListPage.vue` 在「新建文章」左侧加「导入」按钮
（同一 `page-header` 行），`el-dialog` 三步：
① **选文件**：`<input type="file" multiple accept=".md,.markdown">`（不用 `el-upload` 的自动上传）；
本地先检 K2 三道上限，超限当场拒绝并列出违规文件（不发请求）。
② **预览表**：文件名 / **slug（可编辑）** / 状态 / 映射变更（`renamed`/`derived`/`dropped` 徽标）/ 问题；
行展开显示**映射后的 frontmatter（只读 JSON 美化）** + 正文前 200 字。「仅提交 ok 条目」+ 逐行勾选。
③ **提交**：进度条（N/M）+ 结果表（201 / 409 / 400 及错误文案）；结束后 `load()` 刷新列表。
**为核对而展示映射后 frontmatter 是硬要求（不是可选项）**：改名/删键是写盘前最后一次可撤销的时点，
用户必须能看见「你原来的 `pubDate: 2025-01-20` 将变成 `published: 2025-01-20`，`cover` 将变成 `image`」。
*否决*「只显示状态不显示 frontmatter」：那等于让用户对不可逆改写盲签。**禁止**在任何前端状态里持久化
导入内容（关闭弹窗即丢弃）。

**K9（服务端不信任预览）**：提交走的 `POST /admin/posts` 本来就重跑 `CreatePostBodySchema` +
`PostFrontmatterSchema`（管道层）→ 400 `detail.issues`。预览结果**不是**提交的前置条件，服务端不缓存、
不回查、不「记住」任何 preview 结果。*为什么*：无状态才不会有「预览通过但文件已被别人改」的 TOCTOU 面。

**K10（索引与事件）**：导入**不调用** `POST /admin/posts/sync`。`createPost` 已 `upsertArticleRow` 并发射
`post.changed`/`content.changed`/`article.published`（`:333-338`）。*否决*「导入后统一 sync 一次」：sync 会
对**盘上全部**文章做对账（`:490-550`），把用户未预期的存量差异一并写入，属越权副作用。

### T2 — 特效非敏感开关（A-GAP-04）

**K11（落点与手法）**：`site-config.service.ts` 新增 `spliceObjectProps(configPath, carrier, declName,
values, keys, kind)`——把 `spliceSiteInfo` 的循环体抽成**通用逐属性置换**（`行为逐字等价`，`spliceSiteInfo`
改为委托），再以三处调用落地：`musicPlayerConfig` / `sakuraConfig` / `pioConfig`。每处：
① 声明缺失或无初始化器 → 404（`profileConfig` 先例）；② 初始化器非对象字面量（`unwrapExpression` 后）
→ 404；③ 属性存在 → `setInitializer` + 首次 `originals['<declName>.<key>']` 留档；④ 属性缺失且 body 含该键
→ `addPropertyAssignment` 追加。**嵌套对象整值置换**（`sakura.size/opacity/speed`、`pio.dialog` 视为一个值，
不递归下钻）。*为什么*整值：递归下钻会让 `originals` 的还原粒度与「用户提交的整体形状」脱节，且主题对
嵌套形状有跨字段使用建议（如 `speed.fadeSpeed` 不得大于最小 `opacity`），服务端做半递归只会造出
「父对象一半是新的、一半是旧的」的怪态。**不触碰** `widgetConfigs` 成员（再裁 C）。

**K12（纳入范围与排除项）**：

| 声明 | 纳管键（逐字） | 值域（只兜「明显非法」） |
|---|---|---|
| `musicPlayerConfig` | `enable` / `showFloatingPlayer` / `floatingEntryMode?` / `mode` / `id` / `server` / `type` | `mode` ∈ `meting\|local`；`floatingEntryMode?` ∈ `default\|fab`；三个字符串 `min(1)` |
| `sakuraConfig` | 全部 7 键 | `sakuraNum` int `0..500`；`limitTimes` int `≥-1`；`size/opacity/speed.*` number；`opacity.*` ∈ `[0,1]` 且 `min≤max`；`zIndex` int `-1000..10000` |
| `pioConfig` | 全部 8 键 | `position?` ∈ `left\|right`；`mode?` ∈ `static\|fixed\|draggable`；`width/height?` int `0..4000`；`models?` `string[]` |

**排除 `meting_api`（硬裁定）**：它是「外链档」里唯一带凭据面的键——主题默认值就是
`https://meting.mysqil.com/api?server=:server&type=:type&id=:id&auth=:auth&r=:r`（`config.ts:407-408`），
`auth=` 段在真实部署里常被填成第三方 token/签名。纳管 = 一个「读回即泄密」的键进面板（GET 回显、错误
detail 回显、日志回显三条泄密面都要单独加掩码），而收益只是「省一次手改」。故**维持手改 `config.ts`**。
**若将来要纳管的前置条件**（写进 ADR 再动）：① 复用 U3-P4a 的 `masked` 契约（GET 只回 `••••`+末 4，
永不回明文）；② PUT 空值 = **保持不变**（不是清空）；③ 该键不得进 `operation_log` / pino / 任何响应；
④ 补一条「响应体字符串 grep 断言不含原值」的 e2e。四条缺一不许开工。

**K13（shared schema + 侧车）**：`packages/shared/src/site-config.ts` 新增
`SiteMusicPlayerSchema` / `SiteSakuraSchema` / `SitePioSchema` 与聚合 `SiteEffectsSchema`（三键全可选、`.strict()`；
**`meting_api` 不在任何 schema 内**——`.strict()` 因此天然把带 `meting_api` 的请求判 400，这是排除项的
机械保证，不靠人记）。`ConfigOverrideFileSchema` 增 `effects: SiteEffectsSchema.partial().optional()`
（缺键 = 未设置 = 基线生效）。`originals` 键名：`musicPlayerConfig.<key>` / `sakuraConfig.<key>` / `pioConfig.<key>`
（`originals` 本就是自由 `record<string,string>`，字段零改动）。

**K14（路由与视图，additive）**：`site-config.controller.ts` 增
`PUT admin/config/effects`（body = `SiteEffectsSchema`，`.strict()` 越界 400，200 返回 `AdminSiteConfigView`）；
`AdminSiteConfigView` 增两字段：`effects: Partial<SiteEffectsValues> | null`（override 优先、逐键回落基线）与
`baselineEffects: Partial<SiteEffectsValues> | null`（基线逐声明求值，`UnsupportedLiteralError` → 该声明 null）。
`putEffects()` 三步序与 `putSiteInfo` 逐字同构（探针 → splice → 侧车 + `writeOverride`）。
**不变量**：`PUT /site-info` 的 15 键契约、`SITE_INFO_KEYS`、`siteConfig` 域既有 `originals` 键形**零变化**。

**K15（面板：站点配置页「特效」分区）**：`SiteConfigPage.vue` 增第六区 `el-collapse-item name="effects"
title="特效"`，**不进** `activeSections` 默认值（`:80` 现为 `['site-info']`）→ 默认收起。三子表：
音乐播放器（7 键，附一行灰字「`meting_api` 含凭据，不在面板管理，请手改 `src/config.ts`」）、樱花（7 键）、
看板娘（8 键，`dialog` 走 JSON textarea 兜底，复用 `banner`/`font` 的既有 JSON 兜底形态）。
保存走 `PUT admin/config/effects`；页内提示「保存后需跑一次 build 才在站点生效」。

**K16（探针轴不扩，缺口登记）**：**不**在 `theme-profile.ts` 的 `declarationProbes` 里加特效三档。
理由：探针档案与 `profileVersion`、漂移指纹基线同档（`theme-profile.ts:89,249`），扩条目会牵动既有
`p4e3a`（theme-lock 双轴与门禁）的漂移语义，属另一个批次的裁定面；且 `assertProbesPass` 对未注册 target 本就静默放行
（`:143-156`）——写成「传了新 target」是**假门禁**，比不做更糟。替代：`splice` 内就地做「声明存在 +
对象字面量形态」检查（K11 ①②）。**已知缺口（执行方必须在报告里原文登记）**：`effects` 目前无探针轴
保护，主题升级到结构不符时只能靠 splice 的 404 兜住（不会误写，但错误文案不如探针明细）。

**K17（台账）**：`docs/audits/feature-alignment/README.md` §8.1 的 A-GAP-13 / A-GAP-04 行标注
「已交付（U3-P4c）」；`docs/SESSIONS.md` 交付段 + `CHANGELOG.md` 批次条目 + `AGENTS.md` §5 `posts` 行补一句
「Markdown 导入（预览只读 + 逐条复用 create）」。交付报告落 `docs/audits/u3-p4c/README.md`。

## 3. 不变量 I

- **I1 零新依赖**：`pnpm-lock.yaml` 与四处 `package.json` 依赖清单零变动；解析用既有 `gray-matter`，
  多文件上传用 `@nestjs/platform-express` 已导出的 `FilesInterceptor`（**本仓首次使用该变体**，须在报告贴出
  它来自既有依赖的自证，例如 `node_modules/@nestjs/platform-express` 的导出清单）。
- **I2 写盘单源**：导入的唯一写盘 = `PostsService.createPost`（预览零写）；特效的唯一写盘 =
  `spliceObjectProps` + `writeOverride`（`atomicWriteFile`）。**全仓禁裸 `fs.writeFile`/`writeFileSync` 落
  Mizuki 根下文件**（AGENTS §4-1）；测试里对 `config.ts` 的写入只允许发生在 `mkdtemp` 临时域。
- **I3 公开 API `/public/**` 零 diff**（本批不触）。
- **I4 管理 API 仅 additive**：新增 `POST admin/posts/import/preview` 与 `PUT admin/config/effects`；
  `AdminSiteConfigView` 增 `effects` / `baselineEffects`。既有路由的成功状态码与错误形状**零变化**
  （`POST /admin/posts` 仍 201、409、400 —— 只是多了一个调用方）。
- **I5 secret 面**：`meting_api` 不出现在任何 schema / 响应 / pino / `operation_log` / 错误 detail。
  导入日志只记 `{ total, ok, conflict, error }` 计数与 `name`，**不记** `content`/`frontmatter` 全文。
- **I6 路径安全**：导入**不接受任何路径入参**——`files[].originalname` 只用于展示与 slug 派生；
  slug 过 `PostSlugSchema`（`segment-name.ts:36-44` 单源）后由 `toMizukiAbs`/`safeJoin` 落盘；导入内容中的
  `image` 等字段仍是普通 frontmatter 字符串（不解析为路径，与既有 posts 行为一致）。
- **I7 测试隔离**：新 spec 全部 `mkdtemp` + `cpSync(fixtures/mizuki)` 副本 + `overrideProvider(BACKUP_OPTIONS)`；
  **绝不**对真实主题目录写入（AGENTS §4-9）；`effects` spec 的 `config.ts` 由 spec 内联写入（§1.0#22 范式）。
- **I8 富文本零参与**：`modules/articles/**` 一行不动；导入只产 markdown posts（`source_type='markdown'`）。
- **I9 不 push、不删文件、不动 `.git/`**；提交只在执行批次内一次成批。
- **I10 数账**：只计全绿轮；本批净增 **+18~21 用例 / +2 文件**（明细见 §4）。

## 4. 测试落位

> 命名空间已核：`p5g` 未占用（posts 域现用 `p5`~`p5f`）；
> **特效 spec 一律用 `p7m`**（`p7k` 由 U3-P4a 占用、`p7l` 由 U3-P4b 预留 —— 本包不得占用，2026-10-21 订正）。

**新建 `apps/server/test/p5g-posts-import.e2e-spec.ts`（建议 9 例）**

1. 无 frontmatter 的单文件（正文非空）→ `ok`，`frontmatter.title` = 文件名 stem，`published` = 当日，
   `mapped.derived` 含两键，`status` 仍 `ok` + 1 条 `warn`。
2. 三漂移名齐上（`published`+`pubDate`+`date`+`cover`）→ 产出键集**只**有 `published` / `image`，
   `mapped.renamed` / `mapped.dropped` 与 K3 表逐项对齐。
3. `published` 已存在 + `pubDate` 另有值 → 以 `published` 为准，`pubDate` 仍被删除。
4. 非法 frontmatter（`tags: "a,b"` 字符串）→ `status: 'error'`、`code: 'frontmatter-invalid'`、
   `issues[0].path === 'tags'`；**整批不因此失败**（同批另一条 ok 仍为 ok）。
5. 空文件（0 字节）→ `empty-file`；`.txt` → `unsupported-extension`；`published: "2025-13-45"` → `date-invalid`。
6. slug 冲突：先 `POST /admin/posts` 建同 slug 文章 → 预览 `conflict` / `slug-taken`，且预览前后
   `src/content/posts/` 文件清单与 `config.ts` 字节**零变化**（只读性自证）。
7. 批内重复 slug → 第 2 条 `duplicate-in-batch`，第 1 条仍 `ok`。
8. 提交链：对 ok 条目 `POST /admin/posts` → 201；盘上 `posts/<slug>/index.md` 存在且 frontmatter 里
   `published:` 是**裸日期**（正则断言，防引号回归）；`GET /admin/posts` 出现该 slug（索引已 upsert）。
9. 上限：31 个文件一次 preview → 请求级拒绝（**实际状态码 400 还是 413 以实测为准，报告须写明**；
   若不来自 multer 而是自检，则必须是我们自己的 400 + code）。

**新建 `apps/server/test/p7m-site-effects.e2e-spec.ts`（建议 9~10 例）**

1. 无 override → `effects` 三键 = 基线值（`config.ts` 内联基线含三声明）。
2. `PUT effects { musicPlayer: { enable:false, mode:'meting', id:'x' } }` → 仅三键物化；同一对象其余键、
   同文件其余声明、**所有注释**逐字节不变。
3. body 含 `meting_api` → **400**（`.strict()`），且 `config.ts` 字节零变化（排除项的机械保证）。
4. `originals['musicPlayerConfig.enable']` 留档出现，内容 = 原初始化器文本。
5. 第二次 PUT 同键 → `originals` 不变（首次原文本保留）。
6. `sakura` 嵌套整值置换 + `pio.dialog` 整值置换同时提交 → 两声明各自物化，`musicPlayerConfig` 零触碰。
7. 值域越界（`sakura.sakuraNum: -1` / `zIndex: 1e9` / `pio.width: 0`）→ 400，零物化。
8. 基线缺 `pioConfig` 声明 → `PUT` 404 零物化；`GET` `effects.pio = null` / `baselineEffects.pio = null`。
9. `widgetConfigs` 的 `music: musicPlayerConfig` 行**逐字不变**（防再裁 C 被违反）。
10. `PUT /admin/config/site-info` 回归：15 键契约与响应形状不变（`baselineEffects` 不干扰既有字段）。

**既有 spec 必跑回归**：`p5` / `p5b` / `p5d` / `p5e` / `p5f`（posts 写入口与 frontmatter）、
`p7f` / `p7h` / `p7i`（config 域物化与隔离）、`p6-auth` 与 `p2b-t4-auth-system`（鉴权边界）、
`p9` / `p9b`（若 K2 的实现改动了 bootstrap 或拦截器装配）。

## 5. 验收口径与纪律

- **三连全绿**才交：`pnpm --filter @mizuki/shared build` → `pnpm test`（全量单批 `--maxWorkers=1`）→
  `pnpm build` → `pnpm lint`（0/0）。数账申报格式：`test N/N（64 文件全绿单批）/ build 0 / lint 0:0`，
  并在报告里写清「基线 546/62 → 本批 N/N（64 文件）」。
- **禁**：改 `SITE_INFO_KEYS` 或 `PUT /site-info` 契约；把 `meting_api` 放进任何 schema；置换 `widgetConfigs`
  成员；在服务端新增第二条 posts 写盘路径；让预览端点产生任何写（含临时文件）；抬全局 body parser 上限；
  新增依赖；改主题源码（含 `<mizukiRoot>/src/**`）；除 K17 台账三项与 `docs/audits/u3-p4c/` 报告外，
  **不改任何既有文档**（`docs/refs/` 尤其不动）。
- 发现本包事实基座与实况不符（行号漂移、主题 `types/config.ts` 键面不同、`content.config.ts` 的
  `published`/`description` 必填性不同、multer 上限错误不是 413）→ **停下报告**，不自行放宽、不照抄本文当契约。
- 报告必含：K1~K17 / I1~I10 逐条对照、`git diff --stat`、新增用例明细与文件数、**只读性自证**
  （预览前后 posts 目录与 `config.ts` 的 diff 为空）、`meting_api` 排除的机械证据（`grep -rn meting_api
  apps/server/src packages/shared/src` 应为零命中 + 第 3 例的 400 实录）、主题两文件实读片段、偏差披露。

## §commit（建议，执行方可按实际拆分，但**禁 push**）

```
feat(U3-P4c): Markdown 通用导入器（预览只读 + 逐条复用 createPost）与特效非敏感开关纳管
```
