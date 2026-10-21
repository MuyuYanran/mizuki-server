# U3-P4b — 物化态只读警示条（C7 疑问②）+ 主题漂移呈现面板（E3b）

> [签发] 架构师 2026-10-21。执行方：用户指定模型通道。**完成即停**，交回报告等验收。
> [前置] HEAD = `d063e92`（U3-P4 裁定登记 + U3-P4a 指令包）。基线 **546 用例 / 62 文件**
> （全量单批 `--maxWorkers=1`；62 = `find apps/server/test -name "*spec.ts" | wc -l` 实测）。
> 三连全绿；CI run 11 首绿（`65a25cc`）。**本包所有 file:line 均按 `d063e92` 实读**。
> ⚠ 同批兄弟包 U3-P4a（`taskEnv` + 番剧档）**尚未执行**（实读：全仓 grep `taskEnv` / `siteAnime` 零命中）。
> 本包与 P4a **无字段依赖**；若 P4a 先落地，`site-config.service.ts` 将新增分支导致行号漂移——
> 届时**按符号名定位**，不得按本包行号硬改。
> [PM 裁定] 2026-10-21 U3-P4 九项裁定（`docs/audits/feature-alignment/README.md` §8）：
> 本批兑现 **C7 疑问②（物化态警示）** 与 **E3b（漂移呈现面板，§8.3 解冻）**；
> §8.4 明示两者同批的理由是「都是消费既有端点/既有状态的纯前端」。

## 0. 三处架构师再裁（执行方不得偏离；发现与事实冲突**停下报告**）

**再裁 A（T1 的判定源：现有视图确实不足，走最小 additive 字段，不加端点）。**
任务书写「判定依据必须是既有后端视图已返回的 override 态」。实读结论：**不足**。
`getConfig()`（`site-config.service.ts:130-150`）对六个域一律做 `carrier.X ?? baseline.X` 合并
（:138-148），于是「override 存在」与「override 不存在但基线可解析」**在响应里同形**；
唯一带显式 override 态的是 `siteConfig.lang`（:135-136 的 `lang` + `baselineLang` 双字段）。
因此**不能**用 `view.nav === null` / `view.siteInfo === null` 反推接管态——它们的真义是
「基线不可解析/声明形态不符」（`SiteConfigPage.vue:193`、`:198` 正是这么用的），
反推会把「基线不可得」误报成「未接管」。裁定：`AdminSiteConfigView` 增**一个** additive 字段
`overrides`（K1）——零新端点、零新路由、零写盘、既有字段与状态码零变化。
否决替代：① 新增 `GET /admin/config/override-state` 探测端点（多一条 API 面，且信息量与字段级 additive 等价）；
② 前端读 `baselineLang !== lang` 之类启发式（对另五个域恒不可得，必错）。

**再裁 B（T2 的落点：`/theme` 已被占用，另立 `/theme-status`）。**
`router/index.ts:63` 的 `/theme` 已是**面板自身外观**页 `ThemePage.vue`（预设 + 自定义 CSS，
纯 localStorage、零后端，`ThemePage.vue:1-12`），菜单项在 `MainLayout.vue:55`。
任务书假设的「新增面板页（如 `/theme`）」**会与既有页冲突**。裁定：新增路由 **`/theme-status`**
（title「主题状态」），归 `MainLayout.vue:59` 既有 group `配置`；`MenuIcon.vue` 增一分支
（无分支则落到 `:121-124` 的默认兜底圆点，视觉上与「设置」区分不开）。
否决替代：并入 `SiteConfigPage.vue` 第 6 个折叠区（会把一次**写基线**的 `capture` 塞进一个
「所有写都落 `config.ts`」的页面，模糊写盘边界，且与 §8.4「纯前端消费」的独立性相悖）。

**再裁 C（还原入口的事实订正：不能承诺"可还原"）。**
任务书写「可'还原'回退（指向既有还原入口）」。实读：**只有两个域有还原路径**——
`lang`（清空选择器 → `PUT lang ''` → 归一缺省并还原留档原文，`:164-172`）与
`nav`（「还原主题默认」按钮 `SiteConfigPage.vue:625` → `onResetNav` `:391-403`）。
`commentConfig` 明确「覆盖写入即管理权转移」（`:182-196`，ADR-020 §6 同口径）；
`siteInfo` / `profile` / `announcement` **无整档清除端点**（`:255-284` 注释「留档供未来批次还原」）。
裁定：警示条文案**分域措辞**（K3 表），已接管但无还原入口的域必须写明「当前无面板还原入口，
原文本已在服务端留档」，**禁止**统一写「可随时还原」。

## 1. 事实基座（已实读核实，执行方可抽验）

### 1.1 配置物化面（T1）

- `site-config.controller.ts:42-45` `GET /admin/config` → `service.getConfig()`；同文件其余六端点
  `PUT lang`（:48-54）/ `comments`（:57-63）/ `nav`（:67-73）/ `site-info`（:81-87）/
  `profile`（:91-97）/ `announcement`（:101-107），全部 `@HttpCode(200)`。
- `site-config.service.ts:58-92` `AdminSiteConfigView` 字段面 = `siteConfig{lang,baselineLang}` /
  `commentConfig` / `nav` / `baselineNav` / `baselineNavRaw` / `siteInfo` / `baselineSiteInfo` /
  `profile` / `baselineProfile` / `announcement` / `baselineAnnouncement`
  —— **无 `overrides`、无 `originals`**（这是再裁 A 的直接依据）。
- `:130-150` `getConfig()`：`carrier` 与 `baseline` 双读，六域 `??` 合并；**只有 lang 分列两字段**。
- `:288-309` `readOverride()`：侧车不存在 → `{version:1}`（等价"全未接管"）；
  JSON 解析失败 / zod 校验失败 → **抛普通 `Error`**（含侧车绝对路径）⇒ 全局过滤器落 500（见 1.4）。
- `:311-314` `writeOverride()`：`atomicWriteFile(defaultOverridePath(), …, {ensureDir:true})`（侧车单源）。
- `:358-455` `readBaseline(originals)`：基线活读 `config.ts`；`:394-397` 用
  `originals['siteConfig.lang']` 原文探针求值还原**真基线**（物化态下 `lang` 已从文件消失）。
- `:523-554` `spliceSiteConfigLang`：首次覆盖前留档 `originals['siteConfig.lang'] = 原初始化器文本`，
  随后 `prop.setInitializer(JSON.stringify(value))` —— **这就是「声明级置换为字面量」**：
  保存后 `lang: SITE_LANG` 变 `lang: "zh_CN"`，主题侧再改 `SITE_LANG` 常量**不再传导**。
- `:612-659` `spliceSiteInfo`：`siteConfig` 对象内 15 键**逐属性** `setInitializer`；
  `:651-654` 首次留档 `originals['siteConfig.<key>']`；`:645` 原本缺属性 → `addPropertyAssignment`
  （无原文本可留档）。非受管属性与其余声明零触碰。
- `:734-745` `persistConfigTs`：`before === after` 直接 return（清除还原至原文 = 等价 no-op）；
  否则 `preWriteBackup` → `atomicWrite`。**未发射 `content.changed`**（ADR-020 已知限制）。
- `packages/shared/src/site-config.ts:340-362` `ConfigOverrideFileSchema`（`.strict()`）：
  `version:1` + `siteConfig{lang}` + `commentConfig` + `nav` + `siteInfo` + `profile` +
  `announcement` + `originals`；`:359-360` `originals: z.record(z.string(), z.string())`
  = **受控定位符 → config.ts 原初始化器文本**（即"留档可还原"的载体）。
- `docs/decisions/ADR-020-config-override.md:24-25`（常量代入求值口径）、`:39`（comment 无清除路径）、
  `:40-49`（四格语义表）、`:65-69`（已知限制）。

### 1.2 主题注册表面（T2，后端零改动）

- `theme.controller.ts:16` `@Controller('admin/theme')`；`:20-24` `GET status` → `registry.getStatus()`；
  `:26-31` `POST capture`，`:28` `@HttpCode(HttpStatus.CREATED)` —— 两个端点**均无 body、均需 P6 全局守卫**；
  文件头 `:6` 原文「漂移呈现面板属 E3b（本批零前端实现）」。
- `theme-registry.service.ts:99-118` `getStatus()`：四段返回 `identity` / `fingerprint{scannedAt,digest,entries}` /
  `baseline{state,profileVersion,capturedAt,detail}` / `drift{state,items}` / `probes[]`。**全只读**（无写、无缓存）。
- `:121-136` `captureBaseline()`：`scanLive()` → 构造 `ThemeBaselineFile` → `:132` `defaultBaselinePath()` →
  `:134` `atomicWriteFile(baselinePath, …, {ensureDir:true})` → `:135` 返回 `this.getStatus()`。
  **写哪个文件**：`:53-59` `defaultBaselinePath()` = `env MIZUKI_THEME_BASELINE_PATH`
  ?? `<apps/server>/data/theme-baseline/baseline.json`（`__dirname/../../../data/...`）。
  **不写主题源码**：全函数无 `mizukiRoot` 写操作（`scanLive` 只 `statSync`/`sha256File`，`:187-212`）。
- **写失败表现**：`atomicWriteFile`（`common/fs/atomic-write.ts:55-75`）在 `writeFileSync` 失败时
  `removeQuietly(tmp)` 后**向上抛**；`captureBaseline` 与 controller **均无 try/catch** ⇒
  落 `all-exceptions.filter.ts` 的未知异常分支（:37-45）：**500 + `{code:'InternalError', message:'内部服务器错误', detail:null}`**。
  若父路径不存在则 `:60-62` `ensureDir` 先 `mkdirSync(recursive)`，其失败同上 500。
  ⇒ 面板**禁止**把 500 当成功，且**必须**在失败后仍刷新一次状态。
- 双轴正交已核实：`:143-156` `assertProbesPass` 与 `:276-286` `runAllProbes` 读的是
  `MizukiTier1Profile.declarationProbes`（档案常量），**不读基线文件** ⇒ capture 重置漂移轴、
  不动探针轴（`:121-136` 返回值里 `probes` 由 `getStatus()` 现算）。
- `:214-244` `loadBaseline()` 四态：`absent`（:217-219，非错误）/ `parse-error`（:223-234）/
  `version-mismatch`（:236-242）/ `loaded`（:243）。
- `:247-271` `computeDrift()`：基线未 loaded → `no-baseline`；items 空 → `clean`；否则 `drifted`；
  kind 只三种：`added` / `removed` / `modified`（逐条 :262-268）。
- `packages/shared/src/theme-profile.ts:147-192` `ThemeStatusViewSchema`（`.strict()`，前后端唯一共享面）：
  `identity{name,version,fallback}`（`:154` `fallback ∈ package.json|fingerprint`）、
  `fingerprint.entries[].role`（`:24-29` 四类：`materialization-carrier` / `identity` /
  `structure-assumption` / `token-source`）、`baseline.state`（`:178` 四态）、
  `drift.state`（`:186` 三态）、`drift.items[].kind`（`:139-144` 三态）、
  `probes[]`（`:64-71` `{target,passed,detail}`）。

### 1.3 前端面

- `router/index.ts:61` `/site-config`；`:63` **`/theme` 已被 `ThemePage` 占用**（`:32` import）。
- `MainLayout.vue:35-56` `MENU` 声明序；`:51` `/settings`、`:53` `/site-config`、`:55` `/theme`（group `配置`）；
  `:59` `MENU_GROUPS = ['内容','集合','媒体','运维','配置']`；`:62-64` minimal 模式过滤（`minimalHidden`）；
  `:72` `MINIMAL_HIDDEN_PREFIXES = ['/articles']`。
- `MenuIcon.vue:117` `/theme` 图标分支；`:121-124` `v-else` 默认兜底（圆点）。
- `api/config.ts:13-40` `SiteConfigView` 是**手写类型**（与后端 interface 同形，非 shared 导出）；
  `:43-45` `getConfig()`。全 `apps/web/src/api/` 无 `theme.ts`。
- `SiteConfigPage.vue:179-219` `fetchConfig()`：`:193` `navUnmanaged = view.nav === null`、
  `:198` `siteInfoUnavailable = view.siteInfo === null`（**均为"基线不可得"语义，不是接管态**）；
  `:288-310` `onSubmit`（lang + comments 双 PUT）；`:346-389` `onSaveNav`（**接管/空导航二次确认**，
  `ElMessageBox.confirm` 惯例）；`:391-403` `onResetNav`（唯一还原实现）；`:625` 「还原主题默认」按钮；
  `:482-495` 页头 + 顶部 info alert（警示条落点相邻）；`:601-609` 既有 warning alert 文案风格参照。
- `ThemePage.vue:1-12` 面板外观页（localStorage，零后端）—— 与 T2 语义正交。
- `api/http.ts:16-28` `ApiError`（携带 `status/code/message/detail`）；`:55-60` 统一错误形状解析。
- `lib/notify.ts:21-23` `notifyApiError(error, fallback)` = **全站错误提示唯一出口**。
- **前端无测试运行时**：`apps/web/package.json:6-10` scripts 只有 `dev` / `build` / `preview`，
  devDependencies 无 vitest/jest ⇒ T1/T2 的面板行为**一律人工走查**（见 §4），
  禁止编造前端单测或 e2e。
- 使用惯例：写操作用 `ElMessageBox.confirm(...).then(()=>true).catch(()=>false)`（`SiteConfigPage.vue:362-374`）；
  成功提示必须带「如需反映到站点请在『构建预览』执行 build」（`:303` / `:382` / `:430`）。

### 1.4 与台账/审计表述不一致之处（据实登记，**据实上报，不要淡化**）

| # | 台账/任务书表述 | 实读事实 | 处置 |
|---|---|---|---|
| D1 | 任务书：「判定依据必须是既有后端视图已返回的 override 态」 | 现有视图只对 `lang` 一域返回 override 态；另五域 `??` 合并后不可辨（§1.1） | 走再裁 A（K1 最小 additive 字段） |
| D2 | 任务书：「新增面板页（如 `/theme`）」 | `/theme` 已被 `ThemePage`（面板外观）占用（`router/index.ts:63`） | 走再裁 B（`/theme-status`） |
| D3 | 任务书：「可'还原'回退（指向既有还原入口）」 | 仅 `lang` / `nav` 有还原路径；comments / siteInfo / profile / announcement 无清除端点 | 走再裁 C（K3 分域措辞） |
| D4 | 审计 §8.3 E3b 行：「`apps/web/src` 全量 grep 零命中」 | `theme` 关键字命中 **15+ 处**，但全部是面板外观域（`lib/theme.ts`、`lib/custom-theme.ts`、`ThemePage.vue`）；**零命中的是 `/admin/theme` 端点消费与 `ThemeStatusView` 类型使用** | 表述不精确但结论成立；执行方按"端点零消费"理解，并在报告里订正措辞 |
| D5 | AGENTS §4-6：对外文案不含磁盘绝对路径 | `theme-registry.service.ts:226` / `:234`（`baseline.detail`）与 `:240`（version-mismatch 文案）**拼接基线绝对路径**；`site-config.service.ts:298` / `:306`（侧车解析失败）同样拼绝对路径 | 本批**不改后端**（E3b 零改动、T1 只加字段）；面板层做投影（K7），后端修复另立条目 |
| D6 | 基线 546/62 | 实测 `find apps/server/test -name "*spec.ts" \| wc -l` = **62** | 一致；用例数由全量跑验证 |

## 2. 架构裁定 K

**K1（T1 判定源：一个 additive 字段，零端点）**。`AdminSiteConfigView`（`site-config.service.ts:58-92`）增：

```ts
/** [U3-P4b/K1] 物化态逐域快照——只报「有/无」与留档键名，**不回值、不回原文** */
overrides: {
  lang: boolean;
  comments: boolean;
  nav: boolean;
  siteInfo: { active: boolean; keys: string[] };  // keys = 侧车内提交过的键，字典序
  profile: boolean;
  announcement: boolean;
  originalsKeys: string[];                        // = Object.keys(carrier.originals ?? {}).sort()
};
```

组装全部来自 `getConfig()` 已读到的 `carrier`（存在性判定 `carrier.X !== undefined`；
`siteInfo.keys = Object.keys(carrier.siteInfo ?? {}).sort()`），**不新增文件读、不新增端点、不加 shared schema**
（沿用后端 interface + 前端 `api/config.ts:13-40` 手写同形类型的既有双份口径，避免同批出现两套契约）。
**禁**把 `originals` 的**文本**塞进响应（那是 config.ts 片段，含用户域名/评论配置，且体积不可控）。

**K2（T1 警示条：落点 + 四格语义）**。位置：`SiteConfigPage.vue` 页头下方、既有 info alert
（`:488-495`）之后、`el-collapse`（`:498`）之前，**一条** `el-alert`（`:closable="false" show-icon`，
与 `:601-609` 同风格），只读、无按钮（还原走各分区既有入口，不在此处新造动作）。
四格判据与形态（R3 铁律，逐格可验收）：

| 格 | 判据（仅用 `view.overrides`） | 警示条形态 |
|---|---|---|
| 键缺失 | `view.overrides === undefined`（旧后端/缓存响应） | **不渲染**（fail-open，不猜"已接管/未接管"）；console 无噪音 |
| 空 | `overrides` 存在、六域全 `false` 且 `originalsKeys.length === 0` | `type="info"`：「当前无物化：面板未接管任何受控键，主题 `config.ts` 常量改动仍会生效」 |
| 非法 | `overrides` 非对象 / 任一域非 boolean / `siteInfo.keys` 非字符串数组 / `originalsKeys` 非数组 | 不渲染任何结论，改为中性一行「物化态未知（视图字段异常）」；**不**发额外请求 |
| 合法 | 至少一域 `true` | `type="warning"`，逐域列「已物化」清单 + 留档提示 + 分域还原措辞（K3） |

**空值接管**（合法格内的语义细分，必须写进明细而非另立格）：`nav = {links: []}`（合法清空导航）、
`siteInfo = {}`（提交空对象）都算"已接管且值为空"，警示条**照常显示**并追加「（空值接管）」标注；
`lang` 空串不落侧车（`carrier.siteConfig` 被删，`:167-171`）⇒ 该域为 `false`。

**K3（T1 文案：分域还原能力表，禁止统一承诺）**。警示条正文固定三句：①哪些受控键已被物化 →
②主题侧改常量不再传导（`lang: SITE_LANG` 已变 `lang: "zh_CN"`，ADR-020 已知限制）→ ③按域给回退路径。
明细区按域渲染（数据源 = `overrides` + 下方固定表，**不许**前端自己推断）：

| 域（overrides 键） | 已接管时文案里的回退路径 | 依据 |
|---|---|---|
| `lang` | 「清空语言选择器即还原主题默认（服务端还原留档原文）」 | `:164-172` |
| `nav` | 「导航区『还原主题默认』按钮」 | `SiteConfigPage.vue:625` / `:391-403` |
| `comments` | 「当前无面板还原入口：覆盖写入即管理权转移；原文本已在服务端留档」 | `:182-196`、ADR-020 §6 |
| `siteInfo` | 「当前无整档还原入口：逐键原文本已留档」 | `:238-253`（`:646` 注释同义） |
| `profile` / `announcement` | 「当前无整档还原入口：原文本已留档，供后续批次还原」 | `:255-284` |

**K4（T2 落点：新页 + 新路由 + 新菜单 + 图标）**。新建 `apps/web/src/views/settings/ThemeStatusPage.vue`；
`router/index.ts` 在 `:63` 之后加 `{ path: 'theme-status', component: ThemeStatusPage, meta: { title: '主题状态' } }`
（import 紧随 `:32`）；`MainLayout.vue` 在 `:55` 之后加 `{ path: '/theme-status', title: '主题状态', group: '配置' }`
（**不加** `minimalHidden`：漂移诊断在 manage 模式同样需要）；`MenuIcon.vue` 在 `:117` 分支后加
`/theme-status` 分支（或显式复用同一图标常量），避免落到 `:121-124` 默认圆点。
**不新增** `apps/web/src/api/theme.ts` 之外的第二条请求路径：客户端统一落 `api/theme.ts`
（`getStatus()` / `capture()`，`capture` 走 `request('POST','/admin/theme/capture')`，无 body）。

**K5（T2 展示面：五段，枚举逐一列名，禁自造状态）**。页面自上而下：

| 段 | 字段 | 呈现要求 |
|---|---|---|
| 身份 | `identity.name` / `version` / `fallback` | `fallback === 'fingerprint'` 时显式标注「身份降级：以指纹代身份」（`package.json` 缺 name/version） |
| 指纹 | `fingerprint.scannedAt` / `digest` / `entries[]` | 表格列 `path` / `role` / `present` / `sha256`（哈希显示前 12 位 + `…`）；`role` 四值中文映射（`materialization-carrier`→物化载体、`identity`→身份文件、`structure-assumption`→结构假设、`token-source`→样式源）；`sha256 === null` 显示「不指纹（目录级）」 |
| 基线 | `baseline.state` / `profileVersion` / `capturedAt` / `detail` | 四态逐一列名：`absent` 未捕获（**非错误**，提示点「捕获基线」）/ `loaded` 正常 / `version-mismatch` 档案版本失配（附重捕获指引）/ `parse-error` 解析失败（附诊断明细）；`detail` 经 K7 投影后展示 |
| 漂移 | `drift.state` / `items[]` | 三态逐一列名：`no-baseline` 无基线 / `clean` 零漂移 / `drifted` 漂移 N 项；`items` 表格 `path` + `kind` 三值中文（`added`→新增 / `removed`→移除 / `modified`→变更）；`no-baseline` 时**不**渲染空表，只给一句「无基线，先捕获」 |
| 探针 | `probes[]` | 表格 `target` / `passed` / `detail`；顶部徽标「x/y 通过」；有失败项时 `type="warning"` 提示「探针失败会阻断物化写入（409）」并指向 `PROBE_GATE_GUIDANCE` 的三步（文案由前端静态复述，不新增端点） |

**K6（T2 写操作：capture 是唯一写，二次确认 + 失败不得谎报）**。
按钮「捕获基线（重置漂移轴）」→ `ElMessageBox.confirm('将用当前主题指纹覆盖漂移基线（仅重置漂移诊断，不改主题源码；探针轴不受影响）。确定继续？', '捕获基线确认', { type: 'warning', confirmButtonText: '确认捕获', cancelButtonText: '取消' })`
（`then(()=>true).catch(()=>false)` 惯例，`SiteConfigPage.vue:362-374` 同型）。确认后：
`POST` 成功 → 以**响应体**（即最新 `ThemeStatusView`）渲染 + `ElMessage.success('基线已捕获（漂移轴已重置）')`；
`POST` 失败（500 `InternalError`）→ `notifyApiError(e, '捕获基线失败')`，**不改**任何展示为"已捕获"；
`finally` 中**无条件**再 `GET status` 一次（写失败也要回到服务端真源）。
页面内其余元素**全部只读**：无编辑、无删除、无第二个写按钮。

**K7（内部路径遮蔽：前端投影，本批不改后端）**。`baseline.detail`（以及任何错误 `detail`）展示前过一层
`maskInternalPaths(text)`：把形如 `<盘符>:\…` 或 `/…/baseline.json` 的片段替换为 `…/baseline.json`，
其余诊断文字原样保留；**禁**把 `mizukiRoot` / data 目录绝对路径整段渲染。
后端 `theme-registry.service.ts:226/:234/:240` 与 `site-config.service.ts:298/:306` 的绝对路径拼接
按 §1.4-D5 登记为既有偏差，**本批不修**（改了就是后端非零改动，与 E3b 口径冲突）。

**K8（三态兜底：loading / 错误 / 未初始化）**。`v-loading="loading"`；`GET status` 失败 →
`notifyApiError(e, '加载主题状态失败')` + 页面空态文案（不渲染半截表格）；`404`（`mizukiRoot` 未配置，
`theme-registry.service.ts:375-380`）→ 引导文案「先在设置/初始化向导完成主题目录配置」。
刷新按钮（只读 `GET`，不属写操作）可留。

**K9（技术约束：零新依赖、零图表库）**。表格用 `el-table`、字段用 `el-descriptions`、状态用 `el-tag`
（element-plus ^2.8.0 已在依赖内）；**禁**引入 echarts 之类可视化依赖（漂移清单是结构化列表，不是时序数据）。
枚举中文映射写成页面内 `const`（与 `CONFIG_LABELS` 同风格），**不**进 shared（展示层词，不是契约）。

**K10（台账，交付时同批）**：`docs/audits/feature-alignment/README.md` §8.3 E3b 行标注「已交付（U3-P4b）」、
§4 项 4 同步；`docs/SESSIONS.md` 交付段 + `CHANGELOG.md` 批次条目 + `AGENTS.md` §9 未清项把
「C7 疑问② / E3b」改为已清；交付报告落 `docs/audits/u3-p4b/README.md`（锚点、K/I 对照、用例明细、三连实录、偏差披露）。
**C7 疑问② 的关闭口径**必须是「警示条已上线 + 分域还原路径据实呈现」，不是「已支持还原」。

**K11（禁改项）**：`modules/theme/**` **零改动**（E3b = 前端消费）；`site-config` 侧除 K1 的 `overrides`
字段外**零改动**（两个 service 方法体、六个 PUT 契约、`originals` 语义、侧车 schema 全不动）；
`/public/**` 零 diff；`packages/shared/**` 零改动（K1 明确不加 shared schema）。

## 3. 不变量 I

- **I1** 零新依赖：`pnpm-lock.yaml` 与四处 `package.json` 依赖清单零变动。
- **I2** 公开 API `/public/**` **零 diff**（本批不涉及）。
- **I3** 管理 API 仅 additive：`GET /admin/config` 增 `overrides` 字段（既有字段、状态码、错误形状零变化）；
  `GET /admin/theme/status` 与 `POST /admin/theme/capture` **零 diff**（含 201 与响应体）。
- **I4** 写盘单源：`capture` 只经既有 `atomicWriteFile`（`common/fs/atomic-write.ts:55-75`）写基线文件；
  前端**零写盘**（不落 localStorage、不落 cookie），`originals`/`config.ts` 一个字节不动。
- **I5** 不碰主题源码：`capture` 前后 `<mizukiRoot>/src/**` 字节不变（p4e3b ② 断言）；测试全 `mkdtemp`。
- **I6** 不外泄：`overrides` 只出布尔与**键名**，`originals` 原文永不出响应；`detail` 经 K7 投影；
  secret 概念在本批不适用（六域均公开性质配置），但"内部路径"红线仍然生效。
- **I7** 测试纪律：全部 `mkdtemp` 临时域 + `env` 注入路径（`MIZUKI_THEME_BASELINE_PATH` /
  `MIZUKI_CONFIG_OVERRIDE_PATH`），**绝不**对真实 Mizuki 目录写操作；不碰 `.git/`；**不 push**。
- **I8** 数账：净增 **+11**（p7l 8 + p4e3b 3）⇒ 交回应为 `test 557/557（64 文件全绿单批）/ build 0 / lint 0:0`；
  实测有偏差按实数申报并说明。

## 4. 测试落位

命名空间已 `ls` 核实：`p7f/p7h/p7i/p7j` 已占用（config 域）、`p7k` 由 U3-P4a 预留、
`p4e3a` 已占用（theme 域）；**`p7l` 与 `p4e3b` 均未占用**。

### 4.1 新建 `apps/server/test/p7l-config-override-state.e2e-spec.ts`（建议 8 例）

> 验证 K1 的唯一后端改动。骨架照抄 `p7f-config-override.e2e-spec.ts:94-100`（mkdtemp + `MIZUKI_CONFIG_PATH`
> / `MIZUKI_CONFIG_OVERRIDE_PATH` 注入）与 `p4e3a-theme-lock.e2e-spec.ts:140-148` 的 env 注入法。

① 无侧车 → `overrides` 六域全 `false`、`siteInfo.keys: []`、`originalsKeys: []`；
② `PUT lang` 后 → `overrides.lang === true`；
③ `PUT nav {links: []}` → `overrides.nav === true`（空数组 = 合法接管态，不因"空"判 false）；
④ `PUT site-info` 三键 → `siteInfo.active === true` 且 `siteInfo.keys` **恰为**三键且**字典序**；
⑤ 首次物化后 `originalsKeys` 含 `siteConfig.lang` / `navBarConfig`；第二次同域 PUT **不改变** `originalsKeys` 集合；
⑥ `PUT lang ''` 清除 → `overrides.lang === false`，但 `originalsKeys` **仍含**留档键（留档不随清除删除）；
⑦ 既有字段零变化：把 `GET /admin/config` 响应体去掉 `overrides` 后与改动前快照**逐键全等**
   （六域 + `baseline*` 字段集与值不变）；
⑧ 不外泄：响应体字符串**不含** `SITE_LANG` 原文、不含侧车绝对路径（`grep` 断言）。

### 4.2 新建 `apps/server/test/p4e3b-theme-capture-write.e2e-spec.ts`（建议 3 例）

> T2 后端**零改动**，此 spec 只钉"capture 只写基线、失败不谎报"这条被面板依赖的行为。
> 主题根用 `p4e3a-theme-lock.e2e-spec.ts` 同款 `fs.cpSync(FIXTURE_DIR, mizukiRoot)` + 内联最小 `src/config.ts`。

① `GET /admin/theme/status` → `ThemeStatusViewSchema.safeParse(body).success === true`（严格契约锚）；
② `POST /admin/theme/capture` → 201、`body.drift.state === 'clean'`、基线文件**存在于 mkdtemp 路径**，
   且捕获前后 `<mizukiRoot>/src/config.ts` 的 `sha256` **相等**（证明只写基线、不改主题源码）；
③ 写失败：把 `MIZUKI_THEME_BASELINE_PATH` 指到「父路径是**文件**」的位置（如 `<tmp>/blocker/baseline.json`
   且 `<tmp>/blocker` 是普通文件）→ `POST` 返回 **500**、`code === 'InternalError'`、`detail === null`，
   且 `<tmp>` 内无 `.tmp-*` 残留（原子写清理语义，`atomic-write.ts:70-74`）。

### 4.3 回归必跑（既有 spec，零新增）

`p7f` / `p7h` / `p7i`（config 域双读合并语义）、`p4e3a`（theme 双轴与门禁）、`p7j`（config 侧车隔离）。

### 4.4 人工走查项（**前端无测试运行时**，不得编 e2e）

| # | 走查项 | 通过判据 |
|---|---|---|
| M1 | T1 四格 | 无侧车时 info 中性条；`PUT lang` 后变 warning 且只列 `lang`；`PUT nav []` 后追加「（空值接管）」；响应缺 `overrides`（可用 devtools 改包/旧后端）时**不渲染**警示条 |
| M2 | T1 分域措辞 | comments/siteInfo/profile/announcement 已接管时**不出现**"可随时还原"，只出现留档说明；nav 出现指向「还原主题默认」；lang 出现「清空即还原」 |
| M3 | T1 无假警报 | 仅「基线不可得」（`nav === null` 且无 override）时，**不**出现"已物化"字样 |
| M4 | T2 页面 | `/theme-status` 可达、菜单在「配置」组、图标与「主题外观」可区分；五段齐全；`absent` 态显示"未捕获（非错误）" |
| M5 | T2 capture | 取消 → 无请求发出（Network 面板零 `POST`）；确认 → 201 后 `drift.state` 变 `clean`、探针段**不因捕获而变绿**（两轴正交的肉眼验证） |
| M6 | T2 失败诚实 | 把基线路径指到不可写位置（或临时改 env 重启）→ 页面报「内部服务器错误」且**不**显示"已捕获"，随后自动刷新回到真实状态 |

## 5. 验收口径与纪律

- **三连全绿**才交：`pnpm --filter @mizuki/shared build` → `pnpm test`（全量单批 `--maxWorkers=1`）
  → `pnpm build` → `pnpm lint`（0:0）。数账申报格式：`test N/N（M 文件全绿单批）/ build 0 / lint 0:0`。
- **禁**：改 `modules/theme/**`；给 `/admin/config` 加端点或改六域契约；把 `originals` 原文放进响应；
  把"可还原"写成统一承诺；新引入依赖（含图表库）；在前端持久化主题状态；
  编造前端单测/e2e 冒充验收；`git add/commit/push`（本包只交文件与报告，提交由用户发起）。
- 发现本包事实基座与实况不符（行号漂移——尤以 P4a 先落地为高发、枚举值增减、`/theme` 路径已被改动）
  → **停下报告**，不自行放宽。
- 报告必含：K1~K11 / I1~I8 逐条对照、`git diff --stat`（预期仅 `site-config.service.ts` 与前端 4 文件 + 2 新 spec + 1 新页面）、
  新增用例明细、M1~M6 人工走查实录（截图或文字判据）、§1.4 的 D1~D6 逐条回应。

## §commit（建议，执行方可按实际拆分，但**禁 push**）

```
feat(U3-P4b): 站点配置物化态只读警示条（overrides 视图字段）+ 主题漂移呈现面板（/theme-status 消费既有端点）
```
