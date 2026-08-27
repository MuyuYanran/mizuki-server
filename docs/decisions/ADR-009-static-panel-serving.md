# ADR-009: 后端静态服务 apps/web/dist（同源面板托管）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-26 |

## 背景

P11 §3.2 要求根 README 写明「面板地址 `localhost:20154`」（MASTER-PLAN §1 锁定约束：面板与 API 同源同端口 20154）。但截至 P10d，后端并无静态服务——`apps/web` 生产产物 `dist/` 只能经 vite dev 代理（20155 → 20154）访问，「同源 20154」在生产形态下不成立。这是规格间缺口（README §3.2 ↔ 本阶段 §5「不新增功能」），P11 §8 冲突处理协议要求停下报告、人工二选一。

**人工裁决（2026-08-26，P11 会话）**：采用候选方案 1——后端 main.ts 增加最小静态服务（约 15–20 行），并给出规格补白如下（本 ADR 逐条记录）：

1. main.ts 检测 `apps/web/dist/index.html`：不存在则跳过全部静态服务逻辑（**开发模式零行为变化**），pino 记录「未发现 web 构建产物，静态服务未启用」；存在则 `useStaticAssets(dist)` 托管。
2. SPA 回退：仅对「非 `/api` 前缀的 GET」返回 `index.html`（深链刷新不 404）；`/api/**` 不受影响，**API 404 JSON 语义保持不变**。
3. helmet CSP 不整体关闭；若产物加载失败按需放宽对应指令并注明原因。实际落地：仅对 `/api/v1/docs*`（Swagger UI）定点放宽 `script-src`/`style-src` 的 `unsafe-inline`（swagger-ui 官方 HTML 含内联初始化脚本），面板与全部 API 响应仍用 helmet 默认 CSP（面板产物为外链 module 脚本，默认 `script-src 'self'` 即可加载）。
4. P11 §2 文件清单追加：允许修改 main.ts、允许新建 `apps/server/test/` 下静态服务 e2e 测试；README 写「开发（vite 代理）/ 生产（bin 单命令）」两种形态。

## 决策

- `main.ts` 新增 `setupStaticPanel(app, webDist)`：dist 存在性检测 → `useStaticAssets` → 非 `/api` GET 的 SPA 回退；目录可经 `MIZUKI_WEB_DIST` 环境变量覆盖（默认 `apps/server/dist` 相对定位 `../../web/dist`）。
- 回退判定用「非 `/api` 前缀」而非「Accept: text/html」：更保守（可能对个别非 API 的 GET——如缺省 favicon——也回退 index.html），但实现最小、语义与全局前缀 `/api/v1` 对齐。
- 导出 `setupSwagger` / `setupStaticPanel` 供 e2e 复用；`bootstrap()` 以 `require.main === module` 守卫，测试进程 import main.ts 不触发 listen。
- 验收（已全部落地为 `test/p11-static-panel.e2e-spec.ts` + 冒烟记录）：有 dist 时 GET / 200 含 `<div id="app">`、GET /api/v1/system/health 200、GET /api/v1/public/nonexist 仍 API 404 JSON、SPA 深链 200；无 dist 时服务正常启动且 GET / 返回 404 JSON。

## 备选方案

- 候选方案 2（未采纳）：生产用独立静态服务器（nginx / `vite preview`）反代 20154。多一个部署组件、违背「bin 单命令启动」目标，且 MASTER-PLAN §1 的同源约束仍需反代层模拟。
- 不做任何处理（未采纳）：README 谎称 localhost:20154 可访问面板，文档与现实不符，违背 §3.2 验收。

## 后果

- 生产形态闭环：`pnpm build` → `node apps/server/bin/mizuki-server` → `localhost:20154` 即面板 + API + Swagger，单命令单端口。
- 开发形态不变：vite dev（20155，代理 /api → 20154）仍是面板热更新主路径；`MIZUKI_WEB_DIST` 覆盖目录用于部署时产物分离。
- 新增环境变量 `MIZUKI_WEB_DIST`（可选），已记入 README 与本 ADR。
- `apps/web/dist` 进入运行依赖路径：`pnpm build`（根）必须含 web 构建，冒烟链路（P11 §6.1）已按此验证。
