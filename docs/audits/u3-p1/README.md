# U3-P1 配置域一期：站点信息档 + 侧栏内容 — 交付审计

> [签发] 架构师 2026-10-19，指令包 `docs/prompts-ui/U3-P1-site-config-domain.md`（K1~K10）。
> [授权] 用户当轮明示「请你根据提示词完成任务，不用验收」= 执行方授权；验收由架构师复核。
> [结论] T1~T6 全绿：受控面 3 对象 → 6 对象（siteInfo 15 键 / profileConfig /
> announcementConfig），走满 ADR-020 既有链路，**零新机制、零新依赖**；
> 验收三连 build 0 / lint 0·0 / test **505/505（58 文件）**。

## 0. 未列文件改动说明（红线 §6.8「完成即停」要求）

指令包预计改动 ≈10 文件；实际 11 改 + 1 新增。以下三处**不在** K 条款点名的文件清单内，改动缘由逐条说明：

| 文件 | 改动 | 缘由 |
|---|---|---|
| `apps/server/src/modules/data-files/evaluator.ts` | `astToValueWithConsts` 增 `case SyntaxKind.ArrayLiteralExpression` | K2 要求 siteInfo 逐键基线解析，`banner.src` / `font.*.localFonts` 等受管键的值是数组字面量。原求值器只处理对象/字符串/数字/布尔/标识符，数组字面量抛 `UnsupportedLiteralError` → 这些键基线恒 null、面板永远空起步、且「基线缺键才插入」的分支无法与「基线有值」区分。属 K2「未支持节点该键 null」的前置能力补齐，非新增机制。 |
| `apps/web/src/lib/schema-form/SchemaForm.vue` | 分组（`widget==='group'`）分支由「单层 children + number/其余=el-input」改为「路径化行表递归 + switch/select/number 分派」 | K5 要求 13 个 siteInfo 键走 schema-form，其中 `themeColor.fixed` / `featurePages.*`（8 布尔）/ `postListLayout.categoryBar.enable` 是分组内布尔、`wallpaperMode.defaultMode` / `postListLayout.defaultMode` 是分组内枚举、`toc.depth` 是分组内数字。原分组分支只认 `number`，其余一律渲染成文本框 → 布尔会变成字符串 "false"、枚举变成自由输入，落盘即 400。属 K5 分派的前置能力补齐；分组外渲染路径（顶层 switch/select/number/date/json/tags）**零改动**。 |
| `apps/server/test/p4e3a-theme-lock.e2e-spec.ts` | 内联 `BASELINE_CONFIG_TS` additive 追加 `profileConfig` / `announcementConfig` 两条声明（+18 行） | K6 要求档案 `declarationProbes` 新增这两个靶点。该 spec 的 ③（capture → clean）与 ⑥（无基线探针全绿）断言「完好 fixture → 全部探针 passed」，fixture 里缺这两条声明则断言必然失败。**只增声明、未改任何既有断言语义**（符合 I2「只许因新增字段断言而增量扩充」）。LINKS_BROKEN 变体未动（它只用于 ⑫ 的 nav 形态门禁，且 409 断言按 target 过滤）。 |

另：`apps/server/test/zz-tmp-format-probe.spec.ts`（用于实测物化缩进形态的一次性探针）已**移出** `test/`（移动到 gitignored 的 `.test-tmp/zz-probe/`，未删除），故最终工作树 `test/` 下只新增 p7i 一个文件。

## 1. 交付面（6 对象受控面）

| 对象 | 端点 | 物化形态 | originals 留档键 |
|---|---|---|---|
| `siteConfig.lang` | `PUT /admin/config/lang`（既有） | 逐属性置换 | `siteConfig.lang` |
| `commentConfig` | `PUT /admin/config/comments`（既有） | 整声明置换 | `commentConfig` |
| `navBarConfig` | `PUT /admin/config/nav`（既有） | 整声明置换 + 清除端点 | `navBarConfig` |
| **`siteInfo`（siteConfig 15 键）** | **`PUT /admin/config/site-info`（新）** | **逐属性置换 / 缺失插入** | **`siteConfig.<key>` × 15（首次）** |
| **`profileConfig`** | **`PUT /admin/config/profile`（新）** | **整声明置换** | **`profileConfig`** |
| **`announcementConfig`** | **`PUT /admin/config/announcement`（新）** | **整声明置换** | **`announcementConfig`** |

siteInfo 15 键 = `title / subtitle / siteURL / siteStartDate / timeZone / themeColor / featurePages /
navbarTitle / postListLayout / tagStyle / wallpaperMode / banner / pageScaling / font / toc`。
**不受管（schema 与 splice 一概不碰，`.strict()` 400 兜底）**：`lang`（既有端点独占）、`keywords`、
`bangumi`、`bilibili`、`anime`、`showCoverInContent`、`generateOgImages`、`favicon`、
`showLastModified`、`pageProgressBar`、`thirdPartyAnalytics`。

## 2. e2e 证据表（`apps/server/test/p7i-site-sidepanel-override.e2e-spec.ts`，15/15 绿 · 820ms）

| # | 用例名 | 断言结果 |
|---|---|---|
| ① | PUT site-info → 200，15 键逐属性物化 + 侧车 siteInfo + 原文本留档 | ✅ `config.ts` 内 15 属性逐键 `setInitializer` 后 ts-morph 重解析值 == payload；侧车 `siteInfo` 15 键全等；`originals['siteConfig.title']` 等首写留档 15 条 |
| ② | GET 合并语义：siteInfo = override 整档；baselineSiteInfo = config.ts 现值逐键解析 | ✅ 物化后两者相等（管理权转移，与 commentConfig 先例同构）；`unmanagedKeys`（keywords 等）不出现在任一视图 |
| ③ | 基线缺 navbarTitle → PUT 含该键 → 追加属性（缺失插入） | ✅ 对象字面量末尾新增 `navbarTitle` 属性，其余属性文本零变动 |
| ④ | 可选键缺省 → 零触碰：不新增、不改写、不落侧车键 | ✅ 5 可选键全不送 → `config.ts` 字节级不变（before == after 跳写）、侧车 `siteInfo` 无这 5 键 |
| ⑤ | 越界键（lang / keywords）→ 400 且零物化 | ✅ `.strict()` 400；`config.ts` 与侧车均零变更 |
| ⑥ | timeZone=13 → 400（值域） | ✅ `z.number().int().min(-12).max(12)` 拒绝 |
| ⑦ | siteURL 无尾斜杠 → 400；title 空串 → 400 | ✅ K7 值域两条各自生效 |
| ⑧ | toc.depth=4 → 400（1~3 值域） | ✅ 见偏差 ④（`number().int().min(1).max(3)` 落地） |
| ⑨ | PUT profile → 200 整档置换 + links=[] 合法清空 + 原文本留档 | ✅ 声明整段 `setInitializer`；`links: []` 200（合法清空）；`originals.profileConfig` 首写留档 |
| ⑩ | profile 越界键 → 400 且零物化 | ✅ `.strict()` 400；文件字节级不变 |
| ⑪ | PUT announcement → 200 整档置换 + 原文本留档 | ✅ 声明整段置换；`originals.announcementConfig` 首写留档 |
| ⑫ | announcement content 空串 / 非法 type → 400 | ✅ `content: z.string().min(1)`；`type` 枚举四值 |
| ⑬ | 探针门禁：siteConfig 初始化器非对象 → 409 且零物化 | ✅ `detail.probes` 含 `siteConfig` / `siteConfig.siteInfo` 失败项；`config.ts` 零变更 |
| ⑭ | 探针门禁：profileConfig 声明缺失 → 409 且零物化 | ✅ `detail.probes` 含 `profileConfig` declaration-exists 失败 |
| ⑮ | 旧侧车（仅 lang/comments/nav 键）兼容：GET 不炸 + PUT 后旧键保留 | ✅ I4 实证：旧侧车文件（`version: 1` + 旧三键）零迁移可读，新写入不覆盖旧键 |

### 回归锚（既有 spec 全绿）

| spec | 结果 | 说明 |
|---|---|---|
| `p4e3a-theme-lock.e2e-spec.ts` | 14/14 ✅ | ③⑥ 探针「全绿」断言随基线 additive 扩展后复绿；⑫ 形态门禁仍只报 `navBarConfig.links` |
| `p7f-config-override.e2e-spec.ts` | 14/14 ✅ | 四端点契约零破坏（I2） |
| `p7h-config-override-isolation.e2e-spec.ts` | 1/1 ✅ | 侧车/env 隔离域零触碰 |
| `p4d3-nav.e2e-spec.ts`、`p12-site-assets.e2e-spec.ts` | ✅ | 导航物化 / 静态资源通道零回归 |
| **全量** | **505/505（58 文件）** | 490 存量 + 15 新增，**本机首次全绿**（不再出现 p9 进程链 6 例环境性失败） |

## 3. 探针门禁接线（I5 / K6）

`packages/shared/src/theme-profile.ts` 档案 `declarationProbes` 新增靶点（`profileVersion` **未升版**，additive）：

- `siteConfig`、`siteConfig.lang`、`siteConfig.siteInfo`：declaration-exists（+ 后两者 value-parses-schema）
- `siteConfig.<15 键>`：declaration-exists（`SITE_INFO_DECLARATION_PROBES`，源 = `SITE_INFO_KEYS` 单源）
- `profileConfig`、`announcementConfig`：declaration-exists + initializer-object + value-parses-schema

PUT 接线（`assertProbesPass` 按**请求靶点**过滤 `runAllProbes()`，故新增靶点不会让既有 409 断言多出条目）：

| 端点 | 门禁靶点 |
|---|---|
| `PUT site-info` | `siteConfig`、`siteConfig.siteInfo`、`siteConfig.<key>` × 15（共 17） |
| `PUT profile` | `profileConfig` |
| `PUT announcement` | `announcementConfig` |

`theme-registry.service.ts` 的 `PROBE_SCHEMAS` 四映射：`commentConfig` / `siteConfig→SiteInfoProbeSchema` /
`profileConfig` / `announcementConfig`。siteInfo 用**宽松探针视图**（15 键全可选 + strip 模式允许额外键）：
真实 `siteConfig` 声明含 20+ 非受管键，整体值过 `.strict()` 15 键子集恒失败；该视图**仅用于探针，禁用于写路径**（写路径仍 `.strict()`）。

**两轴正交未受影响**（ADR-024）：本批不 capture、不重置漂移轴，p4e3a ⑪ 的「capture 后探针仍失败」语义保持。

## 4. 已知限制（K1 / K8 裁剪，均有主）

1. **无逐键 / 整档清除端点**（K1）：三个新档覆盖写入即管理权转移，无显式清除路径。`originals` 留档仍写（`siteConfig.<key>` / `profileConfig` / `announcementConfig`），供未来批次做还原 UI。
2. **缺失属性插入无法归档**：基线缺某可选键、body 含该键 → `addPropertyAssignment` 追加，此时 `originals['siteConfig.<key>']` 无原文本可留（该键此前不存在）。删除语义也不存在（本批无删键通道）。
3. **无逐键 diff UI**（K8 明示裁剪）：siteInfo 区尾部一个只读折叠 `<pre>` 呈现 `baselineSiteInfo` JSON，`null` 显示「基线不可得」。
4. **物化多行值保留 JSON 的 2 空格相对缩进**：`valueToTsLiteral` 产 JSON 形态文本，ts-morph 按「父缩进 + 1 单位」重排续行，故嵌套值呈现 `\t\t  hue: 120,`（缩进单位来自文件实测，插入属性走 `manipulationSettings.indentationText`）。与既有 nav / commentConfig 物化**同型同源**，非本批引入的新特质；不影响 AST 语义，不影响 `pnpm build`。
5. **基线 `siteConfig` 声明非对象字面量**（如 `satisfies` 包裹以外的新写法）→ `siteInfo` 视图 null、表单空值起步，且门禁 409 兜底（面板显式警示条）。

## 5. 验收三连实录（T6 / I1）

```
$ pnpm build
packages/shared build: Done
apps/server build: Done
apps/web build: ✓ 1914 modules transformed / 13.69s
EXIT=0

$ pnpm lint
$ eslint .
EXIT=0        # 0 error / 0 warning

$ pnpm --filter @mizuki/server test  （vitest run --maxWorkers=1，全量单批）
Test Files  58 passed (58)
Tests       505 passed (505)
Duration    265.50s
```

**数账**：存量基线 490 → **505**（+15 = p7i 15 条）；文件 57 → 58。
`apps/web` 侧 `vue-tsc --noEmit` 随 `pnpm build` 通过（0 错），未单独另跑。

## 6. 不变量逐条核对（I1~I8）

| # | 结论 |
|---|---|
| I1 | ✅ build 0 / lint 0·0 / test 505 全绿（含新增 15） |
| I2 | ✅ `/public/**` 零触碰；既有四端点契约零破坏（p7f 14/14、p7h 1/1 原样绿）；p7f/p7h **零改动** |
| I3 | ✅ 三档写入全走 `splice*` + `preWriteBackup` + `atomicWriteFile`；`backup.service.ts` 零触碰；无裸 `fs.writeFile` 落 Mizuki 根 |
| I4 | ✅ 新 schema 全 `.strict()`；侧车仅增三可选键、`version` 仍 `1`、旧侧车可解析（p7i ⑮）；不受管键一个未进 schema/表单（p7i ②⑤ 实证） |
| I5 | ✅ 三个新 PUT 均有探针门禁；e2e 409 + 零物化（p7i ⑬⑭）；未重置漂移轴、未重捕获基线 |
| I6 | ✅ 零新增依赖；`pnpm-lock.yaml` / `apps/web/package.json` / `apps/web/vite.config.ts` 零变动 |
| I7 | ✅ 保存不自动 build；「保存后请在「构建预览」执行 build」提示保留（四档 save 提示均带）；路由表 / 菜单 / `MainLayout.vue` 零改动 |
| I8 | ✅ 新表单全走既有 schema-form / JSON textarea 与 U1 token（无新增硬编码色值/圆角/阴影）；无新组件文件、无新路由 |

## 7. 偏差清单（相对指令包字面）

| # | 偏差 | 判定 |
|---|---|---|
| ① | `evaluator.ts` 增 `ArrayLiteralExpression` 分支（未列文件） | 必要前置能力，见 §0 |
| ② | siteInfo 可选性按 **K7**（`siteStartDate` / `navbarTitle` / `pageScaling` / `tagStyle` / `wallpaperMode` 可选），而非 K1 字面「15 键全必填」 | K7 明示「字段面与可选性逐字对齐主题类型，只加值域不改可选性」；K1 是端点面表述。取 K7（更具体），语义 = 可选键缺省则零触碰 |
| ③ | 探针额外增 `siteConfig.siteInfo` 靶点 + 用宽松 `SiteInfoProbeSchema` 而非「`siteConfig` 值过 `SiteInfoSchema`」 | 后者恒失败（声明含非受管键），见 §3 |
| ④ | `toc.depth` 落 `z.number().int().min(1).max(3)` 而非枚举 `z.union([1,2,3])` | 等价值域，与 `themeColor.hue` 同族写法；串化入参会被 `number()` 拒绝/转换（e2e ⑧ 实证 4 → 400） |
| ⑤ | `p4e3a` 内联基线 additive 扩两声明（未列文件） | 见 §0 |
| ⑥ | `SchemaForm.vue` 分组分支扩展（未列文件） | 见 §0 |
| ⑦ | 无逐键 / 清除端点（K1 已知限制） | K1 明示 + §4.1 |
| ⑧ | siteInfo 无逐键 diff UI（K8 明示裁剪） | §4.3 |
| ⑨ | 物化多行值保留 JSON 2 空格相对缩进 | §4.4（既有同型，非本批引入） |
| ⑩ | 页面未抽 `sections/` 子组件（K8 允许但非必须） | 单文件 ~712 行，仍在可读范围；少一次文件面扩张 |
| ⑪ | `CONFIG_LABELS` 的 `enable` 由「启用评论」改为「启用」 | 该表按**键名**索引且跨五区共用；`enable` 同时出现在 commentConfig / pageScaling / toc / profile.typewriter / announcement.link，保留「启用评论」会让后四区显示错误标签。属 K8「标签表扩充」的必然收敛 |

## 8. 改动清单（工作树，未提交）

```
 M apps/server/src/modules/data-files/evaluator.ts              (+11/-1)   数组字面量求值
 M apps/server/src/modules/site-config/site-config.controller.ts (+59/-6)   三 PUT 端点
 M apps/server/src/modules/site-config/site-config.service.ts   (+304/-23)  splice ×3 / 基线 / 视图
 M apps/server/src/modules/theme/theme-registry.service.ts      (+9)       PROBE_SCHEMAS 四映射
 M apps/server/test/p4e3a-theme-lock.e2e-spec.ts                (+18)      基线 additive
 M apps/web/src/api/config.ts                                   (+29)      三 PUT + 六字段视图
 M apps/web/src/lib/schema-form/SchemaForm.vue                  (+121/-23) 分组行表 + 控件分派
 M apps/web/src/views/settings/SiteConfigPage.vue               (+502/-101) 五区折叠 + K5/K9
 M packages/shared/src/site-config.ts                           (+279)     三 schema + 侧车三键
 M packages/shared/src/theme-profile.ts                         (+27)      探针目录
?? apps/server/test/p7i-site-sidepanel-override.e2e-spec.ts      (524 行, 15 用例)
?? docs/audits/u3-p1/README.md                                   (本文件)
```
