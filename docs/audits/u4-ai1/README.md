# U4-AI1 交付验收报告（AI 接入第一期 · 后端）

> [批次] U4-AI1 —— AI 配置 + 出站闸 + 流式代理 + 动作提示词
> [指令包] `docs/prompts-ui/U4-AI1-backend-chat.md`
> [PM 裁定] 2026-10-22：默认 DeepSeek；用户自填 `baseUrl`/`key`；代理三态（直连/系统/指定）；**批准新增依赖 `undici`**；`system` 代理只读环境变量（不读 Windows 系统代理，接受该边界）。
> [报告性质] **本报告由架构师独立核验后撰写**。执行方（子代理）在实现完成后、写报告前异常中断（工作树证据见 §5），未产出自己的交付报告；因此下文所有结论均以架构师实跑证据为准，不含执行方自述。

---

## 1. 结论

**通过。** 4 个端点、出站安全闸、SSE 七条必做项、F1/F2 两个既存缺陷修复全部落地；站点启用 `usage: null` 形态的真实上游也打通。
真链路（真实 DeepSeek）**L1–L4 全绿**，假上游 e2e **p10a/p10b/p10c 全绿**，动作提示词单测 **p10e 全绿**。

---

## 2. 交付物（对比指令包 §2）

| 文件 | 状态 |
|---|---|
| `packages/shared/src/ai.ts` | 新建（契约单源；另含 `AI_ACTIONS` 等） |
| `packages/shared/src/index.ts` | 改（`export *`） |
| `apps/server/src/common/net/outbound.ts` | 新建（出站闸） |
| `apps/server/src/config/app-config.ts` | 改（`ai` 段 + 默认档案 `deepseek-flash`） |
| `apps/server/src/modules/ai/{ai.module,ai.controller,ai-config.service,ai-chat.service,sse}.ts` | 新建 |
| `apps/server/src/modules/ai/provider/openai-compatible.ts` | 新建（唯一出站适配器） |
| **`apps/server/src/modules/ai/prompts.ts`** | **新建（架构师补齐，见 §4-K17 与 §6-①）** |
| `apps/server/src/app.module.ts` | 改（注册 `AiModule`） |
| `apps/server/src/common/interceptors/operation-log.interceptor.ts` | 改（F1 + F2） |
| `apps/server/package.json` + `pnpm-lock.yaml` | 改（新增 `undici@7.30.1`；lock 仅 +261 字节，无大面积重写） |
| `.env.example` | 改（`MIZUKI_AI_API_KEY` 占位） |
| `apps/server/test/config/app-config.spec.ts` | 改（补 `ai` 默认段断言） |
| `apps/server/test/p10a|p10b|p10c` | 新建（27 用例） |
| **`apps/server/test/p10d-ai-live.e2e-spec.ts`** | **新建（架构师补：真链路验收，默认跳过）** |
| **`apps/server/test/p10e-ai-prompts.spec.ts`** | **新建（架构师补：6 用例）** |

---

## 3. 验收对照（K1–K17）

| # | 项 | 证据 | 结论 |
|---|---|---|---|
| K1 | key 只回掩码、明文不出现在响应 | `p10a` + `p10d/L1`（`JSON.stringify(body)` 不含 key） | ✅ |
| K2 | `MIZUKI_AI_API_KEY` 优先，`keySource=env` | `p10a` + `p10d/L1` | ✅ |
| K3 | `keepApiKey` 省略=保留；`false`+无 key=清空 | `p10a` | ✅ |
| K4 | 出站闸 12 类拒绝 + `allowPrivateNetwork` 放行 | `p10b`（8 用例） | ✅ |
| K5 | 帧序 `delta* → usage? → done`，data 合法 JSON，响应头含 `X-Accel-Buffering: no` | `p10c` K5 | ✅ |
| K6 | 客户端中途断开 → 上游被 abort（不继续烧 token） | `p10c` K6（裸 http 断连 + 假上游 `res.on('close')` 证据） | ✅ |
| K7 | 首字节后上游断流 → `event: error`，HTTP 仍 200 | `p10c` K7 | ✅ |
| K8 | 上游 401 → 首字节前标准错误，分类 `upstream_401`，不含上游原文 | `p10c` K8 | ✅ |
| K9 | 消息数/单条字符/上下文超限 → 400 | `p10c` K9 | ✅ |
| K10 | 第 21 次/分 chat → 429 | `p10c` K10（独立 app 实例 = 独立限流存储） | ✅ |
| K11 | lint 0:0 / build 0 / 全量单批全绿 | §7 三连 | ✅ |
| K12 | `app-config.spec.ts` 已补 `ai` 断言（未弱化原断言） | 代码 diff + 全量绿 | ✅ |
| K13 | **F1**：`operation_log.detail` 对 `apikey`/`api_key` 掩码 | `p10a`（含两种键名） | ✅ |
| K14 | **F2**：`POST /admin/ai/chat` 不把正文写进 `detail` | `p10c` K14 | ✅ |
| K15 | 保存即生效（`resetAppConfigCache`），不重启 | `p10c` K15（PUT 换 baseUrl 后 ping 打到新端口） | ✅ |
| K16 | 深合并不丢档案/key（只改 proxy） | `p10c` + `p10a` | ✅ |
| **K17** | **真上游可用**：真实 provider ping + 流式 + key 不落盘 | `p10d` L1–L4 | ✅ **（本轮新增，见 §4）** |

---

## 4. 真链路验收发现并修复的缺陷（K17 的由来）

**为什么必须做真链路**：p10a–p10c 全部用本机假上游，证明的是协议与边界；真实上游还有一层「协议允许但假上游不会发」的形态差异。实测证明这个判断是对的——**第一次跑真链路就挂**。

| 项 | 内容 |
|---|---|
| **现象** | `POST /admin/ai/chat` 对真实 DeepSeek：HTTP 200 + SSE 头正常，但只有一帧 `event: error`，`code=network`（233ms） |
| **排除过程** | ① 真 key 直连/代理都能 `GET /v1/models`（200）⇒ key 与网络正常；② 写一次性 undici 探针（direct / `EnvHttpProxyAgent` / `ProxyAgent` 三种模式直读真上游流）⇒ **全部正常读完 5854 字节** ⇒ 排除代理与 undici 流式能力；③ 在首字节后的 catch 里加诊断日志（只记错误名 + 分类码），拿到真错误 |
| **根因** | `TypeError: Cannot read properties of null (reading 'prompt_tokens')`。真实上游在**非末帧**普遍发 `"usage": null`，而实现只判 `usage !== undefined` ⇒ 对 `null` 取属性抛错 ⇒ 首字节后中断 ⇒ 用户看到 error 帧。假上游从没发过 `null`，所以 p10c 全绿也测不出来 |
| **修复** | ① `UpstreamChunk.usage` 类型加 `\| null`；② 判空改为 `usage !== undefined && usage !== null`；③ **在 p10c 的假上游里注入 `"usage": null`** 作为回归守卫（真上游形态仿真）；④ 首字节后失败新增诊断日志（只记 `errName`/`errMessage`/`code`，不记上游 body/header/URL） |
| **验证** | `p10c` 11 用例仍全绿（含新守卫）；`p10d` L1–L4 全绿（真实 ping 303ms、真实流式 1071ms 出正文并以 `done` 收尾） |
| **教训（已入台账）** | 「假上游全绿」不等于「真上游可用」。凡对接外部协议，验收必须包含一次**带真凭据的真链路**，且该链路要能在 CI 上默认跳过、本地按需运行 |

---

## 5. 过程记录（据实）

1. **执行方异常中断**：子代理在约 1 小时 20 分后被中断（状态 inactive），**未产出交付报告**。工作树显示 18 个文件均已完成、`undici` 已装、p10c 已绿 ⇒ 属「收尾前死亡」，非方向性失败。处置：不回滚、不由执行方续跑，**改由架构师独立核验**（本报告）。
2. **node_modules 布局被意外改写**：执行方为加 `undici` 用了 `--config.node-linker=hoisted`；随后一次 `pnpm --filter @mizuki/shared build` 触发的自动 install 又把它改回默认（isolated），导致 `apps/server/node_modules/.bin/vitest` 消失、定向测试报 `MODULE_NOT_FOUND`。处置：改用**仓库官方入口** `pnpm --filter @mizuki/server exec vitest run …`（与链接器布局无关），并统一后续所有验证命令。
3. **`viaProxy` 形态偏离（接受）**：指令包写的是枚举 `'none'|'system'|'custom'`，实现返回**布尔**（= 配置意图，`mode !== 'none'`），并附诚实注释：`system` 模式下 `NO_PROXY` 命中会直连，服务端无法感知实际是否经代理。判定：**接受**（布尔 + 注释比枚举更诚实，枚举会诱导前端宣称「已走代理」）。**影响 U4-AI2**：设置页要展示配置 mode + 布尔意图两件事。
4. **失败分类补充（接受）**：实现新增 `upstream_4xx`（上游 400/404/429 真实存在，例如模型名不存在即 400）。指令包未列举，但把它谎报成 5xx 会把排障方向指错。判定：**接受并登记**；U4-AI2 的文案表要含该码。
5. **动作提示词与上下文注入缺失（架构师补齐）**：实现把 `action` 与 `context.text` **接收后静默丢弃**（`buildMessages` 只透传 `messages`），等于「润色/摘要」拿不到正文——功能不可能工作。指令包 §6 只在设计对话里出现过、未写进包正文，属**指令包自身的缺口**。处置：架构师新增 `modules/ai/prompts.ts`（5 动作指令 + 注入立场 + 标签逃逸中和）并补 `p10e` 单测与 `p10c` 上游消息断言。→ **教训：语义条款必须写进包，不能留在聊天里。**

---

## 6. 已知缺口（登记，不追补）

1. **DNS rebinding 未拦**：出站闸挡字面量私网/回环/元数据与 `localhost`，但「公网域名解析到私网」未拦（需 pin IP 连接，成本不匹配）。因此 `allowPrivateNetwork` 默认 `false`，且**不得**对外宣称「完全防 SSRF」。
2. **`system` 代理的实际路径不可观测**：只报配置意图（见 §5-3）。
3. **`AUDITED_METHODS` 不含 PUT**：`PUT /admin/ai/config` 不产生 `operation_log` 流水（既有安全设计口径，改动需 ADR）。U4-AI2 设置页需自行提示。
4. **无 `ai_usage` 用量表**：本期只做单次 `maxOutputTokens` 上限 + 每分钟限流；token 计数与月度统计留 P6c。
5. **`p10d` 不进 CI**：`MIZUKI_AI_LIVE_KEY` 未设置时整块跳过（这是刻意的：CI 不应依赖外部付费服务）。

---

## 7. 三连（架构师实跑，冻结态）

- 全量单批：`pnpm --filter @mizuki/server exec vitest run --maxWorkers=1`
- 构建：`pnpm build`
- 静态检查：`pnpm lint`

> 具体数字见台账 `docs/SESSIONS.md` 本轮记录；数账只认**全量单批全绿**的那一轮（流程规则 R6）。

---

## 8. 真凭据使用与善后

- 真 key **只在环境变量 `MIZUKI_AI_API_KEY` / `MIZUKI_AI_LIVE_KEY` 中传递**，未写入仓库任何文件；`p10d/L4` 断言「临时 config.json 不含 key 明文」即为此提供证据。
- **待办（PM）**：验收完成后**吊销该 key**（它已在对话中以明文出现，建议重发一把而非仅本地删除）。
