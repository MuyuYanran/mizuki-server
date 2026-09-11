# D4g 数账清查侦查报告（恢复提交内含物 + 测试增量溯源 + lint 定性 + 处置申报）

> [授权] 架构师微批次授权 2026-09-08（D4g：禁改代码，纯侦查 + 申报）。
> [性质] 侦查产物（文件清单 + 溯源表 + 处置建议）；**零代码改动、零测试改动**。
> [基线] HEAD = `cf4d4fe`（D4f 终态）；侦查时点 2026-09-11。
> [方法] git 对象考古（cat-file/fsck/show/diff）+ 双版本静态计数（d4ebf43 vs HEAD）
> + vitest JSON 权威复跑（55 文件全跑通，无 worker 崩溃）+ 全文件批次标签扫描。

---

## G1 恢复提交内含物盘点

### G1.0 授权指令的对象核验

`git log --stat 50dbe27 -1` 指定对象 **不存在**：

```
git cat-file -t 50dbe27b  → fatal: Not a valid object name
git cat-file -t 55b5a5e8  → fatal: Not a valid object name
git fsck --unreachable    → 零悬空对象（RC=0，无输出）
```

50dbe27b / 55b5a5e8 系**丢失原仓**的提交，对象未进入本仓库对象库；其内容唯一载体为
恢复提交 **`1fb04b0`**（`recover(Phase4): 50dbe27b + 55b5a5e8 + Wave-1~4 合并重建`，
2026-09-11 13:42）。以下盘点以 1fb04b0 为准。W4-A（`fcb06bb`）仅 1 文件
（InitWizardView.vue，已授权），D4f（`cf4d4fe`）11 文件（已授权），均不在盘点面内。

### G1.1 总量

1fb04b0 = **106 文件**（A 41 / M 65，零删除）。授权基准 = 用户枚举批次
（D4/S/D4c/D4d/D4e）+ 在库申报文档（SESSIONS 各批报告、phase4-refactor 两审计文档）。

### G1.2 归类总表（106 文件 → 六类）

| 类 | 文件数 | 授权状态 | 文件 |
|---|---|---|---|
| ① Wave1-4 重构授权新模块 | 18 | ✅ 在库申报（refactor-implementation §1 逐文件表） | bootstrap/{site-assets,static-panel,swagger}.ts；common/{crypto/hash, fs/atomic-write, fs/mizuki-root, fs/posix, http/{bearer,cookie,json-error,pagination,uploaded-file}, markdown/article-row, security/url-path, validation/{segment-name,zod-issues}}.ts；web/src/lib/{format,notify}.ts |
| ② Wave1-4 重构授权改动 | ~40 | ✅ 在库申报（§2 缺陷闭合表 + "改动 40 文件"） | M：jwt-auth.guard、zod-validation.pipe、main、albums.controller、articles.controller、articles.service、collections/media-reference、media.controller、media.service、posts/media-reference、posts.controller、preview.service、system.controller、app.setup、app-config、backup.service、data-file.service、evaluator、syntax-check、events.ts、api/http、api/media、BackupsPage、DashboardPage、MediaLibraryPage、ConsolePage、SettingsPage、test/config/app-config.spec、docs/DEPLOYMENT-CHECKLIST 等 |
| ③ D4 系列授权面（用户枚举内） | ~15 | ✅ 用户台账 + in-code [Phase4-D4*] 标签 | posts.service（D4+Wave-2）、PostListPage、PostEditPage、api/posts、p5-posts、p5b、p5c、p7f、p4-collections、process-manager.spec+service、SchemaForm、mapper、TipTapEditor、shared/{projects,site-config,index}、MainLayout（D3+D4e）、theme.css（D3+D4e）、standalone.md fixture（p5 头注明"授权项"）等 |
| ④ **Phase4-D1/D2/D3/E3a 批次**（用户枚举外） | ~20 | ⚠️ 非授权面（见 G1.3） | 详见 G1.3 |
| ⑤ **Wave-2 补测 6 spec** | 6 | ⚠️ 无批次申报（见 G2） | atomic-write/mizuki-root/article-row/url-path/segment-name/zod-issues 六 .spec.ts |
| ⑥ 未归属杂项 | 2 | ⚠️ 待裁 | docs/README.md（A，失真数据"250 用例"）；shared/collections/diary.ts（M，1 行 describe 文案） |

### G1.3 非授权文件清单（对照用户枚举 D4/S/D4c/D4d/D4e + 在库申报）

**来源假说统一**：均为原仓 Phase4 早期批次（D1/D2/D3/E3a）的交付物，经恢复提交
1fb04b0 携带入库；原仓 SESSIONS 报告随仓库丢失，本仓 SESSIONS 无对应条目——
但代码内批次标签、决策表注释、ADR-023/024 引用完备，质量形态与本仓纪律一致。

| 批次 | 文件（类型） | 用途 |
|---|---|---|
| Phase4-D1 | p4d1-editor-wrap.e2e-spec.ts（A，测试）；VditorEditor.vue（M，与 D2 共享） | 编辑器包装层回归锚（转义注入面 + B3.5 自托管同步义务） |
| Phase4-D2 | p4d2-media.e2e-spec.ts（A）；MediaPicker.vue、lib/media-ref.ts（A）；lib/image-src.ts（M）；CodeMirrorEditor.vue、AboutEditPage.vue、CollectionListPage.vue（M）；albums.service.ts（M）；diary.ts（M，1 行文案，假说归属） | 统一选图器（媒体库/相册/外链）+ 引用形态中心（幂等语义） |
| Phase4-D3 | p4d3-nav.e2e-spec.ts（A）；shared/nav-config.ts（A）；site-config.controller.ts（M）；api/config.ts（M）；RichArticleListPage.vue（M）；shared/site-config.ts（M）；theme.css（M，D3 圆角 token + D4e 变量族） | 导航受控子集管理（ADR-020 追加节、ADR-023 token 映射） |
| Phase4-E3a | p4e3a-theme-lock.e2e-spec.ts（A，14 例含 ⑭ [Phase4-D4/配套2]）；theme-registry.service.ts、theme.controller.ts、theme.module.ts、shared/theme-profile.ts（A）；app.module.ts、site-config.module.ts（M） | theme-lock 机制（ADR-024：Registry + Theme Profile + Tier 1 档案） |
| Wave-2 补测 | 六 common spec（A，59 例） | 重构提取单源模块的补测（见 G2） |
| 未归属 | docs/README.md（A） | 仓库索引文档；**含失真数据**（"test/ 250 用例"，实测 484） |
| （对照）Wave-2/B2 | p5d-slug-uniqueness.e2e-spec.ts（A，4 例） | **非非授权**——refactor-implementation §4.3 明文"本次新增" |

---

## G2 测试增量溯源

### G2.0 权威基线（双法互证 + 崩溃跑修正）

- **Phase3-F 终态（d4ebf43）= 373 例 / 42 文件**：静态计数 369 + engine.spec
  循环生成差 4（`for (const {name…}) it(...)` 9→现 5 案例数组形态、blob 双版本同一，
  18 静态 + 5 生成 = 23 实跑）→ 373，与 SESSIONS 台账吻合 ✓。
- **恢复后（1fb04b0+W4-A）= 480 例 / 54 文件**；**D4f 后（HEAD）= 484 例 / 55 文件**
  （vitest JSON 权威复跑，本轮 55 文件全跑通零崩溃）。
- ⚠️ **基线修正申报**：D4f SESSIONS 报告所记"test 475→479（+4）"系当时并行全量跑
  p11-fresh-chain worker 崩溃丢失 5 例所致（该轮 54 文件实收 479，含崩溃件 0 例）。
  权威数账为 **480→484**。本报告据实更正，不改历史提交。
- 恢复批增量 = 480 − 373 = **107**，分布：12 新 spec 文件（92 例）+ 6 个 M spec（+15）。

### G2.1 107 增量逐文件溯源表

| spec 文件 | 增量 | 批次标签（in-code） | 用途 | 授权状态 |
|---|---|---|---|---|
| p5-posts.e2e-spec.ts | +9 | [Phase4-D4/B2①~④][C2①②][B1 §6.8][S3][S4] | file-form 四规则/编辑解除/状态链/裸日期/source 投影 | ✅ D4 系（用户枚举） |
| p5c-encrypted-articles | +2 | [Phase4-D4/A3] | lang/draft null 删键哨兵 | ✅ D4 系 |
| p7f-config-override | +2 | [A4] | 设→清→净态还原往返 | ✅ D4 系 |
| p4-collections | +1 | [Phase4-D4/S1] | projects showImage | ✅ D4 系 |
| process-manager.spec | +1 | [Phase4-D4/配套1] | CI=true 恒定注入 | ✅ D4 系 |
| p7h-config-override-isolation | +1（新文件） | [Phase4-D4/C3]（头注含"数账 414→417 之③"） | override 侧车路径隔离 | ✅ D4 系 |
| p4e3a-theme-lock | +14（新文件，含 ⑭ [Phase4-D4/配套2] 1 例） | [Phase4-E3a]（ADR-024） | theme-lock 机制 | ⚠️ E3a（枚举外） |
| p4d1-editor-wrap | +2（新文件） | [Phase4-D1] | 编辑器包装层锚 | ⚠️ D1（枚举外） |
| p4d2-media | +6（新文件） | [Phase4-D2] | 媒体引用形态中心 | ⚠️ D2（枚举外） |
| p4d3-nav | +6（新文件） | [Phase4-D3]（ADR-020 追加） | 导航受控子集 | ⚠️ D3（枚举外） |
| p5d-slug-uniqueness | +4（新文件） | [Wave-2/B2] | slug 全局唯一护栏 | ✅ 在库申报（§4.3） |
| atomic-write.spec | +7（新文件） | [Wave-2 补测] | 原子写单源（清理承诺锚） | ⚠️ 无申报（见 G2.2） |
| mizuki-root.spec | +10（新文件） | [Wave-2 补测] | root 解析/监狱 | ⚠️ 无申报 |
| article-row.spec | +10（新文件） | [Wave-2 补测] | frontmatter→行映射/状态推导 | ⚠️ 无申报 |
| url-path.spec | +19（新文件，含 it.each） | [Wave-2 补测] | 路径段解码三态 | ⚠️ 无申报 |
| segment-name.spec | +6（新文件） | [Wave-2 补测] | 单段名 schema | ⚠️ 无申报 |
| zod-issues.spec | +7（新文件） | [Wave-2 补测] | zod→400 issues 形状 | ⚠️ 无申报 |
| **合计** | **107** | | | D4 系 17 / D1-D3+E3a 27 / p5d 4 / 补测 59 |

（其余 39 个 spec 文件 Phase3-F 后零增量；engine.spec 19 静态 = 23 实跑为循环生成形态差异，非增量。）

### G2.2 「58 个增量」数值对账（授权指令数字的来源解释）

- 库内可证台账检查点：**417**（p7h 头注"数账 414→417"）= 373 + 44（全部
  [Phase4-D*]/E3a 标签内容，即 D1~E3a + D4 系全部原仓批次增量）。
- 实测恢复后 480 − 417 = **63**（= 59 补测 + 4 p5d）为台账外增量；其中 p5d 有在库
  申报 → 真正无申报面 = **59**（六补测 spec，恰为 refactor-implementation §4.3 所称
  "59 个新增单测全绿"，而 §3 却称"未新增测试"、§6 又建议补测——三处自相矛盾，
  测试系恢复期/丢失提交携带，无独立批次申报）。
- 授权指令的 **58** = 475（D4f 报告误报基线，崩溃跑 −5 幻差）− 417 ✓ 数值精确吻合；
  即 63（真值）− 5（幻差）。若按"仅补测"口径则为 59 ± 1。
- 另一开放残差：refactor-review 称 D4e 终态 451 例 / 40 文件，与本仓恢复结果
  （417 + 4 + 59 = 480 / 54 文件）差 29 例——原仓口径本仓不可再现（恢复提交系合并
  重建非全量移植），留架构师台账对账（G4-⑧）。

---

## G3 lint 8 条定性

| # | 文件:行 | 错误 | 定性 | 依据 |
|---|---|---|---|---|
| 1 | articles.controller.ts:15 | BadRequestException 未用 | **授权文件（P8）的恢复损伤** | d4ebf43 版 import+1 用法（`limit 超出上限 50` 手工 400）→ 恢复批将分页解析上收 common/http/pagination（refactor §1），用法删除、导入残留 |
| 2 | articles.service.ts:17 | BadRequestException 未用 | **授权文件（P8/Wave-2）的恢复损伤** | 旧版 `requireRoot()` 抛 BadRequest → 上收 common/fs/mizuki-root（requireMizukiRoot），用法删除、导入残留 |
| 3 | site-config.service.ts:26 | BadRequestException 未用 | **授权文件（C7）的恢复损伤** | 旧版 `mizukiRoot 未配置` 检查 → 同上收 mizuki-root，用法删除、导入残留 |
| 4-8 | theme-registry.service.ts:23,34,36,37,38 | NotFoundException + AsExpression/ParenthesizedExpression/SatisfiesExpression/SyntaxKind 共 5 项未用 | **G1 非授权文件（E3a 恢复件）自带损伤** | 文件系恢复批 A（E3a）；ts-morph 类型未用系 refactor 将其私有 unwrapExpression 上收 evaluator（refactor §1 注记"theme-registry 也私有一份"）后导入残留；NotFoundException 出生即未用 |

结论：8 条全部恢复批引入（d4ebf43 终态 lint 0/0）。#1-3 = 授权文件损伤，修复方案 =
各删 1 行未用导入（合计 3 行）；#4-8 = 随 E3a 文件归属裁定（补授权 → 删 5 行导入；
回滚 → 随文件消失）。**本批禁自主修，全部待裁后执行。**

---

## G4 申报待裁（处置建议，逐项理由）

| # | 对象 | 建议 | 理由 |
|---|---|---|---|
| ① | Phase4-D1/D2/D3/E3a 文件 + 27 测试 | **保留 + 补授权** | 功能在用（媒体选择器/导航管理/主题锁均被现行面板与 D4/D4f 链依赖，如 PostEditPage 的 MediaPicker=D2、p4e3a 含 D4 配套锚 ⑭）；代码内批次文档完备（ADR-023/024 引用）；回滚 = 功能回退 + D4 系锚断裂。补授权动作：架构师按原仓台账追认 + SESSIONS 补记批次条目 |
| ② | Wave-2 补测 6 spec（59 例） | **保留 + 补授权** | 测试对象全部为重构授权单源模块；refactor §6 本身建议补测（点名 atomic-write/url-path/zod-issues 三项）；补测头注自述义务（"清理承诺必须有测试锚，否则下次重构会静默丢失"）；删除 = 安全关键模块（原子写/路径监狱/zod 400 形状）裸奔。补授权动作：SESSIONS 补记「Wave-2 补测」条目 + 对 §3"未新增测试"表述追加勘误注记 |
| ③ | p5d（4 例） | 保留（已在库申报） | §4.3 明文；台账对齐动作：数账表补记 417→421 段 |
| ④ | docs/README.md | **修订后保留** | 索引价值在；但"250 用例"失真（实测 484）须修订；亦可裁定删除重写 |
| ⑤ | diary.ts describe 1 行文案 | 随 ① D2 补授权追认 | 零行为影响（describe 提示文案） |
| ⑥ | lint #1-3（3 行未用导入） | 待批后修复（删导入） | 授权文件恢复损伤；修复面极小且零行为 |
| ⑦ | lint #4-8（theme-registry 5 行） | 随 ① E3a 裁定 | 文件归属先行，lint 处置随后（补授权 → 删 5 行导入） |
| ⑧ | 451→480 残差（29 例） | 留台账对账（开放项） | 原仓 D4e 终态口径本仓不可再现；建议架构师以原仓 SESSIONS 台账对 1fb04b0 内容做一次差额核对，确认恢复提交是否有未携带内容 |
| ⑨ | D4f SESSIONS 数账 | 本报告 G2.0 已更正申报 | "475→479"→"480→484"（崩溃跑幻差 −5）；不改历史提交 |

## 复现命令（核验依据）

```
git cat-file -t 50dbe27b / 55b5a5e8        # → fatal（对象不存在）
git fsck --unreachable                      # → 零悬空
git show 1fb04b0 --name-status --format=     # → 106 文件（A41/M65）
git diff --name-status 0d54c27 d4ebf43      # → 仅 docs/.gitignore（基线锚定）
git show d4ebf43:apps/.../engine.spec.ts    # → 循环生成 5 案例（blob 与 HEAD 同一）
pnpm --filter @mizuki/server exec vitest run --reporter=json --outputFile=<tmp>
                                            # → 55 文件 / 484 例（权威）
```
