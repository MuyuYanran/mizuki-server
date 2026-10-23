# U4-AI2 指令包 —— AI 接入第二期（前端：全局聊天栏 + 设置页 + 动作与插入）

> [前置] **U4-AI1 已交付**（提交 `8bbbd3f`；端点 `GET|PUT /admin/ai/config`、`POST /admin/ai/ping`、`POST /admin/ai/chat`(SSE)、`shared/ai.ts` 契约、`modules/ai/prompts.ts` 服务端提示词）。基线 **631 用例通过 + 4 跳过 / 73 文件**。
> [定位] 本包**只做前端**（`apps/web`）+ 一处 shared 纯函数下沉；**不改 AI1 的任何契约**（要改就停下报告，别自己改）。
> [PM 裁定 2026-10-22] 面板形态 = **整体窗口右侧聊天栏**；设置入口 = **菜单里的独立页**。
> [已知边界] `apps/web` 无测试运行器 ⇒ 纯逻辑下沉 `packages/shared` 由 server 的 vitest 覆盖，交互部分只能手验（§7 给了 12 步）。
>
> **开工前必读：AI1 落地后的三处事实（以代码为准，别按旧描述写）**
> 1. **`ping` 的 `viaProxy` 是布尔**（= 配置意图 `mode !== 'none'`），不是枚举 `'none'|'system'|'custom'`。
>    设置页要**同时**显示配置里的 `proxy.mode` 与 ping 回的布尔意图；文案**不得**宣称「已走代理」
>    （`system` 模式下 `NO_PROXY` 命中会直连，服务端无从感知）。
> 2. **失败分类除 §3.4 列的之外还有 `upstream_4xx`**（上游 400/404/429；例如模型名不存在）。
>    完整集合：`upstream_timeout` / `upstream_401` / `upstream_4xx` / `upstream_5xx` / `network` / `blocked_url` / `no_profile`。
> 3. **动作提示词与上下文注入在服务端**（`apps/server/src/modules/ai/prompts.ts`）：服务端会把 `context.text`
>    包进 `<document kind="…">` 并在最前加 system。⇒ **前端绝不要自己拼 `<document>` 或任何提示词模板**，
>    只发 `action` + `context {kind,text}` + 短指令 `messages`。

---

## 1. 目标

```
1) 任何页面右侧都能拉开 AI 聊天栏，退出/切换页面不丢当前会话（刷新即清，不落盘）；
2) 编辑页把「当前文章 / 当前选区」注册给聊天栏，动作按钮据此工作；
3) 五个动作（润色 / 续写 / 摘要 / 标题·描述·标签 / 翻译）流式出结果；
4) 结果只能由人点「替换选区 / 插入到光标 / 复制」进编辑器，**永不自动写入**；
5) 「配置 → AI 服务」页管理 provider 档案、代理三态、生成参数、连通性测试；
6) 未配置时聊天栏给出引导而不是报错。
```

## 2. 文件清单

| 文件 | 动作 | 备注 |
|---|---|---|
| `packages/shared/src/ai.ts` | 改 | **只增不改**：`truncateForContext()`、`parseSseChunk()`、`AI_ACTION_LABELS`（纯函数，可被 server 侧单测覆盖） |
| `packages/shared/src/index.ts` | （若已 `export *`）不动 | 确认导出 |
| `apps/web/src/api/ai.ts` | 新建 | `getConfig` / `putConfig` / `ping` / `streamChat`（SSE 消费，照抄 `api/process.ts:168-210` 形态） |
| `apps/web/src/stores/ai.ts` | 新建 | 模块级 `ref` 风格（照 `stores/system.ts`，本仓无 Pinia）：配置缓存、抽屉开合、会话消息、流式态 |
| `apps/web/src/lib/ai/actions.ts` | 新建 | 五动作的**前端短指令**（真正的风格提示词在服务端，见 §4.3） |
| `apps/web/src/lib/ai/context.ts` | 新建 | `registerAiContext()` / `getActiveAiContext()` |
| `apps/web/src/components/AiChatDrawer.vue` | 新建 | 聊天栏本体 |
| `apps/web/src/views/settings/AiSettingsPage.vue` | 新建 | 设置页 |
| `apps/web/src/layouts/MainLayout.vue` | 改 | 顶栏「AI」开关按钮 + 右侧抽屉挂载 + 菜单新增 `{ path:'/settings/ai', title:'AI 服务', group:'配置' }` |
| `apps/web/src/router/index.ts` | 改 | 注册 `/settings/ai` |
| `apps/web/src/lib/editors/TipTapEditor.vue` | 改 | 仅加 `defineExpose({ insertPlainText, replaceSelection, getSelectedText, getPlainText })`，**行为零变化** |
| `apps/web/src/views/posts/PostEditPage.vue` | 改 | 注册上下文（Vditor / CodeMirror 双模式） |
| `apps/web/src/views/posts/AboutEditPage.vue` | 改 | 同上 |
| `apps/web/src/views/articles/RichArticleEditPage.vue` | 改 | 注册上下文（TipTap） |
| `apps/server/test/shared/ai-web.spec.ts` | 新建 | 覆盖 `truncateForContext` / `parseSseChunk`（**共享包由 server 的 vitest 覆盖，这是本仓既有做法**：`test/shared/events.spec.ts`） |

## 3. 交互规格（逐条实现）

### 3.1 抽屉

- 位置：`MainLayout` 的 `el-container.layout-body` 内、`el-main` **之后**，用 `<el-aside>` 呈现；拖宽复用 `useSplitter({ storageKey:'mizuki.layout.ai-drawer.v1', defaultWidth:380, min:320, max:640 })`。
- 窄屏：视口 `< 1280px` 时改为**覆盖式浮层**（不挤压正文），点击遮罩关闭。
- 开合状态：`localStorage['mizuki.ui.aiDrawer.open'] = '1'|'0'`；顶栏按钮切换（放在主题切换按钮左侧，用现有 `el-button` 风格 + 文本「AI」）。
- 结构自上而下：标题行（「AI 助手」+ 当前档案名 + 清空对话 + 关闭）→ **上下文条**（`未挂载上下文` / `选区 123 字` / `文章 4567 字（已截断至 40000）`）→ 动作按钮行 → 消息列表 → 输入区。
- 输入区：多行；`Enter` 发送、`Shift+Enter` 换行；流式期间发送键变「中止」（`AbortController.abort()`）。
- 流式渲染：增量文本用**文本插值**逐段追加；末尾显示闪烁光标块。**禁 `v-html`**（AI 输出是不可信文本，红线）。
- 空态：未配置 → 显示「尚未配置 AI 服务」+ 「去配置」按钮（`router.push('/settings/ai')`），发送区禁用。

### 3.2 上下文条（本包的关键接线）

- 编辑页 `onMounted` 调 `registerAiContext({...})`，`onBeforeUnmount` 调返回的注销函数。
- 聊天栏订阅该注册：无注册 → 上下文条显示「未挂载上下文」，动作按钮**全部禁用**（自由对话仍可用）。
- 上下文文本获取是**惰性**的（点动作/发送时才 `getText()`），避免每次按键都同步全文。
- 截断：`truncateForContext(text, AI_LIMITS.maxContextChars)`（shared，返回 `{text, truncated, chars}`），UI 必须显示「已截断」。

### 3.3 三个插入键（顺序与可用性）

| 按钮 | 有选区 | 无选区 |
|---|---|---|
| **替换选区** | 可用 → `replaceText(输出)` | 置灰（tooltip：先选中要替换的文字） |
| **插入到光标** | 可用 → `insertText(输出)` | 可用 |
| **复制** | 恒可用（`navigator.clipboard.writeText`，失败 toast） |

插入实现：

- **TipTap（富文本）**：`insertPlainText` 按 `\n\n` 切段，逐段 `insertContent({ type:'paragraph', content:[{type:'text', text: seg}] })`；`replaceSelection` 用 `chain().focus().deleteSelection().insertContent(...)`。**不解析 Markdown**（纯文本插入，与 AI1 的 §5 一致）。
- **Vditor（Markdown IR）**：`insertText` → `vditor.insertValue(text)`；`replaceText` → `vditor.deleteValue()` 后 `insertValue`（若 API 不满足，先用 `getSelection()` 取选区文本自行替换；**具体 API 以实测为准，写进交付报告**）。
- **CodeMirror（源码）**：`view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })`。
- 三个编辑器都**禁止**直接改 DOM 文本（会破坏 Vditor 反向序列化 / CodeMirror 状态）。

### 3.4 设置页 `/settings/ai`

六个区块，自上而下：

1. **总开关**（`enabled`）+ 一句说明「关闭后聊天栏仍可见但不可发送」。
2. **provider 档案**：表格（名称 / baseUrl / model / key 掩码 / 当前 / 操作）；「新增档案」打开表单（名称、baseUrl、model、apiKey）；「设为当前」写 `activeProfileId`。
   - **key 输入框留空 = 保留**（PUT 不带 `apiKey`）；填了值 = 覆盖，提交前 `ElMessageBox.confirm` 提示「将覆盖已保存的 key」。
   - `keySource === 'env'` 时：key 列显示「来自环境变量 `MIZUKI_AI_API_KEY`」，key 输入框禁用并提示「环境变量优先，面板改动不生效」。
3. **代理**：三态 radio（`none` 直连 / `system` 系统环境变量 / `custom` 指定地址）。
   - `system` 文案必须写全：**「读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量；不读取 Windows「设置 → 代理」里的系统代理」**（PM 已接受该边界）。
   - `custom` 时显示 URL 输入框，placeholder `http://127.0.0.1:7897`。
4. **生成参数**：`maxOutputTokens`（1–8192）、`temperature`（0–2，step 0.1）、`timeoutMs`（1000–120000）。
5. **高级**：`allowPrivateNetwork` 开关 —— 打开必须 `ElMessageBox.confirm`，提示「允许服务端访问内网/回环地址。仅在你确知风险时开启（例如连本地 Ollama）」。
6. **连通性测试**：「测试连接」按钮 → `POST /admin/ai/ping` → 成功显示 `✓ 连接成功 · 模型 deepseek-chat · 延迟 812ms · 经由 系统代理`；失败显示分类码（`upstream_timeout` / `upstream_401` / `network` / `blocked_url` / `no_profile`）并给一句人话解释。**失败文案不得出现上游 URL 或响应体**（服务端已不透传，前端别再自行拼）。

保存行为：整页一个「保存」按钮（不做逐项自动保存）；保存成功 toast「已保存，立即生效」；**保存后若用户已点过测试连接，自动重测一次**（验证活取）。

## 4. 契约与状态形状（不得自创）

### 4.1 `stores/ai.ts`

```ts
export const aiConfig = ref<AiConfigView | null>(null);      // GET /admin/ai/config 的结果
export const aiDrawerOpen = ref<boolean>(readStoredOpen());  // localStorage
export const aiMessages = ref<AiMessage[]>([]);              // 仅内存，刷新即清
export const aiStreaming = ref<boolean>(false);
export interface AiMessage { id: string; role: 'user'|'assistant'; content: string; action?: AiAction; error?: string }
```

会话**不写 localStorage**（内容含文章正文）；只持久化抽屉开合与宽度。

### 4.2 `lib/ai/context.ts`

```ts
export interface AiContextRegistration {
  kind: 'article' | 'markdown' | 'selection';
  getText(): string;                    // 惰性
  hasSelection(): boolean;
  insertText(text: string): void;
  replaceText(text: string): void;
}
export function registerAiContext(reg: AiContextRegistration): () => void;
export function getActiveAiContext(): AiContextRegistration | null;
```

### 4.3 动作请求形状（与 AI1 契约**零冲突**，别改端点）

AI1 的 `messages` 最少 1 条，所以动作请求这样发：

```ts
// 动作（不带用户自由输入）
{ action: 'polish', messages: [{ role: 'user', content: ACTION_HINTS.polish }], context: { kind, text } }
// 自由对话（无动作）
{ messages: [...历史...], context: { kind, text } }
```

- `ACTION_HINTS` 是**短指令**（一行中文，如「请润色下面这段文字」），真正的风格/格式约束在**服务端**（AI1 §6 的 action 系统提示）。
- 前端**不得**把长 prompt 模板写进浏览器：换风格要改服务端一处，不是在两处漂移。

### 4.4 SSE 消费

`api/ai.ts` 的 `streamChat(body, {onDelta,onUsage,onDone,onError})`：照抄 `api/process.ts:168-210`（`fetch` + `getReader` + `TextDecoder` + `\n\n` 切帧 + `AbortController`）。**不复用** http.ts 的自动 refresh（流式语义不同，P9 先例），401 时提示重新登录。

帧解析的纯函数放 shared：`parseSseChunk(buffer)` → `{ frames: {event:string, data:string}[], rest: string }`，由 `test/shared/ai-web.spec.ts` 覆盖（含跨块半帧、`\r\n`、空 `data`、多帧同块）。

## 5. K 条款（验收）

| # | 验收项 |
|---|---|
| K1 | 抽屉在任何页面可开合；路由切换不丢会话；刷新后会话为空（不落盘） |
| K2 | 未配置（`enabled=false` 或无档案）→ 发送禁用 + 引导按钮跳到 `/settings/ai` |
| K3 | 流式期间可中止；中止后按钮复位、已收到的文本保留、无残留半帧、无未捕获异常 |
| K4 | 有选区时「替换选区」可用、无选区时置灰；三键都能落地到编辑器 |
| K5 | 富文本插入后 `getJSON()` 结构合法（`doc>paragraph[]>text`），保存后后端能生成 `html_cache` |
| K6 | Markdown 插入走 Vditor/CodeMirror 各自 API，**无直接 DOM 文本改写**；保存后 `.md` 内容与编辑器所见一致 |
| K7 | 设置页保存后（不重启、不刷新）点「测试连接」用新值（验证存活取） |
| K8 | key 输入留空提交 → 服务端 key 未变（回读掩码一致）；填值提交 → 覆盖（提前 confirm） |
| K9 | 代理三态文案含「不读取 Windows 系统代理」这句 |
| K10 | `allowPrivateNetwork` 打开必须二次确认，且页面上有显著风险提示 |
| K11 | `truncateForContext` / `parseSseChunk` 有单测且绿（`apps/server/test/shared/ai-web.spec.ts`） |
| K12 | `pnpm build`（含 `vue-tsc --noEmit`）exit 0；`pnpm lint` 0:0；`pnpm test` 全量单批全绿（用例数 = AI1 后的基线 + K11 新增） |

## 6. 禁区

- ❌ 不改 AI1 的端点、schema、SSE 帧名（`delta/usage/done/error`）。
- ❌ 不在前端存 key、不在 localStorage 存对话、不把 key 放进任何日志或 URL。
- ❌ 不用 `v-html` 渲染 AI 输出（含「复制为 HTML」之类延伸功能，本包不做）。
- ❌ 不自动写编辑器（任何表单自动回填也要点确认；「标题/描述/标签」动作的产出**只显示在聊天里**，回填表单是 U4-AI3 的事）。
- ❌ 不改 `TipTapEditor` 的既有行为与 DOM（只加 `defineExpose`）；不改 VditorEditor 的主题/图片改写逻辑（B3.6 那套 `srcReverse` 红线）。
- ❌ 不新增依赖（前端零新增包）。

## 7. 手验清单（前端无测试，这 12 步必须逐条做并附截图/记录）

1. 登录 → 顶栏出现「AI」按钮 → 点开，右侧抽屉展开。
2. 未配置状态：发送禁用 + 「去配置」可跳转。
3. `/settings/ai`：新增一条假档案（`baseUrl` 指向本机 stub 或真 provider）→ 保存 → toast「已保存」。
4. 点「测试连接」：未填 key → 显示 `upstream_401`；填错 URL → `network`；填 `http://127.0.0.1:…` 且未开 `allowPrivateNetwork` → `blocked_url`（**这条同时验证出站闸在前端有可读反馈**）。
5. 打开 `allowPrivateNetwork`（确认弹窗）→ 再测 → 变 `blocked_url` 以外的结果。
6. 进 Markdown 文章编辑页 → 上下文条显示「文章 N 字」。
7. 选中一段 → 上下文条变「选区 M 字」→ 「替换选区」变可用。
8. 点「润色」→ 流式出字 → 点「中止」→ 文本停住、按钮复位。
9. 点「替换选区」→ 编辑器内容被替换 → 保存 → 重新进入，内容持久化。
10. 富文本文章编辑页重复 6–9（插入后检查 JSON 结构：可用「导出 HTML」间接确认）。
11. 切到仪表盘 → 上下文条回「未挂载上下文」→ 动作按钮禁用 → 自由对话仍可用。
12. 刷新页面 → 抽屉状态保留、会话清空。

## 8. 交付报告要求

`docs/audits/u4-ai2/README.md`：K1–K12 逐条证据（手验步骤号 + 实际观察；K11 附 spec 名；K12 附命令与输出）、偏离清单、12 步手验记录（含时间与截图路径）、Vditor/CodeMirror 实际用到的 API（文档化的实测结论）、已知缺口。

---

## 9. 执行纪律（本仓实测经验，照做省时间）

### 9.1 进度回报（硬要求）

上一批的执行方在收尾前**异常中断且全程无回报**，架构师只能事后靠工作树反推进度。本批要求：

- **每完成一个里程碑就 `send_message` 给架构师一行**：`① 设置页可保存 ② 抽屉可流式 ③ 三编辑器可插入 ④ 收尾中`；
- **任何一次连续 20 分钟无进展**（例如卡在某个 Vditor/ProseMirror API 上），先发一行说明卡在哪，再继续；
- 不要在长任务里保持沉默——**沉默比卡住更贵**。

### 9.2 命令（本机实测，别自己摸索）

```bash
# 类型检查 + 构建（web 段含 vue-tsc --noEmit）
pnpm build                                  # 全量；只想验 web：pnpm --filter @mizuki/web build

# 静态检查（根 eslint，含 boundaries；排除 apps/web 的样式规则）
pnpm lint

# 后端全量（本包新增的 shared 纯函数测试跑在这里；约 6 分钟）
pnpm --filter @mizuki/server exec vitest run --maxWorkers=1
# 定向：
pnpm --filter @mizuki/server exec vitest run test/shared/ai-web.spec.ts --maxWorkers=1
```

**不要**直接调 `apps/server/node_modules/.bin/vitest`：node_modules 布局会在
`--config.node-linker=hoisted` 与默认 isolated 之间被 installer 改写，该路径会消失
（报 `Cannot find module …/vitest.mjs`）。`pnpm --filter … exec` 与布局无关。

`pnpm --filter … exec|build` 可能触发一次自动 install；若随后 `pnpm build` 在 web 段报缺依赖，
**再跑一次即可自愈**（不要改代码去「修」它）。

### 9.3 禁区补充

- ❌ 不改 `apps/server/**` 的任何**产品代码**（本批只允许在 `apps/server/test/shared/` 下新增测试文件）。
- ❌ 不改 `apps/web/src/lib/editors/VditorEditor.vue` 既有的图片改写/`srcReverse` 逻辑（B3.6 红线）。
- ❌ 不为了「让页面先跑起来」而临时降级 AI1 契约（例如前端自己拼提示词、自己造 `<document>`）。
- ❌ 不在前端做 provider 协议适配（baseUrl 拼接、Bearer 头）——那是服务端的事。

### 9.4 交付前自检（K12 的一部分）

1. `pnpm build` exit 0 且 vue-tsc 无错；
2. `pnpm lint` 0:0；
3. 后端全量单批全绿，且**如实报告**文件数/用例数（含新增的 shared 测试）；
4. 12 步手验**真的走过一遍**（没有浏览器就明确写「未做，需架构师代做」，**不许写成已做**）。
