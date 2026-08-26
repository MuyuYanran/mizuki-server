# ADR-008: 不实现 GET /admin/events SSE 事件转发

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-26 |
| 阶段 | P10d（面板剩余模块） |

## 背景

P10d §3.5 仪表盘规格列出「实时刷新」为**可选**能力：经 `GET /admin/events` SSE 转发事件总线（`content.changed` / `backup.completed` / `process.finished` 等）驱动卡片刷新。§4.3 同时指出前端 EventSource 无法附自定义头，需在「查询参数一次性 token / fetch 流」之间取舍。§2 将该端点列为「后端例外（仅一处，可选）」，并要求「做不做、怎么做都必须记 ADR」。

## 决策

**不实现 `GET /admin/events` SSE 事件转发。** 仪表盘统计卡片采用「进入页面拉取 + 手动刷新按钮」模式获取数据，不依赖实时事件推送。

## 理由

1. **规格明确标注「可选」**：§3.5 原文「实时刷新：**可选** `GET /admin/events` SSE 转发」。实时性非 MVP 硬性需求，仪表盘统计数据的实时性要求低（文章数、日记数等聚合值在内容操作后由用户主动刷新即可观察到）。

2. **后端例外最小化**：P10d 主体为前端阶段，§2 将 `GET /admin/events` 列为「本阶段唯一允许的后端新增」且标「可选」。不引入该端点即保持 `apps/server/` 零改动，完全遵守 §5 第 3 条「禁止把任何 stub 接入 Nest 管道」的精神延伸——不新增需测试、需维护、需安全审查的后端接口。

3. **认证与 SSE 的技术摩擦**：后端全局守卫（P6）要求所有 `/admin/**` 路由携带 JWT。浏览器原生 EventSource API 无法设置自定义请求头，必须二选一：
   - **查询参数一次性 token**：后端额外签发短时 token + 守卫对该端点做 query 参数旁路认证——新增认证旁路逻辑，扩大攻击面。
   - **fetch + ReadableStream 流式读取**：前端自实现 SSE 解析（解析 `data:` 行、处理 `event:` 类型、重连）——代码量与维护成本高于 EventSource。
   两种方案均引入额外复杂度，与 §8「更保守、更少代码」解释原则冲突。

4. **事件总线已是内部通道**：`@nestjs/event-emitter` 的 EventBus 用于模块间异步交互（P0b 起），订阅者为服务端内部模块（value-cache 失效、索引更新）。将其转发到前端属于跨信任域边界——前端是认证后的管理客户端，但事件 payload 可能含内部路径/标识，转发需额外审查脱敏。MVP 阶段无此需求。

5. **P9 已有 SSE 先例**：构建预览控制台的日志终端（`GET /admin/process/tasks/:id/logs`）必须用 SSE（实时日志），本阶段用 fetch + ReadableStream 实现（因 EventSource 无法带 token）。这是**必要**的 SSE 用例。仪表盘的实时刷新是**非必要**的 SSE 用例——为非必要用例再增加一套 SSE 基础设施不划算。

## 备选方案

- **实现 fetch 流方案**：新增 `EventsController`（`@Controller('admin/events')`），`@Sse('events')` 返回 Observable，订阅 `EventEmitter2` 的六事件，转发为 SSE；前端用 fetch + ReadableStream 订阅，解析 `data:` 行，按事件类型刷新对应卡片。否决理由：复杂度高、后端需新增端点与测试、payload 脱敏审查成本——均为 MVP 非必要。

- **查询参数一次性 token 方案**：登录时额外签发 `eventsToken`，前端 EventSource 用 `?token=` 携带，后端守卫对该端点验证 query token。否决理由：新增认证旁路（绕过标准 Bearer 头校验），扩大攻击面，与 P6 安全边界定型精神冲突。

## 后果

- 仪表盘不实时刷新：用户在内容操作后需手动点「刷新」按钮或重新进入页面观察统计变化。可接受（统计值非时效敏感）。
- P11 收尾或二期如需实时性，可再评估实现——届时走本 ADR 备选方案之一，并更新本 ADR 状态。
- 构建预览控制台的 SSE 日志终端（P9 端点）不受影响——那是已存在的必要 SSE 用例，本阶段前端用 fetch 流消费它。
- 事件总线（EventEmitter2）仍正常工作于服务端内部（value-cache 失效、索引增量等），本决策仅影响「转发到前端」的可见性。
