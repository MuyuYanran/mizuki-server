# U3-P2 交付报告 — frontmatter 补键 / 相册引用注册表 / 导航接管确认

> 执行日期 2026-10-19。指令包：`docs/prompts-ui/U3-P2-frontmatter-album-nav.md`（K1–K8 / I1–I8 / T1–T6）。
> 起始 HEAD = `2b22479`（U3-P1，基线 505/505、58 文件）。
> **完成即停**：工作树改动未提交、未 push，等架构师复核。

---

## 0. 未列文件改动说明（必读）

指令包 §2 K2–K8 与 §4 T1–T5 未逐条点名的文件，本批实际动了两处，理由如下：

1. **`apps/server/src/modules/posts/posts.service.ts` 的 `stringifyPostMarkdown`（裸日期归一扩至 `updated`）**
   —— K2 要求 `updated: DateLikeSchema.optional()`，但没有这个改动时落盘形态是 `updated: '2026-05-06'`
   （js-yaml 对日期形字符串恒加引号，既有注释里就有实证）。主题 `content.config.ts:10` 是
   `updated: z.date().optional()` —— 带引号的字符串进 Astro 校验会被**拒**（string 不是 Date），
   等于**每次保存更新时间都在给主题埋一个构建期雷**。故把原有的 `published` 裸日期归一
   （S3/B1b 既有机制）扩到 `updated`，用 `BARE_DATE_KEYS = ['published', 'updated']` 驱动，两键同构。
   这是修 `updated` 落盘形态的**必要**改动，不是顺手改。

2. **`docs/audits/feature-alignment/README.md` 附录小节被 `## 6` 顶到末尾位置** —— 非产品改动，纯文档章节序；
   改判小节插在附录之前，附录标题原位保留（已复核 8 个 `##` 段落齐全）。

其余文件改动均在指令包点名的面内（§8 变更清单逐条对应 K 条款）。

---

## 1. 交付面

| # | 条款 | 落点 | 变更 |
|---|---|---|---|
| 1 | K2 | `apps/server/src/modules/posts/posts.service.ts` | `PostFrontmatterSchema` +7 键；`NULL_DELETE_KEYS` 6→12；`stringifyPostMarkdown` 裸日期键扩至 `updated` |
| 2 | K3 | `apps/web/src/views/posts/PostEditPage.vue` | `fm` +7 状态；`populateForm` 七键回填；`buildFrontmatter` 七键提交；`KNOWN_FM_KEYS` 16→23；`onDatePick` 联合类型 +`'updated'`；7 个表单项 |
| 3 | K4 | `apps/server/src/modules/albums/albums.service.ts` | `collectReferences()` 实装（cover + photos[].src）+ `toMediaPath()` 归一 + `normalizeUserPath` 导入 + 两处过时注释改写 |
| 4 | K5 | `apps/server/src/modules/site-config/site-config.service.ts` | `AdminSiteConfigView.baselineNavRaw: string \| null`；`readBaseline` 返回 `navRaw` |
| 5 | K6 | `apps/web/src/views/settings/SiteConfigPage.vue` + `apps/web/src/api/config.ts` | `baselineNavRaw` / `navUnmanaged` ref；折叠区原文对照；`onSaveNav` 接管二次确认（单次弹窗合并空导航情形）；API 类型 +1 字段 |
| 6 | K7 | `packages/shared/src/site-config.ts` + `SiteConfigPage.vue` + `p7i` | `wallpaperMode` 去 `.optional()`；注释改「4 可选 / 11 必填」；`SITE_INFO_OPTIONAL_KEYS` 注释同步（运行时自省，key 自动退出） |
| 7 | K8 | 4 个测试文件 | 见 §2 |
| 8 | K1 | `docs/audits/feature-alignment/README.md` + SESSIONS + CHANGELOG | A-GAP-06 改判销案 + 证据小节；四行销账标注 |

---

## 2. 用例明细（I5 数账）

**净增 18（505 → 523）**，落在 4 个文件：

### 2.1 `p5f-posts-frontmatter-extra-keys.e2e-spec.ts`（新建，7 用例）

| 用例 | 断言 |
|---|---|
| ① 七键创建往返 | 201；落盘 YAML 含 `updated` 裸日期 / `priority: 7` / `alias` / `passwordHint` / `licenseName` / 两 URL；GET 回读七键值一致 |
| ② PATCH 单键合并 | 只送 `priority: 9` → 其余六键存量保留（`alias`/`passwordHint`/`licenseName`/`licenseUrl`/`sourceLink`/`updated`） |
| ③ null 删键逐键 | `alias`/`priority`/`passwordHint` 送 null → 盘上三键**消失**，`licenseName`/`licenseUrl`/`sourceLink` 存活；GET 三键 `undefined` |
| ④ updated 无删键路径 | PATCH 缺 `updated` → 存量 `updated: 2026-05-06` 保留（与 date/pubDate 同口径） |
| ⑤ 类型错 400×2 | `priority: 'high'` → 400；`updated: {nope:true}` → 400；两者后盘上字节零变化 |
| ⑥ passthrough 回归 | 非七键未知键 `customUndeclaredKey: {nested:[1,2,3]}` 原样保留 |
| ⑦ deriveStatus 回归锚 | `draft:false` + published 日期 → 列表 `status === 'published'`（七键不影响状态推导） |

### 2.2 `p7j-album-cover-references.e2e-spec.ts`（新建，8 用例）

| 用例 | 断言 |
|---|---|
| ① cover=`/images/uploads/x.png` | 删媒体 **409**；`detail.references` 含 `refType='album-cover'` 且 `targetLabel='u3p2-cover-site'`；媒体文件仍在盘上 |
| ② cover=`public/images/uploads/x.png` | 同一精确串等对账 **409**（mediaPath 原样直通） |
| ③ cover=`https://cdn…` | 删媒体 **200**（外链不归媒体库管） |
| ④ `photos[].src` 站点形态 | **409** + `refType='album-photo'` + 相册名 |
| ⑤ cover=裸文件名 `cover.jpg` | **200**（裸名不可能命中 mediaPath，按 K4 跳过） |
| ⑥ 动态重扫 | 改 cover 为外链后同一媒体**可删**（注册表非缓存快照） |
| ⑦ 本地相册回归 | `mode=local` 相册 + 本地图片上传 → 媒体删除 **200**（不入注册表） |
| ⑧ 贡献者形状 | `registry.collectAll()` 返回数组；每条 refType/targetLabel/mediaPath 三字段字符串且 mediaPath 含 `/` |

### 2.3 `p7f-config-override.e2e-spec.ts`（增量 +2 → 16 用例）

基线 `BASELINE_CONFIG_TS` 追加 `export const navBarConfig`（含 `LinkPreset.Home` / `LinkPreset.About`，一个顶层项 + 一个含 children 的项）；新增 `BASELINE_NO_NAV` 变体。

| 用例 | 断言 |
|---|---|
| ⑯ baselineNavRaw 有值 | `baselineNav === null`（解析不可得）**但** `baselineNavRaw` 含 `LinkPreset.Home` / `LinkPreset.About` / `name: "关于"` |
| ⑰ baselineNavRaw 缺失态 | 声明整体缺失 → `baselineNav === null` ∧ `baselineNavRaw === null`（用例末尾复位基线，防污染同文件其他用例） |

### 2.4 `p7i-site-sidepanel-override.e2e-spec.ts`（原位改写 1 + 新增 1 → 16 用例）

| 用例 | 变更 |
|---|---|
| ④ 可选键缺省零触碰 | **原位改写**：原用 `tagStyle` + `wallpaperMode`；因 K7 收紧，改用 `tagStyle` + `siteStartDate`（两个仍为可选者），零触碰语义不变（不新增属性、不落侧车键、原值 `useNewStyle: true` / `siteStartDate: "2024-01-01"` 保留） |
| ④b（新增） | 缺 `wallpaperMode` → **400** 且 `config.ts` 零物化、侧车文件不存在 |

### 2.5 回归锚（未改但必须绿）

`p5` / `p5b` / `p5c` / `p5d` / `p5e`（frontmatter 面）、`p7` / `p7b` / `p7c` / `p7d`（相册媒体面）、`p7f` ①–⑮（config 面）、`p7h`（隔离）、`p7i` ①–③⑤–⑮ —— 全绿。

---

## 3. 三连实录

```
$ pnpm build
packages/shared build: Done
apps/server build: Done
apps/web build: vue-tsc --noEmit 0 错 → vite ✓ 1914 modules / 31.45s
EXIT=0

$ pnpm lint
$ eslint .
EXIT=0   （0 error / 0 warning）

$ cd apps/server && vitest run --maxWorkers=1
 Test Files  60 passed (60)
      Tests  523 passed (523)
EXIT=0
```

单文件轮次留痕：p5f 7/7（1622ms）、p7j 8/8（2619ms）、p7f 16/16（2602ms）、p7i 16/16（2423ms）。

数账：**505 → 523（+18）**，文件 58 → 60（+2，p5f / p7j）。
与指令包预估 521~522（+16~17）差 1~2：p7j 按 K8 建议清单做了 8 条（预估 7），p7i 改写 + 新增各 1 记 2 条（预估 +1），p7f 恰 +2。**无遗漏、无凑数**，逐条对得到 §4 T 的清单。

---

## 4. K / I 对照

### 4.1 K 条款

| 条款 | 状态 | 落实要点 |
|---|---|---|
| K1 改判销案 | ✅ | 仅台账：audit README `## 6` 新节（四条证据链）+ 表行改判 + §5 批次表划改 + SESSIONS 记录。**零产品代码、零测试**——未写「断言主题 build 脚本含 pagefind」这类耦合测试 |
| K2 服务端 schema | ✅ | 七键类型逐字对齐主题：`updated: DateLikeSchema.optional()`（**无删键路径**）、`priority: z.number().nullable().optional()`（无 min/max）、其余五键 `z.string().nullable().optional()`；`NULL_DELETE_KEYS` 6→12；`prev*` 四键不入 schema |
| K3 面板七键 | ✅ | 状态 / 回填 / 提交三处齐；`priority` 回填 `typeof === 'number'` 否则 null；提交用 `?? null`（0 是合法权重，不用 `\|\|`）；五字符串键 `\|\| null`（空串 = 删键）；`updated: fm.updated \|\| undefined`；`KNOWN_FM_KEYS` 16→23；表单项位置与标签逐字按 K3（更新时间贴日期区、别名贴 permalink、排序权重贴置顶、密码提示贴密码、许可证三键连续一组置评论设置之后） |
| K4 注册表 | ✅ | `http(s)` 跳过 / `public/` 原样 / `images/` 拼 `public/` / 其余（含裸名）跳过；`refType` 双值 `album-cover` / `album-photo`，`targetLabel` = 相册名；单相册失败 warn 跳过；`mizukiRoot === ''` → `[]`；两处过时注释改写；**media 模块、`shared/media-reference.ts` 零改动** |
| K5 服务端 baselineNavRaw | ✅ | `AdminSiteConfigView.baselineNavRaw: string \| null`；`navInit.getText()`（初始化器原文）；声明缺失 → null；解析成败均照给；公开 API 零变动 |
| K6 面板导航 | ✅ | `baselineNavText` 优先、否则 `baselineNavRaw` 原文（标签「主题默认导航（原文对照，含 LinkPreset 预设，只读）」+ 复用 `nav-baseline-pre`）；接管确认：`nav === null ∧ baselineNav === null` 时 links 非空 → 接管确认；links 为空 → **同一弹窗**内接管提示 + 空导航提示（单次确认，不叠两次）；override 已存在 → 维持现状；既有 alert / 还原按钮 / children 帮助文案未动 |
| K7 wallpaperMode | ✅ | `site-config.ts` 去 `.optional()`；注释改「4 可选 / 11 必填」；`SITE_INFO_OPTIONAL_KEYS` 注释同步（集合运行时自省，键自动退出）；p7i ④ 改键 + ④b 新增 400 用例；探针宽松视图与侧车 `.partial()` 未动 |
| K8 测试落位 | ✅ | 新文件 `p5f-…`（p5 命名空间）、`p7j-…`（**跳过 p7g**）；`p7f` 增量；`p7i` 原位改 + 增；fixture 全部 mkdtemp |

### 4.2 不变量

| 不变量 | 核验 |
|---|---|
| I1 零新依赖 | `pnpm-lock.yaml`、根/`apps/server`/`apps/web` 三处 `package.json` 均零变动（`git status` 无此四文件） |
| I2 红线 | 写盘路径零新增（本批唯一写盘相关改动是 `stringifyPostMarkdown`，属既有写管线内）；测试全走 mkdtemp；真实主题目录零写入；未碰 `.git/`；未 push |
| I3 公开 API 冻结 | `/public/**` 零 diff；管理 API 仅 `AdminSiteConfigView` +1 字段（K5 增量，U3-P1 先例） |
| I4 分层 | albums 贡献者留在 albums 模块（`albums.module.ts` 未动，四贡献者同构）；L2 互不 import（albums 仅依赖 `common/fs/posix` 与 shared 类型）；`media` / `shared/media-reference.ts` 零改动 |
| I5 数账 | 净增 18，详见 §2；全绿轮计入 |
| I6 三连 | 全绿，见 §3 |
| I7 UI 零扩张 | 无新路由 / 菜单 / 组件文件；七表单项入既有 `fm-sidebar` el-form；导航改动限既有 collapse 区 |
| I8 存量零迁移 | 七键读取沿用 passthrough；`populateForm` 回填后不再显示为「未知键」（行为改善）；无库表 / 无数据迁移 |

---

## 5. 已知限制（本批引入或保留）

1. **`updated` 无删键路径** —— 与 `date` / `pubDate` 一致：空值不写键、PATCH 缺键保留存量。想彻底删掉该键只能手工编辑文件。K2 明文如此，非疏漏。
2. **相册引用只覆盖外链模式** —— 本地模式相册的图片由相册目录自持（不经媒体库），故 `collectReferences` 对其返回零引用；`mode=local` 的 `cover` 字段在 schema 里不存在。
3. **裸文件名封面不登记** —— `cover: 'cover.jpg'` 之类的值跳过不拦。原因：`media_file.path` 恒含 `/` 且以 `public/` 起头，裸名精确串等永远不命中，登记只会产生噪声引用（代码注释已写明）。
4. **children 一层封顶维持** —— A-GAP-10 的 children 深度上限属 ADR-020 已知限制，K6 明确「本批不动」。
5. **接管确认只在「首次接管」出现** —— override 已存在（`nav !== null`）后再保存不再弹接管提示，只保留空数组确认。这是 K6 的明文口径（避免每次保存都弹）。
6. **`baselineNavRaw` 是原文不是结构化数据** —— 面板只读展示，不可编辑回填。因为 LinkPreset 无法反序列化成可编辑 JSON，能做的是「让用户看见」，不是「让用户改」。

---

## 6. 偏差清单

| # | 偏差 | 缘由 |
|---|---|---|
| 1 | `stringifyPostMarkdown` 裸日期归一扩到 `updated`（未列文件） | 见 §0-1。不改则 `updated` 以带引号字符串落盘，主题 `z.date()` 构建期拒收 |
| 2 | `p7j` 做 8 用例（K8 建议清单列了 7 项） | 建议清单是「建议」；补的 ⑧ 是贡献者形状断言（机制可调用 + ref 三字段合法），用于兜「注册表被整体绕过」这类静默失效 |
| 3 | `p7f` 基线新增 `navBarConfig` 声明（原基线无该声明） | K5/K8 要求验证 `baselineNavRaw`；无声明则无从验证。既有 16 用例的断言面不依赖 navBarConfig 存在与否，已全绿复核（①–⑮ 全部通过） |
| 4 | `p7f` ⑰ 用例末尾主动复位基线 | 该 spec 用例按文件序共享状态；不复位会让后续用例读到无 nav 的 `config.ts`。复位是测试自身卫生，不影响被测语义 |
| 5 | `p7i` ④ 改用 `siteStartDate` 而非 `navbarTitle`/`pageScaling` | K7 授权「执行方按 fixture 现状选」；基线里 `siteStartDate` 有确定值 `"2024-01-01"`，断言最硬（能同时证「原值保留」与「不落侧车键」） |
| 6 | `SiteConfigPage.vue` 的 `SITE_INFO_OPTIONAL_KEYS` 未改代码、仅改注释 | 该集合由 runtime ZodOptional 自省生成，`wallpaperMode` 收紧后自动退出；硬编码移除反而与自省机制矛盾 |
| 7 | `docs/audits/feature-alignment/README.md` 新增 `## 6` 小节 + 附录标题位置保持 | 附录本在末尾，新节插在其前；中途一次编辑误删附录标题，已即时恢复（8 个 `##` 段齐全，`git diff` 复核） |
| 8 | `p5f` ① 断言 URL 值不逐字带引号 | js-yaml 对含 `:` 的 URL 值加单引号是合法 YAML 保护，语义不变；断言改为 `toContain('licenseUrl:')` + `toContain('<url>')` 两段，避免把序列化细节钉死成契约 |

---

## 7. 变更清单（`git status`）

**修改 12 个文件**

```
docs/SESSIONS.md                                    （U3-P2 交付段）
CHANGELOG.md                                        （U3-P2 批次条目）
docs/audits/feature-alignment/README.md             （A-GAP-06 改判 + 四行销账）
packages/shared/src/site-config.ts                  （K7）
apps/server/src/modules/posts/posts.service.ts      （K2 + 裸日期归一）
apps/server/src/modules/albums/albums.service.ts    （K4）
apps/server/src/modules/site-config/site-config.service.ts（K5）
apps/server/test/p7f-config-override.e2e-spec.ts    （K8/⑯⑰）
apps/server/test/p7i-site-sidepanel-override.e2e-spec.ts（K7/④④b）
apps/web/src/api/config.ts                          （K6 类型）
apps/web/src/views/posts/PostEditPage.vue           （K3）
apps/web/src/views/settings/SiteConfigPage.vue      （K6 + K7 注释）
```

**新增 3 项**

```
apps/server/test/p5f-posts-frontmatter-extra-keys.e2e-spec.ts   （7 用例）
apps/server/test/p7j-album-cover-references.e2e-spec.ts         （8 用例）
docs/audits/u3-p2/README.md                                     （本报告）
```

**红线 grep 零触碰**（本批未出现在 `git status` 即证明）：`backup.service.ts`、`posts`/`media`/`collections`/`articles` 模块内其余文件、路由表、`MainLayout.vue`、`vite.config.ts`、`pnpm-lock.yaml`、三处 `package.json`、`/public/**`。

---

## 8. 建议提交信息（待架构师复核 + 显式许可后）

```
feat(posts+albums+config): U3-P2 frontmatter 七键 / 相册引用注册表 / 导航接管确认（基线 523）

- A-GAP-09 闭环：updated/priority/alias/passwordHint/licenseName/licenseUrl/sourceLink
  入写入口 schema + NULL_DELETE_KEYS（6→12）+ 面板七表单项，KNOWN_FM_KEYS 16→23
- updated 落盘归一为裸日期（主题 z.date() 拒收带引号字符串），与 published 同口径
- B-P2-09 闭环：albums.collectReferences 实装，cover + photos[].src → mediaPath 归一
  （/images/ → public/images/），media 模块零改动
- A-GAP-10 强化：AdminSiteConfigView +baselineNavRaw（原文对照）+ 面板接管二次确认
- A-GAP-06 改判销案（审计误诊：主题 build 已内联 pagefind），仅台账
- K7: wallpaperMode 收紧为必填（对齐主题类型）
- 测试 +18：p5f(7) / p7j(8) / p7f(+2) / p7i(+1，改1)
```
