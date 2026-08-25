# 任务：安全基建 — 路径监狱、zod 管道与全局防护（阶段 P1）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P1**，前置依赖阶段：**P0b（config/DB/异常过滤器）**。

本会话范围一句话：**实现 `safeJoin` 路径监狱（含符号链接逃逸防护与攻击用例单测）、zod 校验管道，并在 `app.setup.ts` 挂载 helmet、CORS 白名单、全局 zod pipe 与全局 throttler**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。**特别强调：禁止实现 JWT 守卫**（那是 P6 的活）。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§4.1（全局守卫策略）、§7「路径监狱」（safeJoin 规格与攻击用例）、§9 守则第 4 条
2. `docs/REQUIREMENTS.md`：§9（安全需求）第 2、3、8 条
3. `CHANGELOG.md`：P0b 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/common/security/safe-join.ts`
   - `apps/server/src/common/pipes/zod-validation.pipe.ts`
7. 已实现的接线点：`apps/server/src/app.setup.ts`（P0b 已挂全局过滤器）、`apps/server/src/common/filters/all-exceptions.filter.ts`（统一异常格式）

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/common/security/safe-join.ts`（[P1]）
- `apps/server/src/common/pipes/zod-validation.pipe.ts`（[P1]）

**本阶段允许修改的既有实现文件**：

- `apps/server/src/app.setup.ts`（追加 helmet / CORS 白名单 / 全局 zod pipe / 全局 throttler）
- `apps/server/src/app.module.ts`（挂载 ThrottlerModule，见 §4）

**本阶段允许新建的文件**：

- `apps/server/test/` 下本阶段测试文件（单测 + e2e）

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`common/guards/jwt-auth.guard.ts`（P6）、`common/decorators/public.decorator.ts`（P6）、`common/interceptors/operation-log.interceptor.ts`（P6）、`infra/backup/backup.service.ts`（P2）、`modules/system/mizuki-detector.service.ts`（P6）、`modules/auth/*`（P6）、`modules/data-files/*`（P3）、`modules/collections/*`（P4）、`modules/posts/*`（P5）、`modules/articles/*`（P8）、`modules/albums/*`（P7）、`modules/media/*`（P7）、`modules/process/*`（P9）、`modules/backup/*`（P2）、`modules/settings/*`（P8）。

## 3. 详细规格

### 3.1 `safe-join.ts` — 路径监狱（全项目唯一合法路径入口）

实现逐字遵循 MASTER-PLAN §7：

```ts
function safeJoin(root: string, untrusted: string): string {
  const p = path.resolve(root, untrusted);
  if (p !== root && !p.startsWith(root + path.sep)) throw new ForbiddenPathError();
  return p; // 上层再对已存在祖先做 realpath 校验防符号链接逃逸
}
```

具体要求：

1. `safeJoin(root, untrusted)`：`path.resolve` 归一化 + 前缀校验（`p === root` 或 `p.startsWith(root + path.sep)`），越界抛 `ForbiddenPathError`（本文件内定义的具名错误类）。
2. **已存在祖先的 realpath 校验（防符号链接逃逸）**：提供 `safeRealJoin(root, untrusted)`（或在 `safeJoin` 之外提供配套函数，命名自定但须在头注释说明）——对结果路径中**已存在的祖先链**逐级 `fs.realpath`（或自下而上找到第一个存在的祖先后对其 realpath），确认 realpath 仍在归一化后的 root 之内；若祖先不存在则对最深层已存在祖先做校验。目标：在 `root` 内放置指向外部的符号链接时，任何穿越它的组合路径都被拒绝。
3. 空字节、URL 编码（`%2e%2e` 等）、反斜杠混合路径必须在单测中显式覆盖；空字节在入口直接拒绝（Windows 路径本身非法）。
4. 头注释标注 [状态] ACTIVE 与本模块是“全项目唯一合法路径入口”（后续所有模块读写文件必须经过本函数，MASTER-PLAN §9 守则 4）。

### 3.2 `zod-validation.pipe.ts` — 全局 zod 校验管道

- 提供工厂 `new ZodValidationPipe(schema: z.ZodType)`（或等价构造），对 `@Body()` 输入执行 `schema.parse`。
- 校验失败抛 `BadRequestException`，detail 携带 zod issues（经 P0b 统一过滤器输出 `{ code, message, detail }`）。
- 本阶段在 `app.setup.ts` 以全局管道注册一个**拒绝一切非法 body 的兜底策略**：提供全局默认管道挂载点与用法说明；具体业务 schema 由后续阶段在路由上显式声明（本阶段至少演示一条路由级/全局用法并通过 e2e 验证，可用 `SystemController` 上临时测试路由或专用测试控制器——测试用控制器不得留在 `src/` 正式目录，放 `test/` 侧或实现后即删）。

### 3.3 `app.setup.ts` 追加全局防护（MASTER-PLAN §4.1 + REQUIREMENTS §9）

1. **helmet**：启用默认安全头。
2. **CORS 白名单**：默认仅 `localhost`（`http://localhost:20154`，端口来自配置）；白名单可由配置扩展（读 P0b 的 `AppConfig`）。非白名单 origin 拒绝。
3. **全局 zod pipe**：按 §3.2 挂载。
4. **全局 throttler**：`ThrottlerModule.forRoot` + 全局 `ThrottlerGuard`（APP_GUARD），**60 次/分钟（按 IP）**；登录路由 5 次/分在 P6 挂到 auth 时启用，本阶段不实现。

### 3.4 测试规格（§6 验收的依据）

- safe-join 攻击用例**必须**覆盖（每条独立用例）：`../` 逃逸、绝对路径注入、`..\` 反斜杠逃逸、URL 编码（`%2e%2e/` 等）、空字节、符号链接逃逸（在临时 root 内建指向外部目录的 symlink，断言穿越它的路径被拒）。另附正常用例（合法相对路径、`root` 自身、嵌套合法子路径）。
- zod pipe：合法 body 通过；非法 body（字段缺失/类型错误）返回 400 且响应体含 `code/message/detail`。
- e2e：throttler 生效——对同一路由连续请求 61 次，第 61 次返回 429（测试可将限流窗口配置调小以加速，断言逻辑不变）。

## 4. 接线说明

1. `app.setup.ts`：按顺序追加 `app.use(helmet())`、`app.enableCors({ origin: 白名单 })`、全局 `ZodValidationPipe` 挂载点；保留 P0a 的全局前缀与 P0b 的全局过滤器。
2. `app.module.ts`：imports 追加 `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])`；`providers` 追加 `{ provide: APP_GUARD, useClass: ThrottlerGuard }`。
3. 无新增依赖：`helmet`、`@nestjs/throttler`、`zod` 已在 P0a 依赖清单（见 ADR-001）。若确需新增（如 CORS 相关），记入交付报告并更新 ADR-001。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = §2 之外的 stub 不得接线；第 4 条 = 本阶段默认零新增依赖。

**本阶段专属禁止**：

- **禁止实现 JWT 守卫**（`jwt-auth.guard.ts` 保持 SKELETON，这是 P6 的活）。
- 不得实现登录限流（5 次/分）——属 P6。
- 不得在本阶段对真实/假 Mizuki 目录做任何写入（本阶段只有路径校验单测，用临时目录）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行）：

1. **safe-join 攻击用例**：`../`、绝对路径、`..\`、URL 编码、空字节、symlink 逃逸各 ≥1 条用例全部抛 `ForbiddenPathError`；正常用例 ≥3 条全部通过返回正确绝对路径。合计 ≥8 个攻击用例 + 正常用例。
2. **realpath 防护**：临时目录内 `root/link → 外部目录`，`safeJoin`+realpath 校验组合对 `link/x` 拒绝；无 symlink 的合法路径放行。
3. **zod pipe**：e2e 断言——非法 body → 400 且 body 含 `code/message/detail`；合法 body → 200/201。
4. **helmet/CORS**：e2e 断言——响应含安全头（如 `x-content-type-options` 或 `content-security-policy`）；非白名单 origin 的预检请求不被允许（`Access-Control-Allow-Origin` 不出现或不含该 origin）。
5. **全局限流**：e2e——同 IP 连续请求 61 次，第 61 次返回 429（窗口可调小，断言语义不变）。
6. **回归**：P0a/P0b 既有用例全绿（health 200、11 表迁移、异常过滤器）。
7. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（6 类攻击 + 正常用例 + pipe + helmet/CORS + throttler，合计 ≥12 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 偏差清单：理想为空；任何偏差必须显式列出原因（含 realpath 校验的具体实现策略选择，若做了取舍须写 ADR）。
4. `CHANGELOG.md` 追加 P1 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
