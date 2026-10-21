# U3-P4b 交付与验收报告 — 物化态只读警示 + 主题漂移呈现面板 + DEF-06

> [批次] U3-P4b（`docs/prompts-ui/U3-P4b-config-warn-theme-drift.md`）
> [PM 裁定] 2026-10-21：C7 疑问② 立项、E3b 解冻、**DEF-06 并入本批**
> [提交] `c2a05f3`　[前置] HEAD `7ab8b9d`（U3-P4a/P4c 已落地）
> [架构师验收] 2026-10-22 —— 通过（独立复跑见 §5）

## 1. 交付面

| 裁定 | 落地 | 证据 |
|---|---|---|
| **K1 `overrides` 视图字段**（additive，形状冻结） | `site-config.service.ts`：`AdminSiteConfigView.overrides` + `getConfig()` 组装，全部取自已读的 `carrier`；**零新端点、零新文件读、零 shared 改动** | 7 字段：`lang/comments/nav/siteInfo{active,keys}/profile/announcement/originalsKeys`；一律 `!== undefined` 判定（空值接管不误报为未接管）；`keys` 字典序；**只出布尔与键名，`originals` 原文永不进响应** |
| **K2/K3 四格警示条 + 分域还原措辞** | `apps/web/src/lib/config-overrides.ts`（分类单源）+ `SiteConfigPage.vue` **插入式**一条 `el-alert` | 键缺失 → **不渲染**（fail-open）；空 → info「当前无物化」；非法 → 「物化态未知（视图字段异常）」且零额外请求；合法 → warning + 已物化清单 + 分域回退（lang 清空即还原 / nav 还原按钮 / comments·siteInfo·profile·announcement「无还原入口，原文已留档」）——**无任何统一「可随时还原」** |
| **K4 `/theme-status` 新页** | 新 `ThemeStatusPage.vue`（493 行）+ `api/theme.ts` + 路由 `:65` + `MainLayout` group 配置 + `MenuIcon` 新分支 | `/theme` 已被面板外观页占用，故另立；图标与「主题外观」可区分 |
| **K5 五段展示** | 身份 / 指纹 / 基线（四态） / 漂移（三态） / 探针 | 枚举**逐一列名**：`drift.state` = `no-baseline·clean·drifted`；`baseline.state` = `absent·loaded·version-mismatch·parse-error`；`role` 四值中文；`sha256===null` 显「不指纹（目录级）」；`no-baseline` 不渲染空表 |
| **K6 capture 唯一写** | 二次确认 + 成功用响应体渲染 + 失败不谎报 + `finally` 无条件重拉 | 写失败（500）时**不置任何「已捕获」** |
| **K7 内部路径遮蔽** | `apps/web/src/lib/mask-path.ts` | 盘符路径与「≥2 段且末段带扩展名」的 POSIX 路径投影为 `…/<basename>`；**刻意不匹配** `/api/v1/...` 接口路径 |
| **DEF-06（PM 并入）** | **`apps/server/src/common/fs/path-projection.ts`（唯一实现）** + 两 service 四处文案改用投影 + pino 补绝对路径日志 | 三规则：根内相对 / 带 `data` 段的越界归一到 `data/…` / 其余越界 `<data>/<basename>`；**永不回退绝对路径**；错误码与语义零变化（仍 500 `InternalError`、`detail:null`） |

## 2. 不变量核对（架构师独立复核）

| 不变量 | 核对结果 |
|---|---|
| I1 零新依赖 | `pnpm-lock.yaml` 与四处 `package.json` 零变动 ✅ |
| I2 `/public/**` 零 diff | ✅（本批不涉公开面） |
| I3 管理 API additive | `GET /admin/config` 仅增 `overrides`；`GET status` / `POST capture` 含 201 与响应体**零 diff** ✅ |
| I4 写盘单源 | capture 仍走既有 `atomicWriteFile` 写基线；前端零写盘（无 localStorage/cookie）✅ |
| I5 不碰主题源码 | p4e3b ② 断言 capture 前后 `src/config.ts` sha256 相等 ✅ |
| I6 不外泄 | `overrides` 只出布尔+键名；`originals` 原文仅键名；`detail` 经投影；p7l ⑧ 断言响应无 `SITE_LANG` 原文、无 `"originals":`、无盘符 ✅ |
| I7 测试隔离 / 不 push | 全 `mkdtemp` + env 注入；未 push ✅ |
| I8 数账 | 净增 **+11**（p7l 8 + p4e3b 3），实测 585 → **596** ✅ |

## 3. 测试落点与实测

- 新建 `p7l-config-override-state.e2e-spec.ts`（8 例）：无侧车全 false / `PUT lang` / `PUT nav {links:[]}` 空值接管 / siteInfo keys 字典序（含 `{}` 空对象接管）/ originalsKeys 首留档与二次 PUT 不变 / `PUT lang ''` 清除后布尔转 false 但留档键仍在 / 去掉 `overrides` 后与改动前**逐键全等**（sha256 快照钉住）/ 不外泄 + **DEF-06 ②**（侧车损坏 → 500 且响应无盘符）
- 新建 `p4e3b-theme-capture-write.e2e-spec.ts`（3 例）：`GET status` 过 `ThemeStatusViewSchema.safeParse` + **DEF-06 ①**（基线坏 JSON → `detail` 含 `data/theme-baseline/baseline.json`、不匹配 `/[A-Za-z]:\\/`、无临时域前缀）/ `POST capture` 201 + `drift=clean` + 主题源码 sha256 不变 / 写失败 500 + 无 `.tmp-*` 残留 + 基线状态不被污染
- 回归：`p7f`(16) `p7h`(1) `p7i`(16) `p7j` `p7k`(8) `p7m`(11) `p4e3a`(14) 全绿
- **架构师独立复跑**：`p7l` + `p4e3b` = **11/11**；`tsc -p apps/server` 零输出；`vue-tsc -p apps/web` 零输出；全量 **596/596（68 文件）**；`pnpm build` 0；`pnpm lint` **0:0**

## 4. 执行方申报的偏差（架构师裁定）

| # | 偏差 | 裁定 |
|---|---|---|
| B-1 | §4.1 ④「PUT site-info 三键」物理不可行：`SiteInfoSchema` 11 键必填（controller body = 完整 schema，非 partial） | **采信**。三键场景改「侧车直落 + 真实 PUT 全档」双锚；登记为**既有契约约束**（F9），非本批缺陷 |
| B-2 | `originalsKeys` 不含 `commentConfig` | **采信**：该域整档置换且不记留档（ADR-020 §6 无还原路径）；「布尔 ≠ 留档」两件事，已在 spec ⑤ 注释 |
| B-3 | 投影兜底：带 `data` 段的越界路径归一到 `data/…`，`<data>/…` 仅用于无 `data` 段兜底 | **采信**：否则字面量会出现 `data>/…`，与 DEF-06 断言自相矛盾。两种形态均已由单源自校验钉住 |
| F-1 | 四格未覆盖「六域全 false 但 originalsKeys 非空」（`PUT lang ''` 后可达） | **采信**：归 info 格 + 补一句「服务端仍保留 N 个留档键」，不另立格 |
| F-2 | 分类逻辑抽到新文件 `lib/config-overrides.ts` | **采信**：单源 + 可用 Node 直接验证（15 例私有 harness），页面保持插入式 |
| B-4 | 为采集「改动前快照」临时复原两文件再恢复 | **采信但记警示**：属 R5 类操作，须 sha256 核对（执行方已核对并复原）。后续同类做法一律先备份再动 |

## 5. 已知缺口（不追补，登记在案）

1. **`effects` 无探针轴保护**（P4c 遗留，K16 明示不扩）：主题结构升级时只能靠 splice 的「声明存在 + 对象字面量形态」检查兜住 —— 不会误写，但诊断文案不如探针明细。
2. **`PUT /admin/config/site-info` 必须整档**（11 键必填）：面板始终全档回填，故 UI 无感；但外部调用方不能只发部分键（F9）。
3. `capture` 失败路径（500）在面板侧只能给出 `InternalError` 文案 —— 全局错误形状固定（`detail:null`），诊断仍需看 pino。

## §commit

`feat(U3-P4b): 物化态只读警示（overrides 视图字段）+ 主题漂移呈现面板 /theme-status + DEF-06 内部路径投影` → `c2a05f3`
