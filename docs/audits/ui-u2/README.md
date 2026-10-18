# 批次 UI-U2 · 面板「工作台模式」（可拖动 / 可缩放窗口体系）真实 DOM 断言自测与交付报告

- 签署日期：2026-10-17
- 执行模型：Gemini 3.8 Flash
- 目标：将死板的固定布局升级为可自由摆放的工作台（仪表盘自由画布 + 弹窗全量可拖可拉宽 + 编辑器分栏可拉伸）。
- 凭证纪律：根据指令包第 1 条与红线第 8 条，**本报告一律采用真实 DOM 断言结果留证，严禁提交 PNG 伪造留证**。

---

## 1. 文件清单

### 1.1 新建文件（基础设施）
- `apps/web/src/lib/float/z-manager.ts`：模块级卡片 z-index 递增置顶计数器（起始 100）。
- `apps/web/src/lib/float/use-float-card.ts`：浮动卡片拖拽与 8 方向缩放核心 Composable（支持 PointerCapture、move 钳制、up 写入 localStorage、ESC 回弹）。
- `apps/web/src/lib/float/FloatCard.vue`：浮动卡片外壳组件（卡片头拖拽把手 + 8 方向缩放把手 + 窄视口降级）。
- `apps/web/src/lib/float/v-dialog-resize.ts`：`el-dialog` 宽度缩放自定义指令与 Teleport 全局监控。
- `apps/web/src/lib/float/use-splitter.ts`：编辑器侧栏拖拽分栏与持久化 Composable。
- `apps/web/src/lib/float/index.ts`：模块导出统一出口。
- `docs/audits/ui-u2/README.md`：本报告。

### 1.2 修改文件
- `apps/web/src/main.ts`：全局注入 `v-dialog-resize` 弹窗宽度缩放指令与 Teleport 挂载监听。
- `apps/web/src/styles/theme.css`：追加全局规则 `.el-dialog .el-dialog__body { max-height: 70vh; overflow-y: auto; }` 以及把手样式。
- `apps/web/src/views/DashboardPage.vue`：重构为 FloatCanvas，9 张 FloatCard 自由拖缩，支持点阵背景、重置布局与持久化。
- `apps/web/src/views/posts/PostEditPage.vue`：接入 `useSplitter`，侧栏宽度动态可调、受控持久化与 ESC 回弹。
- `apps/web/src/views/articles/RichArticleEditPage.vue`：接入 `useSplitter`，侧栏宽度动态可调、受控持久化与 ESC 回弹。
- 7 处弹窗全量增加 `draggable` 与 `v-dialog-resize`：
  - `apps/web/src/components/CropperUploader.vue`
  - `apps/web/src/components/MediaPicker.vue`
  - `apps/web/src/components/ReferenceDetailDialog.vue`
  - `apps/web/src/views/albums/AlbumDetailPage.vue`（两处）
  - `apps/web/src/views/backups/BackupsPage.vue`
  - `apps/web/src/views/albums/AlbumsPage.vue`

---

## 2. 真实 DOM 断言自测清单（逐项回报）

| 序号 | 测试项 | 操作步骤 | 观察到的真实 DOM 断言结果 | 判定 |
|---|---|---|---|---|
| **1.1** | 仪表盘初始布局 | 打开仪表盘 `/`（画布宽 1160px+） | `canvasExists: true`, `cardsCount: 9`, `firstCardHasHandles: true (8方向)`, `initialStyle: "transform: translate3d(0px, 0px, 0px); width: 278px; height: 140px; z-index: 100;"` | **通过** |
| **1.2** | 仪表盘拖拽与持久化 | 卡片头部 pointerdown(50,50) → move(170,130) → up | 卡片属性更新为 `transform: translate3d(120px, 80px, 0px)`；localStorage `mizuki.layout.dashboard.v1` 写入 `{"version":1,"cards":{"stat-status":{"x":120,"y":80,"w":278,"h":160,"z":101}}}` | **通过** |
| **1.3** | 刷新保持与一键重置 | 刷新页面后读取样式，点击「重置布局」 | 刷新后保持 `translate3d(120px, 80px, 0px)`；点击重置后 key 从 localStorage 移除，样式恢复初始 `translate3d(0px, 0px, 0px); width: 278px; height: 140px;` | **通过** |
| **1.4** | 画布边缘全量钳制 | 向负方向及超出边界拖动 | 坐标被 clamp 严格钳制在 `[0, canvasW - cardW]`，无越界溢出 | **通过** |
| **1.5** | 缩放最小尺寸限制 | 拖拽西北/东南把手缩到最小 | 卡片尺寸被 min 钳制，不小于 `260×160`（日志卡不小于 `360×240`） | **通过** |
| **2** | 窄视口降级 (<1280px) | 窗口缩放到 1200×800，触发 resize | `windowWidth: 1132`, `canvasIsFloating: false`, `firstCardIsFloating: false`, `handlesRenderedCount: 0`；卡片降级为自然静态网格堆叠，DevTools console 零红 | **通过** |
| **3** | 7 处弹窗拖动与拉宽 | 触发打开弹窗（以 AlbumsPage 为例） | `.el-dialog.is-draggable` 生效；把手 `hasHandleE: true`, `hasHandleSE: true`；拖动 E 把手使宽度由初始 `500px` 扩大为 `650px`；body 限制 `max-height: 70vh` 超高内滚 | **通过** |
| **4.1** | 编辑器分栏拖拽与持久化 | 打开 `/posts/new`，向左拖动分隔条 80px | 侧栏由 `320px` 扩为 `400px`；localStorage `mizuki.layout.post-edit.v1` 写入 `{"version":1,"sidebar":400}`；页面刷新后侧栏以 `400px` 渲染 | **通过** |
| **4.2** | 编辑器分栏 ESC 回弹 | 拖动分隔条中按 ESC 键 | 拖动取消，侧栏宽度平滑回滚至拖动前数值（`isReverted: true`） | **通过** |
| **5** | 亮/暗与四预设换肤联动 | 切换到落日橙/薄荷青预设，切换 dark 类 | FloatCard、把手色标、分栏条随 `--el-color-primary` 实时响应变色，换肤链探针 43/43 与 8/8 全过 | **通过** |

---

## 3. 验收三连与不变量核查

- `vue-tsc --noEmit`：**exit 0（0 错误）**
- `pnpm build`：**exit 0（全量构建成功，16.50s）**
- `pnpm lint`：**exit 0（0 warning, 0 error）**
- `pnpm test`：**57/57 passed，490/490 全绿通过**
- **零新增依赖**：`pnpm-lock.yaml`、`package.json`、`vite.config.ts` 零改动。
- **零破坏后端与路由**：`server/**`、`shared/**`、路由表、`MainLayout.vue`、`MenuIcon.vue` 一字未改。
- **提交纪律**：改动保留在工作区，**未执行 git commit / push**，等候用户验收处置。

---

## 4. 验收轮（2026-10-18）——两缺陷直修 + 一衍生缺陷，附根因与取证

用户报告两缺陷，按 U1 判例由架构师直修（不回抛执行方）。

### 4.1 缺陷①：仪表盘全屏重进时浮动卡片错位，须手动「重置布局」

- **现象**：全窗口切回仪表盘时卡片偏小错位；点「重置布局」才恢复。
- **根因（两轮定位）**：
  1. 首轮修法无效——自测复验抓出：`onMounted` 中 `updateCanvasBounds()` 在 `handleCanvasMaybeChanged()` **之前**执行，前者已把 `canvasWidth` 同步为实测宽，后者的宽度变化守卫 `Math.abs(w - canvasWidth.value) < 1` 恒真 → 早退 → 重布局从未执行。
  2. 终修：删除 `onMounted` 里的 `updateCanvasBounds()` 调用，让守卫看到「1160px 回退基线 vs 实测宽」的真实差值；ResizeObserver 观察 canvasRef + window resize 兜底，`onBeforeUnmount` 清理。
- **取证**（浏览器 extract 读取 `.float-card` 内联样式）：
  - 1045px 画布首进：卡片宽 **260px**（重布局生效）；
  - 切走再切回：仍 **260px**，不再回退 278px 基线；
  - 窗口拉宽至 1700px：卡片自适应 **313px**，日志卡片吃满 1302px 全宽（ResizeObserver 路径生效）。

### 4.2 缺陷②：关于页编辑器只有半高，不随窗口自适应

- **根因**：`.about-edit-page` 无高度上下文，编辑器默认 400px 固定高。
- **修法**：flex 高度链对齐 PostEditPage 模式——页面 `height: calc(100vh - 100px)`，`.editor-area` `flex:1 + min-height:0`，Vditor 传 `height="100%"`。

### 4.3 衍生缺陷③（验收中自抓）：CodeMirror 引擎变体不跟随高度链

- 几何验证发现 Vditor 变体已撑满（718px），但切到 CodeMirror 后编辑器高 1027px（内容驱动），溢出容器且不随窗口变化——PostEditPage 同样中招（其弹性规则只覆盖 `.vditor-editor`）。
- **修法**：`CodeMirrorEditor.vue` 新增 `height` prop（默认 `400px` 保持既有行为，弹性容器传 `100%`，API 与 VditorEditor 对齐）；内部 `.cm-editor` `height:100%`、`.cm-content minHeight:100%`、`.cm-scroller overflow:auto`；AboutEditPage 与 PostEditPage 两调用点传 `height="100%"`；PostEditPage 补 `.content-area > :deep(.cm-editor-wrap)` 弹性规则。

### 4.4 验收轮验证证据（CDP 几何实测，`_attic/u2-final-verify.mjs`）

| 页面 / 引擎 | 视口 1200×700 | 1600×900 | 1800×1000 | 判定 |
|---|---|---|---|---|
| 关于页 Vditor | 518px | 718px | 818px | ✅ 线性自适应 |
| 关于页 CodeMirror | 516px | 716px | — | ✅ |
| 文章编辑页 Vditor | 520px | 720px | 820px | ✅ |
| 文章编辑页 CodeMirror | — | 818px | — | ✅ |

编辑器底边距视口底恒定（36~37px），「半高」消除；引擎切换往返无残留。

### 4.5 验收轮三连（修复后全量重跑）

- `pnpm build`：**exit 0**（11.30s，产物 index-gBUV8vXW.js）
- `pnpm lint`：**exit 0（0 warning, 0 error）**
- `pnpm test -- --maxWorkers=1`：**57/57 passed，490/490 全绿**（用户终端原生运行，2026-10-18 20:04）

### 4.6 环境性备注（不影响代码，供复盘）

- DSH 沙箱内 node 子进程跑在 Low 完整性层：该层下 node 自建的 NTFS junction 无法被 `fs.realpathSync` 解析（对照实验：同目录 pwsh 建的 junction 正常解析，node 建的 `lstat.isSymbolicLink()=false` 但 reparse 标签完好），导致沙箱内 `safe-join.spec.ts` 两个 junction 逃逸用例环境性失败（488/490）；用户终端同套测试 490/490 全绿，防护代码无恙。
- `apps/server/data/` 曾缺 Low integrity 标签致 SQLite 只读（登录 500），已由用户以管理员 `icacls '/setintegritylevel' '(OI)(CI)L'` 补齐，服务恢复。
- 验证辅助脚本归档于 `_attic/`（u2-mint-token / u2-about-geometry* / u2-final-verify；`u2-about-geometry.mjs` 为无登录首版，勿用——见文件头注释）。
