# ADR-026：管理面板自定义主题（预设选择 + 自定义 CSS 上传）

- 状态：ACCEPTED（2026-10-16，用户直派需求）
- 关联：ADR-013（对齐框架）、ADR-017（上传白名单——本 ADR **不**扩媒体白名单）、
  ADR-024（主题档案与漂移基线——本 ADR 作用域为**面板自身**，不触发主题侧门禁）、
  `apps/web/src/styles/theme.css`（色变量唯一源）、`apps/web/src/lib/theme.ts`（亮/暗/自动三态）

## 背景

用户需求原文：「给该项目增加一个可以切换主题的功能，可以让用户自行上传 css 和选择样式来
改变该项目的主题」。歧义在「该项目的主题」——本仓有两层「主题」语义：①被管理的 Astro 博客
主题 Mizuki（`<mizukiRoot>/src/**`，受红线 1/2 与 ADR-024 门禁保护）；②管理面板自身外观
（`apps/web/src/styles/theme.css` 的 token 层）。

经人工裁决（选项「管理面板（apps/web）」）**锁定作用域为 ② 面板自身**。该裁决的直接收益：
改动即时生效、零构建链耦合、零主题文件写入、不动 Mizuki 根与任何后端面。

既有事实（侦查确认）：面板色彩体系已是单源 token 层——`styles/theme.css` 定义
`--mizuki-primary` / `--el-color-primary` 及其 light-3..9、dark-2 阶梯、`--mizuki-page-bg`、
`--mizuki-card-shadow` 等；`theme.css` 在 `main.ts` 中于两份 element-plus CSS **之后**导入，
故后置注入的 `<style>` 天然可覆盖全部 token。

## 决策

1. **作用域与注入点**：只覆盖 CSS 变量，不改 `theme.css` 文件本体。运行时向
   `document.head` 追加**唯一** `<style id="mizuki-custom-theme-style">`（位置晚于 element-plus
   与 `theme.css`），以 `:root { … }` + `html.dark { … }` 两块变量覆盖实现换肤；
   恢复默认 = 移除该节点，`theme.css` 与既有三态亮暗逻辑零改动、随时可退。
2. **载体与持久化**：纯浏览器本地，键 `mizuki.customTheme.active`（激活 id，缺省即默认主题）
   与 `mizuki.customTheme.items`（自定义条目数组）。**不新增后端 API、不建表、不改
   `packages/shared`、不写 `data/`**。代价显式化：配置 per-browser、不跨设备同步——页面
   `el-alert` 明示，属「面板自包含」裁决的固有结果而非缺陷。
3. **预设形态**：四套预设（薄荷青 / 天空蓝 / 暮光紫 / 落日橙）**由代码生成**而非预置 CSS 大块：
   按 Element Plus 混色口径算出 light-3/5/7/8/9、dark-2、页面背景渐变、卡片阴影。
   权重口径冻结：`light-N = primary×(10−N)/10 + base×N/10`（亮色 base `#ffffff`、暗色 base
   `#141414`）；`dark-2` 亮色 20% 黑、暗色 15% 白；页面背景渐变首色亮色 0.9 / 暗色 **0.92**
   白黑混合（0.92 对齐主题原生暗底 `#181015` 观感）。暗色主色为预设自带第二色值。
4. **限额与校验**（值域冻结）：自定义条目 ≤ **20** 条，单条 CSS ≤ **200 000** 字符
   （上传文件按同口径拦），名称 ≤ 50 字符；空名、超限、指向不存在的 id 一律抛中文可读错误
   （`Error`），面板以 `ElMessage` 呈报。存储内容损坏（非数组 / 缺字段 / 空 css 等）由
   `sanitizeItems` 静默过滤，不炸启动路径。
5. **防闪白与双实现纪律**：`index.html` 内联脚本（ES5 纯函数，早于首帧）复制同一套混色与
   原文注入逻辑，`main.ts` 中 `initCustomTheme()` 启动后**接管同一 style 节点**（同一 id，
   不叠加节点）。因此存在两份等价实现——**必须逐字等价**，由
   `.test-tmp/ct-probe/probe-inline.cjs` 抽出内联脚本在 Node 桩件下与模块输出比对
   （本次已抓出并修正暗色背景渐变 0.92 vs 0.9 漂移）。改任一侧混色口径必须同步另一侧并重跑该探针。
   ⚠️ 探针位于 **gitignored 临时验证区** `.test-tmp/`（§4.9），不入库、随该区清理即失效；
   如需长期守护，应迁入 `apps/web` 的正式测试面（当前 `apps/web` 无测试运行器，故暂置临时区）。
6. **上传面**：仅接受文本读取（`File.text()` + 扩展名/MIME 提示 `accept=".css,text/css"`），
   内容按纯文本写入本地存储、以文本节点注入，不解析、不执行、不落盘。**不扩媒体白名单**
   （ADR-017 终集九扩展名不受影响）。

## 理由

- 面板色系已是 token 化单源，变量覆盖是唯一零侵入换肤路径；写 `theme.css` 文件会导致
  「用户上传 → 改了仓库源文件」，与红线 1（写盘只走既有单源能力）与本仓「面板不写自身源码」的
  事实惯例冲突。
- 后端零参与使本特性不触碰冻结的公开 API（红线 7）、依赖分层（红线 3）与输入边界（红线 5）：
  自定义 CSS 不经过服务端，天然无「外部输入落盘」风险面。
- 预设代码生成避免四套大块 CSS 入库；代价是混色口径成为需双实现同步的纪律点（见决策 5）。

## 后果 / 限制

- 自定义主题**不跨设备、不跨浏览器**同步；清浏览器存储即丢失。
- 自定义 CSS 能力等同「用户在自己浏览器里给自己加样式」——作用域限本机面板，不注入博客产物。
- 暗色/亮色两份变量块均需成对提供，否则某一态回落默认色（属预期：只写 `:root` 的自定义
  CSS 在暗色下不生效，用户需自行补 `html.dark`）。
- 内联脚本与 `lib/custom-theme.ts` 的等价性靠探针守护，无编译期约束（内联无法 import 模块）。

## 验证（本轮实测）

- `vue-tsc --noEmit -p apps/web/tsconfig.json` → **exit 0**（覆盖新增 lib 与页面）。
- 模块行为探针 `.test-tmp/ct-probe/probe.cjs`（gitignored 临时区）：**43 项全过**（预设结构与混色方向性、激活/停用
  注入与键、编辑器同 id 覆盖、20 条上限、非法 id、启动接管、删除激活项级联、损坏存储过滤）。
- 内联一致性探针 `.test-tmp/ct-probe/probe-inline.cjs`：**8 项全过**（四套预设逐字一致、
  自定义原文注入、无 active / 陈旧 id 不注入、损坏 JSON 容错）。
- 根 `pnpm lint` → **0/0（exit 0）**。
- `pnpm build`（web 环节）**本机已打通**：原先不可执行（esbuild 子进程大输入临时文件清理被环境拒绝），
  根因经 `.test-tmp/ct-probe/esbuild-repro.cjs` 五组对照钉死为「仅 esbuild 大输入临时文件清理在此机器被拒」，
  已在 `apps/web/vite.config.ts` 用 vite 7.3.6 的跳过条件绕开（`target: 'esnext'` + `minify: false`，
  CSS 仍走 esbuild）——**决策、被否决方案与代价见 `docs/decisions/ADR-027-web-build-esbuild-bypass.md`**。
  实测：`pnpm build` exit 0，产物 `index-*.js` 6,082,909 B（gzip 1.35 MB）/ `index-*.css` 437,883 B，
  构建前后 `esbuild-*` 临时残渣均为 0。
- **真实 `apps/web/dist` 浏览器端到端手验**（4199 同源静态服务）：面板挂载、console 零应用错误；
  预设应用 / 以此为基础自定义 / 自定义项应用 + 整页重载保持 / 恢复内置默认（弹窗确认）/ 删除均通过。
  细节见 `docs/SESSIONS.md` 本轮记录。
