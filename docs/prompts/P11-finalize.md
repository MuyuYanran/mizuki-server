# 任务：收尾 — 文档、启动脚本、安全复查与全量回归（阶段 P11）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P11**（最后一个阶段），前置依赖阶段：**P10d（管理面板控制台）**。

本会话范围一句话：**Swagger 分组、根 README、`bin/mizuki-server` 启动脚本、对照 MASTER-PLAN §7 安全条款逐项复查并输出复查报告、全量回归**。

只做本阶段：不新增任何功能；发现的缺陷按 §8 报告，人工确认后修复。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：**§7 全部（安全条款复查清单的唯一依据）**、§5 全部 API 清单（Swagger 分组核对）、§8 路线图、§9 编码守则
2. `docs/REQUIREMENTS.md`：§9 安全需求（与 §7 交叉核对）、§15 硬性约束清单（逐条核对落地）、§13（MVP 范围——确认不做项未被误实现）
3. `CHANGELOG.md`：**全部条目**（P0a–P10d，复查各阶段承诺是否兑现）
4. `docs/decisions/` **全部 ADR**（复查决策一致性，特别是 ADR-001 依赖基线与 `@types/tree-kill` 勘误——确认无任何文件引用该包）
5. `docs/SESSIONS.md` 全部记录
6. 根 `README.md`（P0a 版本，需重写为完整版）

## 2. 实现文件清单

**允许新建**：

- `apps/server/bin/mizuki-server`（或 `bin/mizuki-server.js`）— 启动脚本（见 §3.3）
- `docs/SECURITY-REVIEW.md` — 安全复查报告（见 §3.4）

**允许修改**：

- `apps/server/package.json`（新增 `bin` 字段与 `@nestjs/swagger` 依赖——记入 ADR-001；ADR-001 中曾注记 `@nestjs/swagger` 属后续阶段依赖，本阶段正是其落地点）
- `apps/server/src/main.ts`（挂载 Swagger，最小改动）
- 根 `README.md`（重写完整版）
- 各阶段既有源码中**仅为 Swagger 装饰器补充**的最小改动（不改行为；若补充成本高，以模块级 `ApiTags` 分组为最小实现并记报告）

**禁止触碰**：任何业务逻辑行为（本阶段零功能变更）；`docs/MASTER-PLAN.md`、`docs/REQUIREMENTS.md`（事实来源只读）。

## 3. 详细规格

### 3.1 Swagger（按公开/管理/系统分组）

- 引入 `@nestjs/swagger`，挂载于 `/api/docs`（或 `/api/v1/docs`，取一者并记报告）。
- **三个分组实例或 tag 分组（逐字对齐 §5 清单）**：
  - **公开**：`/public/**`（articles、collections、albums）
  - **管理**：`/admin/**`（auth、collections、posts、articles、albums、media、backups、process、settings）
  - **系统**：`/system/**`（health、status、detect、init）
- 每个端点至少有方法/路径/摘要；DTO 描述深度取可达成的合理水平（不要求穷尽，缺口列入报告）。

### 3.2 根 README（重写）

项目简介、架构一句话、目录速览、四个命令（install/dev/build/test）、快速上手（init 向导 → 登录 → 面板地址 `localhost:20154`）、开发方式说明（分阶段提示词驱动，指向 `docs/prompts/INDEX.md`）、文档链接（MASTER-PLAN/REQUIREMENTS/STRUCTURE/ADR）。

### 3.3 `bin/mizuki-server` 启动脚本

- shebang（`#!/usr/bin/env node`）+ `package.json` 的 `bin` 字段（`"mizuki-server": "bin/mizuki-server"`）。
- 行为：加载编译产物 `dist/main.js`（或经 `NODE_ENV` 选择）；端口遵循 `MIZUKI_SERVER_PORT`（默认 **20154**）；启动横幅（服务名 + 地址）。
- 验收以「`node apps/server/bin/mizuki-server` 起服务且 health 200」为准。

### 3.4 安全复查报告（对照 MASTER-PLAN §7 逐项）

输出 `docs/SECURITY-REVIEW.md`，逐条核对 §7 安全条款并标注「落实位置 + 证据（测试/代码路径）+ 状态（✅/⚠️/❌）」：

1. 路径监狱（safeJoin + realpath，攻击用例单测）；
2. 上传管线五件套（白名单/魔数/10MB/随机名/sharp 重编码去 EXIF）；
3. 进程安全（白名单、`shell: false`、env 透传限制、tree-kill）；
4. XSS（TipTap JSON 信任源 + sanitize-html，markdown 渲染同过滤）；
5. SQL（Drizzle 全参数化——抽查无字符串拼接）；
6. 认证（argon2id、JWT 双 Token、守卫全覆盖、登录限流与锁定）；
7. 备份与回滚（pre_write 保留 10 份、restore confirm、恢复前备份）；
8. CORS 白名单 + 全局限流；
9. 操作日志脱敏（无密码/token）。

同时交叉核对 REQUIREMENTS §15 硬性约束 16 条。任何 ⚠️/❌ 条目列入疑问清单，重大项停下报告。

### 3.5 全量回归

- `pnpm test && pnpm build && pnpm lint` 全绿（含全部阶段累计用例）。
- 全新链路冒烟（见 §6）。

## 4. 接线说明

1. `main.ts`：Swagger 挂载在 `configureApp` 之后、`listen` 之前（最小改动）。
2. `package.json`：`bin` 字段 + `files`（如需）；`@nestjs/swagger` 依赖版本记 ADR-001。
3. 不改动守卫/管道/过滤器挂载顺序。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1/2 条 = 只建 §2 清单内文件；第 3 条 = 本阶段无新接线（Swagger 为装饰器补充）；第 4 条 = 唯一新增依赖 `@nestjs/swagger`，记 ADR-001。

**本阶段专属禁止**：

- 不得新增功能、不得改变任何既有 API 行为（公开路径已在 P8 定型冻结）。
- 安全复查发现的缺陷**不得静默自行修复**——先报告，人工确认范围后另起改动。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项：

1. **全新环境链路**：全新 clone 后（模拟：干净目录复制 + 删 `node_modules`/`data`）从 `pnpm install` 开始 → `pnpm build` → `node apps/server/bin/mizuki-server` → health 200 → `POST /system/init` → 登录 → 面板可用——**全程无人工改码**（逐步记录命令与结果）。
2. **Swagger 三分组**：`/api/docs` 可见，公开/管理/系统三分组端点齐全（抽查每组 ≥2 个端点）。
3. **安全复查报告**：`docs/SECURITY-REVIEW.md` 覆盖 §3.4 全部 9 条 + REQUIREMENTS §15 16 条，每条有落实位置与证据；⚠️/❌ 条目在疑问清单中说明。
4. **勘误核对**：全仓库检索确认无 `@types/tree-kill` 残留（依赖文件与代码）。
5. **CHANGELOG 完整**：P0a–P11 条目齐全；追加 P11 条目（含安全复查结论摘要）。

## 7. 交付报告要求

1. 文件清单：新建/修改的全部文件路径。
2. 安全复查结论摘要（✅/⚠️/❌ 计数与关键条目）。
3. §6 全新环境链路的逐步记录。
4. 疑问清单：所有 ⚠️ 项、Swagger 描述缺口、MVP 范围确认。
5. `CHANGELOG.md` 追加 P11 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
