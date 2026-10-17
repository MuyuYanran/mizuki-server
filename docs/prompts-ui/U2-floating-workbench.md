# 批次指令包 UI-U2 — 面板「工作台模式」：可拖动 / 可缩放窗口体系

【UI-U2 · 架构师授权 2026-10-17 · 数账基线 490】

> 执行模型：Gemini 3.8 Flash。本包为强约束防漂移指令：预裁决 K1~K10 已把所有设计分叉定死，
> 执行侧**不得自行扩大或缩小范围**，遇到本包未覆盖的细节按「最接近的 K 条款」类推并在报告中列出。
> 用户已裁定改造档位：**工作台模式**（见 K8 边界，桌面浮窗一步到位方案已被否决，勿做）。

---

## 1. 背景与现状（必读）

- U1 批次（Mizuki 官方风格大圆角重设计）已交付并通过架构师验收，**改动仍在工作树、未提交**。
  U2 改动叠加其上；验收后 U1、U2 将**分别成笔提交**（用户批量提交纪律）。
- 用户原话意图：「我想让每个窗口变为可动的，可自行拖动调整大小的，而不是死板的」。
- 本机环境在案事实（勿重复踩坑）：
  - 截图工具在本机对复杂页面会静默产出**空白 PNG**（U1 事故在案）——本批留证**一律 DOM 断言**，
    禁止提交 PNG 当证据；真实截图由架构师验收轮补拍。
  - `pnpm build` / `pnpm lint` / `pnpm test`（490 基线）均可在仓库根直接跑。

## 2. 目标

把「死板的固定布局」升级为「可自由摆放的工作台」，三层落地：

1. **仪表盘自由画布**：8 张统计卡 + 最近操作日志面板变为可拖动、可缩放的浮动卡片，
   布局持久化（localStorage），一键重置；
2. **弹窗全量可动**：全部 7 个 `el-dialog` 可拖动、可调宽度；
3. **编辑器分栏可拉伸**：Markdown / 富文本编辑器的元数据侧栏宽度可拖动调整，持久化。

## 3. 不变量（优先级高于一切任务；与美学冲突时不变量赢）

| # | 不变量 | 验证口径 |
|---|---|---|
| I1 | `pnpm lint` 0/0、`vue-tsc --noEmit` 0 错误、`pnpm build` exit 0 | 全绿才算完成 |
| I2 | ADR-026 换肤链不断：`custom-theme.ts`、`index.html` 内联脚本零触碰；`theme.css` 既有 token 值不改（追加新 token 须亮暗成对，预计不需要） | 逐字 diff |
| I3 | ADR-027 构建绕行零触碰：`vite.config.ts`、`pnpm-lock.yaml`、`apps/web/package.json` 零变动（**零新增依赖**，拖拽/缩放全部手写） | 逐字 diff |
| I4 | 数账基线 490：U2 只改 `apps/web/**`（+docs），不改 server/shared，测试数不动 | `pnpm test` 490/490 |
| I5 | <1280px 降级完备：浮动模式整体退化为静态堆叠，无报错、无残影、无不可达卡片（U1-J8 延伸） | 窄窗口实测 |
| I6 | 路由与导航零触碰：路由表、`MainLayout.vue`、MENU 语义一概不动（U1 刚定型，本批**禁再动**） | 逐字 diff |

## 4. 预裁决（K1~K10，执行时不再问）

- **K1 把手与尺寸约束**：卡片拖拽把手 = 卡片头（header 区）；缩放把手 = 8 方向（n/s/e/w/ne/nw/se/sw）。
  最小尺寸：画布卡片 260×160；弹窗宽度下限 360。最大 = 视口。位置钳制：卡片在画布内（允许头部
  越出画布下缘 ≤ 40px 的余量不做，**直接全量钳制在画布内**，实现最简）。
- **K2 弹窗缩放只调宽度**：SE 角 + E 边两个把手，只改 `width`；高度随内容自适应，弹窗 body
  `max-height: 70vh` + `overflow: auto`（全局 `.el-dialog__body` 规则收敛在 theme.css，勿散写页面）。
- **K3 z-index 管理**：画布卡片用模块级递增计数器（起始 100），点击任意卡片即置顶；
  弹窗沿用 Element Plus 自有层栈（2000+），**不干预不覆盖**。
- **K4 布局持久化协议**：键名 `mizuki.layout.<page>.v1`（本批共 3 个键，见 T3/T4），
  形状 `{ version: 1, cards: Record<string, { x: number; y: number; w: number; h: number; z: number }> }`。
  读取失败 / JSON 损坏 / 数值超界（NaN、负数、超出画布）→ **静默回退默认布局**，禁止抛错；
  用户未拖动过则不写键（避免无谓写入）。
- **K5 <1280px 降级**：画布容器提供 `floatEnabled`（provide/inject），窄视口时 FloatCard 渲染为
  静态堆叠（无内联定位、宽 100%、自然顺序），拖/缩把手不挂载；CSS 媒体查询作为第二重保险。
  编辑器分栏窄视口回退固定 320px。
- **K6 交互手感**：拖/缩进行中 `transition: none`（精确跟随）+ `user-select: none` + 挂 `.is-dragging`
  （lift shadow）；松手恢复 U1 动效 token。`prefers-reduced-motion` 下禁用 spring 回弹。
  拖拽进行中按 **ESC = 取消并回弹到起点**。
- **K7 视觉纪律**：FloatCard / 把手 / 分隔条全部走 U1 token（`--mizuki-radius-card`、
  `--mizuki-radius-control`、`--mizuki-lift-shadow`、`--mizuki-border-hairline`、`--mizuki-motion-*`）；
  禁新增硬编码色值 / 圆角 / 阴影。缩放把手视觉：hairline 描边小方块或短杠，hover 主色。
- **K8 「窗口」边界（用户裁定）**：可动对象 = 仪表盘 9 卡 + 全部 7 弹窗 + 两编辑器侧栏。
  **不做**：页面本体浮动、多窗口并存、任务栏、菜单栏可动（桌面浮窗方案已被否决）。
- **K9 触屏与指针**：统一 Pointer Events（`setPointerCapture`），`touch-action: none` 仅限把手
  与卡片头，不影响页面其余区域滚动。
- **K10 无障碍底线**：卡片内容保持键盘可达（按钮可 Tab、表格可聚焦）；完整键盘拖拽出本批范围
  （遗留项，报告中记一笔即可，勿实现）。

## 5. 任务分解

### T1 — 浮动窗口基础设施（新建 `apps/web/src/lib/float/`）

零依赖手写，三个文件：

1. `z-manager.ts`：模块级计数器，`export function bringToFront(): number`（首次返回 100）。
2. `use-float-card.ts`：composable，签名（TS strict，禁 any）：
   ```ts
   export interface FloatRect { x: number; y: number; w: number; h: number; z: number }
   export interface UseFloatCardOptions {
     id: string;               // 持久化键内卡片 id（如 'stat-posts'）
     storageKey: string;       // 'mizuki.layout.dashboard.v1'
     defaults: FloatRect;      // 首次布局（由调用方按画布宽计算）
     min?: { w: number; h: number };   // 缺省 260×160
     bounds: () => { w: number; h: number };  // 画布尺寸（拖/缩时活取）
     enabled: () => boolean;   // K5：窄视口 false → 把手不挂载
   }
   // 返回：{ rect, isDragging, isResizing, onHeaderPointerDown, onHandlePointerDown(dir), reset }
   ```
   要点：pointerdown → setPointerCapture → move 中实时钳制（K1）→ up 时写 localStorage（K4）；
   ESC 回弹（K6）；拖/缩中 `transition: none`。
3. `FloatCard.vue`：视觉外壳。props：`title`；slots：`default`（内容）；
   根元素绝对定位，样式全走 token（K7）；结构 = 卡片头（拖拽把手，含标题）+ 内容区 +
   8 个缩放把手（`.float-handle--n/s/e/w/ne/nw/se/sw`）；`is-dragging` / `is-resizing` 态（K6）。

### T2 — 弹窗全量可拖可缩（7 个 `el-dialog`）

- 7 处全部加 `draggable` prop（Element Plus 原生能力）：
  `CropperUploader.vue`、`MediaPicker.vue`、`ReferenceDetailDialog.vue`、
  `AlbumDetailPage.vue` ×2、`BackupsPage.vue`、`AlbumsPage.vue`。
- 新建 `apps/web/src/lib/float/v-dialog-resize.ts` 指令：为弹窗挂 SE 角 + E 边把手，只调宽度（K2），
  宽度钳制 [360, 视口-32]；7 处全部挂上。
- `theme.css` 追加全局规则：`.el-dialog .el-dialog__body { max-height: 70vh; overflow: auto; }`
  （这是唯一允许动 theme.css 的点，只加不改）。

### T3 — 仪表盘自由画布（`DashboardPage.vue`）

- 移除 `el-row/el-col` 网格，改 `.float-canvas`（`position: relative`；背景加**极淡点阵网格**
  ——用 `--mizuki-border-hairline` 同族色，二次元工作台质感，透明度 ≤ 0.5）。
- 9 张 FloatCard：8 统计卡（id 建议 `stat-status/posts/diary/friends/albums/backups/version/uptime`）
  + 日志卡（`recent-ops`，默认占画布满宽、高约 320）。
- **首次默认布局 = 复刻 U1 现状**：挂载时按画布宽计算 4 列 × 2 行（间距 16）+ 下方满宽日志卡；
  首屏观感与 U1 验收图一致，用户拖动后才写键（K4）。
- 页头加「重置布局」图标按钮：清键 → 回默认布局 → `ElMessage.success('布局已重置')`。
- 持久化键 `mizuki.layout.dashboard.v1`；窄视口降级（K5）。
- 卡片内容（统计值、刷新按钮、日志表）功能与数据绑定**原样保留**，禁动业务逻辑。

### T4 — 编辑器分栏可拉伸（`PostEditPage.vue` + `RichArticleEditPage.vue`）

- 新建 `apps/web/src/lib/float/use-splitter.ts`：竖向分隔条拖动 → 侧栏宽度，钳制 [240, 480]，
  持久化；Pointer Events + ESC 取消（同 K6 手感）；窄视口（<1280px）回退固定 320px（K5）。
- 两编辑器接入：侧栏 `width: 320px` 固定值改为受控宽度；分隔条视觉 = 4px 宽 hover 主色的
  圆角短杠（K7），位于主编辑区与侧栏之间。
- 键名：`mizuki.layout.post-edit.v1` / `mizuki.layout.rich-article-edit.v1`，形状
  `{ version: 1, sidebar: number }`（损坏静默回退 320）。
- 编辑区弹性伸缩行为（100% 视口）保持 U1 验收结论，禁回退。

### T5 — 验证与交付

1. 验收三连：`pnpm build`（含 vue-tsc）exit 0、`pnpm lint` 0/0、`pnpm test` 490/490。
2. 自测清单（全部执行并在报告中逐项回报结果）：
   - 仪表盘：拖动卡片 → `style` 的 left/top 变化；刷新页面 → 位置保持；重置 → 回默认；
     拖到画布边缘外 → 被钳制；缩至最小 → 不小于 260×160；
   - 窄窗口（<1280px）：卡片静态堆叠、无把手、无报错（DevTools console 零红）；
   - 弹窗：7 个逐一打开 → 可拖动、可拉宽、body 超高内滚；
   - 编辑器：两处分隔条可拖、宽度持久化、ESC 回弹；
   - 亮/暗切换 + 换肤四预设：FloatCard / 把手 / 分隔条随主题正确变色（K7 的直接推论）。
3. 交付物：`docs/audits/ui-u2/README.md`（证据表：每项自测一条，写明操作 → 观察到的 DOM
   断言结果；**禁 PNG**）+ `docs/SESSIONS.md` 追加交付报告 + `CHANGELOG.md` 顶部条目。

## 6. 禁止清单（红线）

1. 禁新增任何依赖；禁触碰 `pnpm-lock.yaml`、`apps/web/package.json`、`vite.config.ts`。
2. 禁触碰 `apps/server/**`、`packages/shared/**`、路由表、`MainLayout.vue`、`MenuIcon.vue`。
3. 禁触碰 `custom-theme.ts`、`index.html`；`theme.css` 只允许追加 T2 指定的那一条全局规则。
4. 禁把页面本体 / 列表页 / 编辑器主编辑面改浮动；禁做多窗口并存 / 任务栏（K8）。
5. 禁在 <1280px 留下残影、报错、不可达卡片（K5）。
6. 禁硬编码色值 / 圆角 / 阴影（K7）；禁 `any`、禁残留 `console.log`（lint 0 是硬门槛）。
7. 禁 `git commit` / `git push` / `git stash`——提交由用户在验收后统一处置。
8. 禁伪造留证（U1 空白图事故在案）：证据一律真实 DOM 断言，截图由架构师补拍。
9. 完成即停：不越界做「顺手优化」，未列文件的改动须在报告首节说明缘由。

## 7. 停止条件

- T1~T5 全绿 + 三连通过 + 自测清单全过 → 写交付报告 → **停**，等架构师验收。
- 任一不变量（I1~I6）无法满足 → **停**，报告写明卡点，勿绕行。
- 工作量失控（预计 6~8 文件新增/修改）→ **停**，报告列出已完成面，勿硬撑。

—— 架构师签发，2026-10-17
