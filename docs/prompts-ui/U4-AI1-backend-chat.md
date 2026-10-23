# U4-AI1 指令包 —— AI 接入第一期（后端：配置 + 出站闸 + 流式代理）

> [前置] HEAD = `dba6266`（v1.1.0 发布 + 台账）。基线 **596 用例 / 68 文件**（`apps/server/test`，全量单批 `--maxWorkers=1`）。
> [定位] 本包只做**后端**（可全自动化验证）；前端（全局右侧聊天栏 + `/settings/ai` 设置页 + 5 个动作）为 **U4-AI2**，等本包绿了再出。
> [依据] 设计见本轮对话的「AI 接入设计」；PM 四项裁定（2026-10-22）：默认 DeepSeek、用户自填 url/key、代理三态（直连/系统/指定）、面板为全局右侧聊天栏、设置进菜单。
> [已批准] 2026-10-22 PM 两项裁定：**① 批准新增依赖 `undici`**；**② `proxy.mode='system'` 只读环境变量**（不读 Windows 注册表，接受该边界）。→ 阻塞项已解除，本包可开工。

---

## 0. 开工前必须确认的两条（执行方不得自行决定，遇到就停）

1. **新增依赖 `undici`**（仅 `modules/ai` 使用）。理由：Node 22 的全局 `fetch` **不读** `HTTP_PROXY`/`HTTPS_PROXY`，且 `ProxyAgent`/`EnvHttpProxyAgent` 未对外暴露；没有它，「系统代理 / 指定代理」这条 PM 要求无法实现。→ **已由架构师提请 PM 批准**；未批准则本包**不要开工**（不要用自研 CONNECT 隧道替代）。
2. **不新建密钥文件**。AI 配置与 key 一律写 `apps/server/data/config.json`（已在 `.gitignore` 的 `apps/server/data/*` 白名单内），环境变量 `MIZUKI_AI_API_KEY` 优先覆盖。

---

## 1. 目标（本包做完后应能发生的事）

```
1) 管理员可在面板保存「AI 服务」配置（多套 provider 档案 + 代理三态），key 只写不读；
2) 可点「测试连通性」，返回 { ok, latencyMs, viaProxy, model }；
3) 可用 POST /admin/ai/chat 发一段对话，服务端以 SSE 流式回传 delta；
4) 关掉页面/断网 → 上游请求被中止（不继续烧 token）；
5) 上游失败 → 首字节前是标准 JSON 错误，首字节后是 event: error 帧；
6) 出站 URL 必过安全闸（私网/回环/云元数据一律拒，除非显式 allowPrivateNetwork）。
```

**不做**：不改任何编辑页、不做前端、不建数据库表、不做工具调用、不做用量统计。

---

## 2. 文件清单（新建 / 修改）

| 文件 | 动作 | 备注 |
|---|---|---|
| `packages/shared/src/ai.ts` | 新建 | 契约单源：枚举 + zod schema + 限额常量 |
| `packages/shared/src/index.ts` | 改 | `export * from './ai'` |
| `apps/server/src/common/net/outbound.ts` | 新建 | `assertSafeOutboundUrl` / `assertSafeProxyUrl` |
| `apps/server/src/config/app-config.ts` | 改 | 新增 `ai` 段（**必须进 schema，防 strip**） |
| `apps/server/src/modules/ai/ai.module.ts` | 新建 | — |
| `apps/server/src/modules/ai/ai.controller.ts` | 新建 | 4 个端点 |
| `apps/server/src/modules/ai/ai-config.service.ts` | 新建 | 读 → 掩码视图 / 写（keep 语义）/ env 覆盖 |
| `apps/server/src/modules/ai/ai-chat.service.ts` | 新建 | 编排：闸 → provider → 帧序列 |
| `apps/server/src/modules/ai/provider/openai-compatible.ts` | 新建 | 唯一出站适配器（OpenAI 兼容协议） |
| `apps/server/src/modules/ai/sse.ts` | 新建 | SSE 帧写入 / 头 / 收尾 |
| `apps/server/src/app.module.ts` | 改 | 注册 `AiModule` |
| `apps/server/package.json` | 改 | `undici` 依赖 |
| `.env.example` | 改 | 加 `MIZUKI_AI_API_KEY=`（占位，非真值） |
| `apps/server/test/config/app-config.spec.ts` | 改 | 补 `ai` 默认段断言（**P4a 教训：整对象 toEqual 会红**） |
| `apps/server/test/p10a-ai-config.e2e-spec.ts` | 新建 | 配置与掩码 |
| `apps/server/test/p10b-outbound.spec.ts` | 新建 | 出站闸单测 |
| `apps/server/test/p10c-ai-chat-stream.e2e-spec.ts` | 新建 | 假上游 + 帧序 + 中止 + 首字节后错误 |
| `apps/server/src/common/interceptors/operation-log.interceptor.ts` | 改 | 见 §8 附属修正 F1 / F2 |
| `docs/decisions/ADR-001-dependency-versions.md` | 改 | 追加 `undici` 条目与用途 |

### 架构师预扫发现的两个既存缺陷（本包顺手修，二者都是新能力直接触发的）

- **F1｜敏感词表缺 `apikey`**：`operation-log.interceptor.ts:25` 的 `SENSITIVE_KEY_HINTS` = `password|token|secret|authorization|credential`，**不含 `apikey`**。AI 配置若走 POST/PATCH 任何路径，key 会以明文进 `operation_log.detail`。→ 追加 `'apikey'`（并顺手加 `'api_key'` 归一化处理：键名先去 `_-` 再小写比较）。
- **F2｜`POST /admin/ai/chat` 会被审计拦截器整包记录**：拦截器规则是「POST + `/admin/**`」⇒ chat 的 body（**含 `context.text` = 整篇文章正文**）会落 `operation_log.detail`，造成正文重复入库与库膨胀。→ 在拦截器加路由排除（`/admin/ai/chat` 不记 body，只记一条 `{ action, messagesCount, contextChars }` 摘要）。
- 附带订正：`AUDITED_METHODS` 目前不含 `PUT` ⇒ `PUT /admin/ai/config` 不产生审计流水。本包**不擅自改这个口径**（属既有安全设计，改它要 ADR），但 U4-AI2 的设置页必须自己提示「保存不产生审计记录」。→ **登记为已知缺口**，不修。

---

## 3. 契约（`packages/shared/src/ai.ts` 逐字要求）

```ts
export const AI_PROXY_MODES = ['none', 'system', 'custom'] as const;
export const AI_ACTIONS = ['polish', 'continue', 'summarize', 'meta', 'translate'] as const;
export const AI_ROLES = ['system', 'user', 'assistant'] as const;

export const AI_LIMITS = {
  maxMessages: 20,
  maxMessageChars: 20_000,
  maxContextChars: 40_000,
  maxProfiles: 8,
  maxOutputTokensCap: 8192,
} as const;

// 档案（用户可自行填 url/key，PM 要求）
export const AiProfileSchema = z.strictObject({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(40),
  baseUrl: z.string().min(1).max(2048),   // 校验在 assertSafeOutboundUrl（单一来源，禁两处各写一套）
  model: z.string().min(1).max(80),
});

export const AiProxySchema = z.strictObject({
  mode: z.enum(AI_PROXY_MODES),
  url: z.string().min(1).max(2048).optional(), // mode=custom 必填，服务层校验
});

// 只读视图：**永不含 key**
export const AiConfigViewSchema = z.strictObject({
  enabled: z.boolean(),
  activeProfileId: z.string().nullable(),
  profiles: z.array(AiProfileSchema.extend({ maskedKey: z.string() })),
  proxy: AiProxySchema,
  allowPrivateNetwork: z.boolean(),
  maxOutputTokens: z.number().int(),
  temperature: z.number(),
  timeoutMs: z.number().int(),
  keySource: z.enum(['none', 'config', 'env']),  // env 时 profiles[].maskedKey 也来自 env（同值）
});

export const AiPutConfigBodySchema = z.strictObject({
  enabled: z.boolean().optional(),
  activeProfileId: z.string().optional(),
  profiles: z.array(z.strictObject({
    id: z.string().min(1).max(32),
    name: z.string().min(1).max(40),
    baseUrl: z.string().min(1).max(2048),
    model: z.string().min(1).max(80),
    apiKey: z.string().max(4096).optional(),
  })).max(AI_LIMITS.maxProfiles).optional(),
  proxy: AiProxySchema.optional(),
  allowPrivateNetwork: z.boolean().optional(),
  maxOutputTokens: z.number().int().min(1).max(AI_LIMITS.maxOutputTokensCap).optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  /** 省略 = 全部保留既有 key（与 taskEnv.keep 同语义）；true 同义；false = 未带 apiKey 的档案清空 key */
  keepApiKey: z.boolean().optional(),
});

export const AiChatBodySchema = z.strictObject({
  action: z.enum(AI_ACTIONS).optional(),
  messages: z.array(z.strictObject({
    role: z.enum(AI_ROLES),
    content: z.string().min(1).max(AI_LIMITS.maxMessageChars),
  })).min(1).max(AI_LIMITS.maxMessages),
  context: z.strictObject({
    kind: z.enum(['none', 'selection', 'article', 'markdown']),
    text: z.string().max(AI_LIMITS.maxContextChars),
  }).optional(),
});

/** SSE 事件名（禁字符串字面量） */
export const AI_SSE = { delta: 'delta', usage: 'usage', done: 'done', error: 'error' } as const;
```

---

## 4. 端点契约

| 端点 | 鉴权/限流 | 行为 |
|---|---|---|
| `GET /admin/ai/config` | JWT | 返回 `AiConfigViewSchema`；key 只回 `maskedKey`（`••••` + 末 4 位；长度 <8 时只回 `••••`） |
| `PUT /admin/ai/config` | JWT | body = `AiPutConfigBodySchema`；`keepApiKey` 语义见上；写后回读返回视图 |
| `POST /admin/ai/ping` | JWT + 5/min | 用 activeProfile 发一条最小请求（`max_tokens: 8`）；成功 `{ ok: true, latencyMs, viaProxy, model }`；失败 `{ ok: false, code, latencyMs }`，**`code` 只取分类值**（`upstream_timeout` / `upstream_401` / `upstream_5xx` / `network` / `blocked_url` / `no_profile`），**不得回显上游 body 或 URL** |
| `POST /admin/ai/chat` | JWT + 20/min | 见 §5 |

**错误形状**沿用 `{ code, message, detail }`，`code` 取 `HttpException.constructor.name`（既有全局过滤器）。

---

## 5. 流式协议（本包最容易写错的地方，逐条实现）

SSE 帧格式：

```
event: delta
data: {"text":"..."}

event: usage
data: {"promptTokens":123,"completionTokens":45}

event: done
data: {}

event: error
data: {"code":"upstream_timeout","message":"上游超时"}
```

必做项：

1. **响应头**：`Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、**`X-Accel-Buffering: no`**（不加则 nginx 反代下不流式）。
2. **首字节前错误** → 走正常异常路径（JSON 错误 + 正确状态码）；**首字节后错误** → 只发 `event: error` 再 `end()`，**不得再改状态码**（会 `ERR_HTTP_HEADERS_SENT`）。
3. **客户端断开**：`req.on('close', () => controller.abort())`，上游 `fetch` 收到 abort 后必须停止读取；`res.writableEnded` 为真时不再写帧。
4. **上游非 200**：读前若 `!res.ok` → 映射分类 code，**不把上游 body 透传**（可能含 key 片段/内部 URL）。
5. **终止保底**：`res.on('close')` 里 `clearTimeout`；服务端还有一个总超时（`ai.timeoutMs`），到点 abort 并发 `event: error`。
6. **帧解析**：按 `\n\n` 切帧，取 `data:` 行；`data: [DONE]` → `done` 帧；`choices[0].delta.content` 为空串时**不发 delta 帧**（避免前端空白抖动）。
7. `@Res()` 原生响应：不要用 `@Sse()`（GET-only，装不下 body）。

---

## 6. 出站安全闸（`common/net/outbound.ts`，单源）

```ts
export interface OutboundPolicy { allowPrivateNetwork: boolean }
export function assertSafeOutboundUrl(raw: string, policy: OutboundPolicy): URL; // 抛 BadRequestException('blocked_url')
export function assertSafeProxyUrl(raw: string): URL;                            // 允许本机回环（代理就在本机）
```

拒绝清单（未开 `allowPrivateNetwork` 时）：

| 类别 | 具体 |
|---|---|
| 协议 | 非 `http:` / `https:` 一律拒（`file:`/`gopher:`/`data:`…） |
| 主机名字面量 | `localhost`、`*.localhost`、`*.local`、`metadata.google.internal` |
| IPv4 字面量 | `127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`0.0.0.0/8`、`100.64/10` |
| IPv6 字面量 | `::1`、`fc00::/7`、`fe80::/10`、`::ffff:<私网v4>` |

另：`fetch` 必须 `redirect: 'error'`（禁跳转绕过）；`allowPrivateNetwork = true` 时才放行（本地 Ollama 场景），且**面板上要显示显著提示**（U4-AI2 负责文案）。

**已知残留风险（写进编码注释，不要假装已解决）**：域名解析到私网的 **DNS rebinding** 未在 v1 拦（要 pin IP 连接，成本与收益不匹配）。因此 `allowPrivateNetwork` 的默认值必须是 `false`，且文档不得宣称「完全防 SSRF」。

**代理与闸的关系**：**目标 `baseUrl` 恒过闸**；代理地址走 `assertSafeProxyUrl`（只校验协议，允许回环/私网——代理本来就在本机）。`proxy.mode = 'system'` 时由 `EnvHttpProxyAgent` 读 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`（**大小写都读**，Windows 常见大写）。

---

## 7. 配置段（`app-config.ts`）

```ts
ai: z.strictObject({
  enabled: z.boolean().default(false),
  activeProfileId: z.string().optional(),
  profiles: z.array(z.strictObject({
    id: z.string().min(1).max(32),
    name: z.string().min(1).max(40),
    baseUrl: z.string().min(1).max(2048),
    model: z.string().min(1).max(80),
    apiKey: z.string().max(4096).optional(),
  })).max(8).default([{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' }]),
  proxy: z.strictObject({
    mode: z.enum(['none', 'system', 'custom']).default('system'),
    url: z.string().max(2048).optional(),
  }).default({}),
  allowPrivateNetwork: z.boolean().default(false),
  maxOutputTokens: z.number().int().min(1).max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
}).default({}),
```

**注意**：`AppConfigSchema` 是未 `.strict()` 的 `z.object` ⇒ 未声明键会被 **strip**（历史上的 `corsOrigins` 就是这样变成死代码）。所以 `ai` 必须显式加入，并在 `test/config/app-config.spec.ts` 补两条断言：默认配置含 `ai` 段；读到 `ai.baseUrl` 不被丢弃。

**落盘与生效（两个既存机制，必须都用对）**：

- `getAppConfig()` 是**进程级单例缓存**（`app-config.ts:116-122`）⇒ PUT 写完配置必须调用 `resetAppConfigCache()`，否则「保存成功但行为不变，要重启才生效」。这是 P11 坑 5「活取」的既有先例，AI 配置必须遵守。
- `mergeAndPersistConfig(patch)` 做的是**浅合并**且 patch 里 `ai` 是整段替换 ⇒ `AiConfigService.save()` 的正确顺序是：`读 current.ai → 按 PUT body 深合并（profiles 按 id 对齐、key 依 keepApiKey）→ mergeAndPersistConfig({ ai: merged }) → resetAppConfigCache()`。

**环境变量覆盖**（`keySource` 判定顺序）：`MIZUKI_AI_API_KEY` > `config.ai.profiles[].apiKey` > `none`。
另支持 `MIZUKI_AI_BASE_URL` / `MIZUKI_AI_MODEL`（仅覆盖 **active profile**，便于容器化部署）。

---

## 8. 禁区（违反即打回）

- ❌ 不改任何领域模块（`posts` / `articles` / `media` / `site-config` / `collections` …）；`modules/ai` 只允许 import `common/`、`config/`、`@mizuki/shared`。
- ❌ 不建数据库表、不做迁移。
- ❌ 不裸写 `fs.writeFile`：配置落盘**只有一条既有通道**——`config/app-config.ts` 的 `mergeAndPersistConfig(patch)`（内部走 `common/fs/atomic-write.ts`），写完必须紧跟 `resetAppConfigCache()`。**不要新建 `saveAppConfig` 或第二套落盘实现**（架构师预扫确认仓内不存在 `saveAppConfig`，别去找）。
- ❌ 不把整段 `ai` 覆盖当合并用：`mergeAndPersistConfig` 是**浅合并**（`{...current, ...patch}`），PUT 只改代理/上限时，服务层必须先读 `getAppConfig().ai` 深合并再整体落盘，否则会**静默清掉其它档案与 key**。
- ❌ 不新增除 `undici` 外的任何依赖（不加 `openai`/`axios`/`dotenv`）。
- ❌ 不把 key 写进日志、错误 message、错误 detail、SSE 帧、`operation_log`（拦截器已掩码 `apiKey`? **不确定** ⇒ 必须自查：`operation-log.interceptor.ts` 的敏感词表含 `token/secret/password`，**不含 `apiKey`**，本包要把 `apikey` 加进 `SENSITIVE_KEY_HINTS`）。
- ❌ 不在 `chat` 端点里拼任何写盘动作（本期 AI 绝不落盘）。
- ❌ 不降低既有断言强度（`app-config.spec.ts` 只能补键，不能放宽）。

---

## 9. 验收（K12 逐项，全部要证据）

| # | 验收项 | 判定 |
|---|---|---|
| K1 | `GET /admin/ai/config` 响应体**不含**任何 key 明文；`maskedKey` 形如 `••••abcd` | e2e 断言 + 人工 curl |
| K2 | `MIZUKI_AI_API_KEY` 存在时 `keySource='env'`，且 PUT 不带 `apiKey` 不会覆盖 env 值 | e2e |
| K3 | `keepApiKey` 省略 = 保留；`false` + 无 `apiKey` = 清空该档案 key | e2e |
| K4 | `assertSafeOutboundUrl` 对 12 类拒绝项全部抛错；开 `allowPrivateNetwork` 后私网放行、协议仍拒 | 单测 |
| K5 | 假上游（本机 http server，测试内开 `allowPrivateNetwork`）→ 帧序 `delta* → usage? → done`，`data` 均为合法 JSON | e2e |
| K6 | 客户端在读流中途 `abort()` → 假上游的请求被 close（用上游的 `req.on('close')` 断言） | e2e |
| K7 | 上游在**首字节后**返回错误 → 收到 `event: error` 帧，且 HTTP 状态码仍是 200 | e2e |
| K8 | 上游 401 → 首字节前失败 → 标准错误体，`code` 分类为 `upstream_401`，**不含上游原文/key** | e2e |
| K9 | `messages` 超 20 条 / 单条超 20000 字符 / `context` 超 40000 → 400 | e2e |
| K10 | 第 21 次/分钟 chat 请求 → 429 | e2e |
| K11 | `pnpm lint` 0:0、`pnpm build` 0、`pnpm test` 全绿（**全量单批 `--maxWorkers=1`，不是定向 spec**） | 架构师复跑 |
| K12 | 新增用例数如实报告；`test/config/app-config.spec.ts` 的 `ai` 断言已补 | 架构师核对 |
| K13 | **F1**：`operation_log.detail` 对 `apiKey` / `api_key` 掩码为 `***`（单测覆盖两种键名） | e2e 或单测 |
| K14 | **F2**：`POST /admin/ai/chat` 落库的 `detail` 不含 `context.text` 与 `messages[].content`（只有摘要三项） | e2e 查 `operation_log` |
| K15 | **保存即生效**：PUT 改 baseUrl/model 后**不重启进程**，紧跟的 ping 已用新值（证明 `resetAppConfigCache()` 被调用） | e2e |
| K16 | **深合并不丢数据**：先存 2 条档案（含 key），再 PUT 只改 `proxy`，回读仍是 2 条档案且 key 未丢 | e2e |

> **R6 纪律**：数账只认**全量单批全绿**的那一轮。只跑定向 spec 不算交付（U3-P4a 的回归就是这么漏的）。

---

## 10. 手验清单（执行方交报告时附上实际记录）

```bash
# 1) 掩码
curl -s -H "Authorization: Bearer $TOKEN" localhost:20154/api/v1/admin/ai/config
# 2) ping（真 key）
curl -s -X POST -H "Authorization: Bearer $TOKEN" localhost:20154/api/v1/admin/ai/ping
# 3) 流式（观察逐帧到达，而不是一次性）
curl -N -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"用一句话介绍你自己"}]}' \
  localhost:20154/api/v1/admin/ai/chat
# 4) 断连中止：上面命令中途 Ctrl+C，查服务端日志确认上游 abort
# 5) 私网拦截
curl -s -X PUT ... -d '{"profiles":[{"id":"x","name":"x","baseUrl":"http://127.0.0.1:11434/v1","model":"qwen"}]}'
curl -s -X POST ... /admin/ai/ping   # 期望 blocked_url
```

---

## 11. 交付报告要求

`docs/audits/u4-ai1/README.md`，必须含：

1. K1–K12 逐条对照证据（命令 / 断言名 / 实际输出）；
2. 偏离清单（每条给理由 + 影响面），**未偏离就写「无」**；
3. 新增用例数、文件清单（对比 §2，多出的文件要解释）；
4. 5 条手验记录（含时间）；
5. 已知缺口（自己发现的，别藏着）。

---

## 12. 与 U4-AI2（前端）的接口约定（提前对齐，避免返工）

- 前端**只消费**：`GET/PUT /admin/ai/config`、`POST /admin/ai/ping`、`POST /admin/ai/chat`（SSE）。
- 前端**不拼** baseUrl、不读 key、不做 provider 协议适配。
- 上下文由前端组装（`context.text`），服务端**不擅自读文章**（本期服务端零领域依赖）。
- SSE 消费形态照抄 `apps/web/src/api/process.ts:168-200`（fetch + `getReader` + `AbortController`；`EventSource` 带不了 Authorization，P9 已踩过）。
