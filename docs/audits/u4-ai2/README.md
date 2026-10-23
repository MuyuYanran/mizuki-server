# U4-AI2 交付报告（AI 接入第二期 · 前端）

> [批次] U4-AI2 —— 全局右侧聊天栏 + AI 服务设置页 + 5 动作 + 上下文注册 + 三键插入
> [指令包] `docs/prompts-ui/U4-AI2-web-chat-drawer.md`
> [前置] U4-AI1（`8bbbd3f`）
> [报告性质] **架构师自查自验**。原计划派子代理执行，但**两个执行方连续异常中断**（U4-AI1 收尾前死亡、U4-AI2 因 DSH 崩溃在写出任何文件前消失）。判定：改造防线是把成果落盘并提交，而不是继续等待某个代理不中断 ⇒ 本包由架构师亲自实现 + 亲自浏览器手验。

---

## 1. 结论

**通过。** 12 个文件（8 新增 / 4 修改）交付；`pnpm build`（含 `vue-tsc --noEmit`）exit 0、`pnpm lint` 0:0、后端全量 **648 通过 / 4 跳过（73 文件）**。浏览器手验 12 步走完 **10 步**，余 2 步受「真 key 已失效」与「bsk 截图权限故障」限制（见 §5）。

---

## 2. 交付物

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/shared/src/ai.ts` | 改（**只增不改**） | `AI_ACTION_LABELS` / `AI_CONTEXT_KINDS` / `truncateForContext` / `parseSseChunk`（纯函数） |
| `apps/server/test/shared/ai-web.spec.ts` | 新增 | **17 用例**覆盖上面两个纯函数 + 动作标签一致性 |
| `apps/web/src/api/ai.ts` | 新增 | `getConfig` / `putConfig` / `ping` / `streamChat`（SSE 消费）+ `AI_FAILURE_TEXT` 分类文案 |
| `apps/web/src/stores/ai.ts` | 新增 | 模块级 `ref`（本仓无 Pinia）：配置缓存 / 抽屉开合 / 会话 / 流式态 |
| `apps/web/src/lib/ai/context.ts` | 新增 | 上下文注册 + `registerEditorContext` 一行式接线 |
| `apps/web/src/lib/ai/actions.ts` | 新增 | 5 个动作的**短指令**（长提示词在服务端） |
| `apps/web/src/components/AiChatDrawer.vue` | 新增 | 聊天栏本体（宽窄两态 + 拖宽 + 流式 + 三键） |
| `apps/web/src/views/settings/AiSettingsPage.vue` | 新增 | 六个区块的设置页 |
| `apps/web/src/layouts/MainLayout.vue` | 改 | 顶栏 AI 按钮 + 抽屉挂载 + 菜单「配置 → AI 服务」 |
| `apps/web/src/router/index.ts` | 改 | `/settings/ai` |
| `apps/web/src/lib/editors/{TipTap,CodeMirror,Vditor}Editor.vue` | 改 | 各加**只增不改**的 `defineExpose`（详见 §3.2） |
| `apps/web/src/views/{posts/PostEditPage,posts/AboutEditPage,articles/RichArticleEditPage}.vue` | 改 | 注册上下文（各 2 处接线） |

---

## 3. 关键设计与实测结论

### 3.1 三编辑器插入接口（指令包要求"以实测为准"）

| 编辑器 | 取文本 | 取选区 | 插入 | 替换选区 |
|---|---|---|---|---|
| **TipTap** | `getText()`（新增 `getPlainText`） | `state.selection` 新增 `getSelectedText` | 新增 `insertPlainText`（按 `\n\n` 切段落建 paragraph，不解析 Markdown） | 新增 `replaceSelection`（`deleteSelection` + 插入） |
| **CodeMirror** | 既有 `getValue` | 新增 `getSelectedText`（`sliceString`） | 既有 `insertAtCursor` | 新增 `replaceSelection`（**单次 dispatch**：分两次会让 `updateListener` 发出半成品） |
| **Vditor** | 既有 `getValue`（含 `srcReverse` 反向还原） | 新增 `getSelectedText`（DOM selection + **限定在容器内**，避免把页面别处选区当正文） | 既有 `insertAtCursor`（`insertValue`） | 新增 `replaceSelection`：`deleteValue()` → `insertValue()`；**无 `deleteValue` 时退化为插入 + `console.warn` 留痕** |

> **Vditor 的诚实边界**：它的 IR/WYSIWYG 模式没有公开的"替换选区"API。选择「删不掉就先插入并留痕」而不是静默失败——**丢用户原文比多一段内容严重得多**。这条写进代码注释，未掩盖。

### 3.2 不改既有行为的实证

三编辑器只加 `defineExpose`，不碰：Vditor 的 `srcReverse` 图片改写（B3.6 红线）、TipTap 的自定义 NodeView / `imageSrc`、CodeMirror 的 `applyingExternal` 守卫。类型上把 `AiEditorHandle.getValue` 声明为**必需**（否则两处既有 `editorRef.value.getValue()` 调用会编译失败——这是 `vue-tsc` 实际报错逼出来的修正）。

### 3.3 SSE 消费

照 `api/process.ts` 的既有形态（`fetch` + `getReader` + `AbortController`），但**解帧交给 shared 的 `parseSseChunk`**（纯函数、17 用例覆盖）。覆盖的真实现象：跨块半帧、`\r\n`、多 `data:` 行、空 `data`、无 `event`、一次多帧、注释行/`id:`/`retry:` 忽略、冒号后空格规则。

四态收尾：`done` 帧 → 成功；`error` 帧 → 分类文案；EOF 未见 `done` → 明确报「连接提前结束」（**不谎报成功**）；用户 `abort` → 不弹红条、保留已有文本。

### 3.4 上下文注册（本包的关键接线）

`activeAiContext` 是模块级 `ref`；注销时**只有自己仍是当前**才清空（防快速切页时旧页 unmount 抹掉新页的注册）。文本**惰性**获取（点动作/发送时才 `getText()`），不在打字路径上同步全文。

---

## 4. K 条款对照

| # | 项 | 证据 | 结论 |
|---|---|---|---|
| K1 | 抽屉可开合；切页不丢会话；刷新清空 | 手验 §5-1/§5-11/§5-12（手验 11/12 以代码路径确认：`aiMessages` 无任何 localStorage 写入，仅 `mizuki.ui.aiDrawer.open` 持久化） | ✅ |
| K2 | 未配置 → 发送禁用 + 引导 | 抽屉 `blockedReason` 三态；手验中 `未挂载上下文`/动作禁用已见 | ✅ |
| K3 | 流式可中止；中止后按钮复位、文本保留、无残留 | `stop()` + `onError(aborted=true)` 分支；`aiStreaming` 双复位 | ✅（代码路径 + 手验 §5-8 见错误气泡与按钮复位） |
| K4 | 有选区「替换」可用、无选区置灰；三键都能落地 | 手验 §5-7 实测「无选区（替换不可用）」+ `替换选区 [disabled]`；有输出后 `插入到光标`/`复制` 变可用 | ✅ |
| K5 | 富文本插入 JSON 合法 | 仅按 paragraph 节点插入（不新建节点类型）；`vue-tsc` 通过 | ✅（**未做浏览器内富文本插入实测**，见 §5-2） |
| K6 | Markdown 插入走编辑器 API、无 DOM 文本改写 | TipTap 用 `chain().insertContent`、CM 用 `dispatch`、Vditor 用 `insertValue`；零 DOM 文本赋值 | ✅ |
| K7 | 保存后不重启即用新值 | 设置页保存后**自动重测一次**并回读配置 | ✅ |
| K8 | key 留空=保留；填值=覆盖（提前 confirm） | `confirmKeyOverwrite()` + 空串不构造 `apiKey` 字段 | ✅ |
| K9 | 代理文案含「不读取 Windows 系统代理」 | 设置页 `ai-desc-warn` 逐字包含该句 + `strong` 强调 | ✅（手验可见） |
| K10 | `allowPrivateNetwork` 二次确认 + 显著提示 | `toggleAllowPrivateNetwork` 用 `ElMessageBox.confirm`；取消即回落 false | ✅ |
| K11 | shared 纯函数有单测且绿 | `test/shared/ai-web.spec.ts` **17 用例全绿** | ✅ |
| K12 | build / lint / 全量测试绿 | `pnpm build` 0、`pnpm lint` 0:0、后端 **648 通过 + 4 跳过 / 73 文件** | ✅ |

---

## 5. 浏览器手验记录（架构师本人，2026-10-23 13:13–13:17）

环境：隔离实例（独立 `config.json`/DB/侧车，`MIZUKI_AI_API_KEY` 走环境变量，不碰真实库）+ 已构建的 `apps/web/dist` + Chrome（bsk）。

| # | 步骤 | 结果 |
|---|---|---|
| 1 | 登录 → 顶栏出现「AI」按钮 → 点击 | ✅ 抽屉展开，标题 `AI 助手 / DeepSeek · deepseek-flash` |
| 2 | 未挂载上下文态 | ✅ 显示「未挂载上下文（纯对话模式）」，5 动作全 `disabled`，三键全 `disabled` |
| 3 | 菜单「配置」组 | ✅ 出现「AI 服务」项（`menuitem "AI 服务"`） |
| 4 | 进 Markdown 编辑页 | ✅ 上下文条变「当前文档 / 3875 字 / 无选区（替换不可用）」，**5 个动作全部转为可用** |
| 5 | 列表页/仪表盘 | ✅ 上下文条回「未挂载上下文」（注册已随 unmount 注销） |
| 6 | 点「摘要」动作（真实请求） | ✅ 消息区出现 `摘要` + 气泡「上游认证失败」，**说明 fetch → 服务端 → 上游的整条链路通** |
| 7 | 三键状态随输出变化 | ✅ 「插入到光标」「复制」转可用；「替换选区」仍禁用（无选区）——**与 K4 的语义完全一致** |
| 8 | Ctrl+A 选 Vditor 源码块 | ✅ 上下文条仍显示「无选区」（DOM 选区限定在正文容器内，未误判） |
| 9 | 未就绪/错误分类文案 | ✅ 显示「上游认证失败」而非上游原文（`AI_FAILURE_TEXT` 生效，**无 key/URL 泄漏**） |
| 10 | 抽屉开关状态持久化 | ✅ `localStorage['mizuki.ui.aiDrawer.open']`（代码路径确认） |
| 11 | 刷新后会话清空 | ⚠️ **未实测**（`aiMessages` 为内存 ref，无持久化写入；代码路径确定，但未走一遍刷新） |
| 12 | 富文本页插入 K5 | ⚠️ **未实测**（需真 key 产出内容后才能点「插入到光标」；本轮 key 已失效） |

**截图证据缺失说明**：`bsk` 截图写入路径被拼成 `D:_pathsTempsBskTempFiles\…`（`os error 5`），属既有 bsk 环境故障（宿主 TEMP 无 Low 完整性标签），**与本批代码无关**；本次以可访问性树（`@vom` 快照）作为文本证据。

---

## 6. 偏离与取舍（据实）

1. **执行方式偏离**：原定子代理执行 → 改为架构师亲自实现（原因见报告头）。**这不是流程提速，是止损**：两次执行方异常中断后，继续派第三方只会重复同样的失败模式。
2. **`viaProxy` 展示**：按 AI1 实现（布尔配置意图）展示「配置意图：走代理/直连」，**不宣称"已走代理"**。
3. **`upstream_4xx` 已入文案表**，并对未知码回显码本身（便于排障）。
4. **Vditor `replaceSelection` 依赖 `deleteValue`**，不可用时退化并 `console.warn`（见 §3.1）。
5. **`el-aside` 与 `el-main` 并存**：抽屉放在 `el-main` 之后、同一 `el-container` 内；窄屏改覆盖式浮层 + 遮罩（不挤压正文）。
6. **不做**：Markdown 语法解析、自动回填表单（标题/描述/标签的落表属 U4-AI3）、工具调用、会话持久化。

---

## 7. 已知缺口（登记，不追补）

1. **K5 富文本插入未实测**：需真 key 产出内容后点「插入到光标」再保存、看 `html_cache`。代码按 paragraph 节点插入，`vue-tsc` 通过，但**未经浏览器验证不算已验**。
2. **刷新清空会话未实测**（代码路径确定）。
3. **Vditor 无选区替换真 API**：`deleteValue` 存在性依赖版本；退化路径已留痕。
4. **抽屉窄屏浮层的 z-index 与 Element 弹层可能重叠**（未实测，`2000/1999` 取值参考既有面板页）。
5. **无「停止正在进行的请求」的服务端兜底**：前端 abort 会让服务端 `res.on('close')` 触发上游 abort（AI1 的 K6 已证），但**网络闪断**时上游可能仍跑完——已登记的既定边界。
6. **bsk 截图故障**：`D:_pathsTempsBskTempFiles` 路径拼接错误 + 宿主 TEMP 无 Low 标签，非本批引入。

---

## 8. 与后续批次的关系

- **U4-AI3（未立项）**：`meta` 动作产出回填表单（title/summary/tags）、发布助手、导入质检、`ai_usage` 用量表。
- **U4-AI4（未立项）**：受控工具调用（查/建/改文章），逐次 confirm + `operation_log`。
- 本批已把"写回面"收敛为 `registerEditorContext` 一个接缝：将来加块级 AI（选中表格/图片改写）只需扩该接口，不动聊天栏。
