# 【批次 U1 · 架构师授权 2026-10-17 · 数账基线 490】

> 面板 UI 全面重设计 —— Mizuki 官方博客风格（大圆角 / 二次元 / 实用性提升）
> 执行模型：Gemini 3.8 Flash（本批对执行侧的纪律要求按「强约束防跑偏」档位出具）

## 0. 任务定位（先读，防跑偏）

你（执行侧 AI）的任务是**重设计管理面板的视觉与交互层**，不是重写功能。一句话范围：

**让 `apps/web` 面板长成 Mizuki 官方博客的样子**——大圆角、柔和圆彩、二次元亲和力——同时保持全部既有功能行为、测试基线与架构红线不变。

「重置菜单栏和全部 UI」= 视觉与交互层重做；**不** = 换组件库、不 = 重写业务页面逻辑、不 = 动任何后端文件。

**双重不变量（全批最高优先级，冲突时其它条款让位）：**
- I1 `pnpm lint` 0/0 与 `vue-tsc` 0 不许倒退；
- I2 ADR-026 自定义主题换肤链不许断裂：`theme.css` 的 token 体系是唯一色源，
  ADR-026 的变量覆盖式换肤（预设四色 + 自定义 CSS）必须在本批重设计后**依然全功能可用**。

### 风格判例（预裁，省你来回问）

| # | 问题 | 裁定 | 依据 |
|---|---|---|---|
| J1 | 大圆角到底多大？ | 主题 `--radius-large: 1rem` 是「主档」；本批可**升格**为两级体系：主容器 1.25rem（20px）、内层控件 0.75rem（12px）、胶囊 999px。禁止出现第三种视觉尺寸的圆角档 | Mizuki `variables.styl:12` 实测 + 升格理由：全屏面板尺度大于博客卡片，等比放大 |
| J2 | 色彩基调整体偏什么？ | **樱花粉主色不动**（`--mizuki-primary: #e8739e` 体系是品牌色，ADR-026 预设也靠它生成）；重设计的重心是**形状语言 + 状态层 + 微动效**，不是换色 | ADR-026 换肤链不可断 |
| J3 | 二次元感从哪来？ | 从「材质与反馈」来，不从贴纸/emoji 来：柔和大圆角容器、极淡描边、悬浮上浮（translateY(-2px)）、彩色柔影、渐变按钮、俏皮但克制的 hover 动效。**禁止**在管理面板里加看板娘、樱花飘落、鼠标跟随粒子等装饰性动画 | 「让 UI 更实用」是并列目标，装饰性元素判负 |
| J4 | 菜单栏（侧栏）重置的边界？ | 可重排/可加图标/可改交互（如折叠、分组标题样式），但**路由表、菜单数据结构（MENU 数组语义）、manage 模式过滤逻辑零触碰**——只动 `MainLayout.vue` 的模板与样式层 | B2/裁决 7 既有定案 |
| J5 | Element Plus 组件要不要换皮？ | 不换库不换组件。用 CSS 变量层（`--el-*`）与 `:deep()` 定制即可覆盖 90% 观感；确需深度定制处用 `el-config-provider` namespace 前缀也不引入 | 零新增依赖纪律（ADR-027 lockfile 漂移前科） |
| J6 | 暗色模式怎么办？ | 亮/暗两套 token **成对**提供（theme.css 既有格局）。任何新 token 必须在 `:root` 与 `html.dark` 各有一值，禁止只写亮色 | theme.css 既有双块纪律 + ADR-026 后果条款 |
| J7 | 字体？ | 不引入新字体文件。`font-family` 栈在 theme.css 加一行声明即可（系统栈 + 圆体倾向：`"PingFang SC", "Microsoft YaHei UI", "HarmonyOS Sans SC", system-ui, sans-serif`），禁止 webfont/CDN 引入 | 离线可用 + 零依赖 |
| J8 | 响应式？ | 面板最低支持宽度 ≥ 1280px 不塌；窄屏优化只做侧栏折叠（el-menu collapse）级别的适配，不做移动端整套 | 既有验收先例 1280px（B1 验收条款 2） |

## 1. 上下文注入（实现前必读）

1. `docs/decisions/ADR-026-panel-custom-theme.md` —— 换肤链原理（变量覆盖、注入点、双实现纪律）
2. `docs/decisions/ADR-027-web-build-esbuild-bypass.md` —— vite.config 是**敏感区**，本批禁碰
3. `apps/web/src/styles/theme.css` —— 现有 token 全景（色阶/圆角三档/终端/Vditor/侧栏变量族）
4. `apps/web/src/layouts/MainLayout.vue` —— 现有侧栏结构（MENU 数组 + 分组渲染 + D4e 胶囊导航）
5. `apps/web/src/lib/custom-theme.ts` —— 预设生成逻辑（J2 的原因：改 `--mizuki-primary` 会破坏预设混色)
6. Mizuki 官方主题风格源（参考基准，只读不抄不 import）：
   `<mizukiRoot>/src/styles/variables.styl`（oklch 色板 + `--radius-large` 1rem）
   `<mizukiRoot>/src/styles/gradient-buttons.css`（135° 渐变 + 上浮 + 彩影）
   `<mizukiRoot>/src/styles/panel-Animations.css`（浮层动效）、`scrollbar.css`（胶囊滚动条）

## 1.5 数账基线（全批数字纪律）

- 基线 **490（57 文件）** / build 0 / lint 0/0 / vue-tsc 0。本批**不新增后端测试**，基线数不动。
- 本机 p9/p9b 6 例环境性失败（DSH 运行时无 npm/pnpm）为既有事实，非本批范围，勿修勿报为回归。
- 数账申报只认全绿轮（R6）：含崩溃/环境失败的轮次禁作数账基线。

## 2. 任务分解

### T1 —— Token 层扩展（theme.css，唯一改色源）

在 `theme.css` 扩充「Mizuki 官方风格 token 族」（亮暗成对），至少覆盖：

- **圆角两级**: `--mizuki-radius-card: 1.25rem`（主容器 20px）、
  `--mizuki-radius-control: 0.75rem`（控件 12px）、`--mizuki-radius-pill: 999px` 保持；
  `--el-card-border-radius` / `--el-border-radius-base` 随之重挂
- **交互反馈族**：`--mizuki-lift-shadow`（悬浮态投影）、`--mizuki-press-shadow`（按压态）、
  `--mizuki-focus-ring`（键盘焦点环，主色半透明）
- **渐变族**：`--mizuki-gradient-primary`（135° 主色渐变，供按钮/强调面）
- **描边族**：`--mizuki-border-hairline`（极淡描边，对齐主题 `--line-divider` black(0.08)）
- **动效族**：`--mizuki-motion-fast: 150ms`（对齐主题 `--content-delay`）、
  `--mizuki-motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`（回弹曲线，hover/激活用）
- **页面背景**：`--mizuki-page-bg` 保留渐变但可微调角度与首色饱和度（≤10% 偏移，禁大改）
- **透明面**：`--mizuki-glass-bg` + `--mizuki-glass-blur`（顶栏毛玻璃材质，暗色用暗值）

纪律：全部新 token 命名走 `--mizuki-` 前缀；element 变量只引用本层（沿用既有格局）；
**`--mizuki-primary` 色值与 light-3..9/dark-2 混色阶、`custom-theme.ts` 混色算法一个字符都不许动**（J2/I2）。

### T2 —— 菜单栏重置（MainLayout.vue，模板+样式层）

- 侧栏容器视觉重做：大圆角浮岛卡（脱离通高通宽旧式）、hover 上浮微动效（仅容器级，不做逐项动画轰炸）
- 菜单项：图标 + 文字。图标**零依赖**：优先内联 SVG（沿用顶栏主题三态图标的既有先例，主题切
  换按钮的三个 svg 就是仓库内范例）；备选 `@element-plus/icons-vue`——**架构师已预查：
  2.3.2 已随 element-plus 装在 node_modules（pnpm hoisted），直接 import 即用，无需改
  package.json**；两案任选，均不构成新增依赖
- 菜单分组标题样式化（当前是朴素灰字：可做小号大写字距样式增强层级感）
- 顶栏毛玻璃化（T1 的 glass token）+ 品牌字渐变保留
- 移动窄屏（<1280px）：侧栏 collapse 成图标模式（el-menu 已内置 collapse prop，接线即可）
- **零触碰清单**：MENU 数组语义（path/title/minimalHidden/group 字段含义）、
  `visibleMenu` 过滤逻辑、`MINIMAL_HIDDEN_PREFIXES` 重定向、路由表、manage 模式行为

### T3 —— 全页面观感统一（views/** + components/**，样式层为主）

将 J1~J3 判例落到每个页面，**允许改模板结构但禁止改业务逻辑**（script 部分的行为语义不变）：

- **统一容器**：所有页面根容器走 `panel-card` 或新容器类（token 驱动），消灭页面级硬编码
  border-radius / box-shadow / color
- **表格**：el-table 去硬边框感——行 hover 底色走主色 light-9、圆角包裹（`:deep()` 包裹层圆角）
- **按钮**：主操作按钮可走渐变族 token（J3 克制原则：一个页面**至多一个**渐变主按钮，
  其余常规）；危险操作保持 danger 色系
- **表单**：el-input / el-select 圆角随 control 档 token；focus 状态走 `--mizuki-focus-ring`
- **弹窗/抽屉**：el-dialog 圆角升 card 档 + 出入场动效（150ms 缩放+淡入，回弹曲线）
- **空态/加载态**：el-empty 自定义插图可换成 SVG 插画（零依赖内联 SVG，允许适当二次元感
  —— 例如简笔小猫/樱花枝 SVG 手绘风，但保持克制）
- **滚动条**：全局胶囊滚动条（`::-webkit-scrollbar` + Firefox `scrollbar-width: thin`），
  走主题 scrollbar token 同源色值（亮 black(0.4)、暗 white(0.4) 同型）；本仓终端滚动条
  既有 `--mizuki-terminal-scrollbar` 豁免，保留不并入
- **登录页**：大圆角卡片居中 + 渐变背景 + 品牌感强化（LoginView 可做视觉重点页）
- **初始化向导 / 控制台 / 编辑器页**：编辑器页面（PostEditPage / RichArticleEditPage）
  的**功能布局不动**（D4f/E1b 刚验收过，窗口拉伸已定案），只做容器与工具栏的观感升级

T3 是本批量级最大项，执行侧按「先全局类后逐页」顺序推进，每页改完即自查
「该页硬编码颜色/圆角/阴影是否清零」。

### T4 —— 视觉回归与交付报告

- 每页改造后：`pnpm --filter @mizuki/web build`（即 vue-tsc + vite build）通过
- 全批收尾三连：`pnpm build && pnpm lint && pnpm test`（本机 p9 系 6 例环境性失败豁免，
  申报时注明）
- **换肤链回归（I2 专项验收）**：主题外观页四套预设逐一切换 + 自定义 CSS 条目应用 +
  恢复默认，全程正常；重设计后新增 token（T1）在四预设下不产生违和（预设只覆盖色阶
  token，新形状 token 应保持中性灰阶/主色派生，不与预设冲突）
- 截图留证：亮/暗 × 主要页面（仪表盘/文章列表/编辑器/媒体库/登录页/主题页）入
  `docs/audits/ui-u1/`，报告申报每张
- 交付报告格式：文件清单（新建/修改分列）、判例遵守情况自查表（J1~J8 逐条）、
  硬编码清零自查、换肤链回归记录、遗留疑问清单、CHANGELOG + SESSIONS 追加「UI-U1」条目

## 3. 禁止事项（红线,违者打回）

1. **零新增依赖**（唯一例外：`@element-plus/icons-vue` 且需先查已装）——ADR-027 的
   terser 事件已证明本仓 lockfile 极敏感；
2. **禁碰**：`apps/server/**`、`packages/shared/**`、`apps/web/vite.config.ts`、
   `apps/web/src/lib/custom-theme.ts` 的混色算法、`PostFrontmatterSchema`、
   TipTap/Vditor/CodeMirror 编辑器的功能逻辑与 `handlePaste/handleDrop` 逻辑；
3. **禁碰** Mizuki 官方主题目录（`<mizukiRoot>`）任何文件——只读参考；
4. 组件库锁定：不引入第二套组件库、不用 Tailwind/windicss/unocss（本仓不是原子 CSS 架构）；
5. `theme.css` 里 `--mizuki-primary` 及其混色阶、`custom-theme.ts` 任何逻辑禁止改动
   （I2：换肤链）；页面级硬编码颜色/圆角/阴影在本批清零（新硬编码不产生）；
6. 测试与数账：不新增/删除/修改任何 `apps/server/test/**` 文件；490 基线不动；
7. git 纪律：允许 add/commit，**禁止 push**、禁止 stash、禁止改写历史；破坏性操作前置
   preWriteBackup 思维——本批全部是前端样式改动，理论上无破坏性写盘，如遇 `git checkout --
   <file>` 需先确认该文件无未保存的编辑器窗口打开；
8. e2e 交互面铁律继承：本批不写新 e2e，但**既有 e2e 不得因 UI 改动而红**（如选择器
   失配）——T3 动 class 名/结构前先 grep 既有测试的 selector 依赖（本仓 e2e 在
   `apps/server/test/`，全部打 API 不碰 DOM，理论零影响，但申报时注明已核查）。

## 3.5 停止条件（停下并报告，等架构师）

- 任何禁止事项与任务冲突（例如某页观感升级必须动业务逻辑才能实现）；
- 发现疑似 UI 缺陷但不在本批授权面内（申报不代修，纪律行第 1 条）；
- `@element-plus/icons-vue` import 失败（架构师预查在装，若实测解析异常即停）；
- 换肤链回归发现预设与新 token 视觉冲突无法两全（I2 与 T3 冲突时，I2 胜）。

## 4. 完成即停

T1→T4 顺序执行，T4 交付报告落 SESSIONS 后停。不做 T4 之外的多余「顺手」项
（例如发现某页 UX 流程可以更好——记入报告的遗留清单，不动手）。

—— 架构师签发 2026-10-17 ——
