# Mizuki-Server

为 [Mizuki](https://github.com)（Astro 静态博客主题）配套的**本地优先管理服务端**：接管站点配置与内容（文章/日记/友链/项目/时间线/技能/设备/相册/媒体），驱动 npm 构建预览，并提供带认证的管理 API 与限流的公开 REST API，内置同源管理面板（Vue 3）。

**架构一句话**：pnpm monorepo —— `apps/server`（NestJS 11 + Drizzle/SQLite，API 与面板同源 20154）+ `apps/web`（Vue 3 + Element Plus + TipTap/CodeMirror 管理面板）+ `packages/shared`（前后端共享 zod schema 与事件契约）；六类集合内容「文件即数据库」（ts-morph AST 改写），文章索引/富文本/用户/日志入 SQLite（11 张表）。

## 目录速览

```
.
├── apps/
│   ├── server/          # NestJS 后端（API + 静态面板托管，默认端口 20154）
│   │   ├── bin/mizuki-server   # 生产启动脚本（加载 dist/main.js）
│   │   └── test/               # 单元 + e2e 测试（229 用例）
│   └── web/             # 管理面板（Vue 3 + Element Plus）
├── packages/
│   └── shared/          # 前后端共享 zod schema / 事件契约
├── docs/
│   ├── MASTER-PLAN.md   # 主规划书（架构 / API 清单 / 安全要点）
│   ├── REQUIREMENTS.md  # 需求规格（字段级数据规格 / 硬性约束）
│   ├── STRUCTURE.md     # 目录结构说明
│   ├── SECURITY-REVIEW.md  # 安全复查报告（P11）
│   ├── decisions/       # ADR 决策记录（ADR-001 ~ 009）
│   └── prompts/         # 分阶段提示词存档（开发方式入口）
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs    # 含 boundaries 分层规则（模块互 import 拦截）
└── package.json
```

## 常用命令

```bash
pnpm install      # 安装全部依赖（Node ≥ 22 LTS / pnpm ≥ 9）
pnpm dev          # 启动后端开发服务（端口 20154，watch 模式）
pnpm build        # 构建全部工作区（server dist + web dist + shared）
pnpm test         # 后端全量测试（单元 + e2e，229 用例）
pnpm lint         # 代码风格 + 分层边界检查
```

## 快速上手

### 生产形态（单命令，面板与 API 同源）

```bash
pnpm install && pnpm build
node apps/server/bin/mizuki-server          # 面板 / API：http://localhost:20154
```

- 打开 `http://localhost:20154` 进入面板；首次运行走**初始化向导**（检测 Mizuki 目录 → 设置管理员账号密码，仅可执行一次）。
- 登录后即可管理内容、上传媒体、创建/恢复备份、启停构建任务；Swagger 文档见 `http://localhost:20154/api/v1/docs`（公开/管理/系统三分组）。
- 端口可用 `MIZUKI_SERVER_PORT` 覆盖；web 产物目录可用 `MIZUKI_WEB_DIST` 覆盖（默认 `apps/web/dist`，不存在时后端自动跳过静态托管，仅提供 API）。

### 开发形态（前后端分离热更新）

```bash
pnpm dev                                        # 终端 1：后端 20154
pnpm --filter @mizuki/web dev                   # 终端 2：面板 20155（/api 代理到 20154）
```

## API 概览

全局前缀 `/api/v1`；管理接口（`/admin/**`、`/system/status`）需 JWT 双 Token（access 15m + refresh 7d 轮换），公开接口（`/public/**`）免认证、全局限流 60 次/分（登录独立 5 次/分）。完整清单见 MASTER-PLAN §5 与 Swagger UI（`/api/v1/docs`）。

## 开发方式

本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段（P0a → P11），规格存档于 [`docs/prompts/`](./docs/prompts/)（入口 [`INDEX.md`](./docs/prompts/INDEX.md)），全部阶段实施记录见 [`docs/SESSIONS.md`](./docs/SESSIONS.md) 与 [`CHANGELOG.md`](./CHANGELOG.md)。

## 文档索引

- [MASTER-PLAN.md](./docs/MASTER-PLAN.md) — 主规划书：架构决策、API 清单、安全要点、编码守则
- [REQUIREMENTS.md](./docs/REQUIREMENTS.md) — 需求规格：字段级数据规格、安全需求、硬性约束
- [STRUCTURE.md](./docs/STRUCTURE.md) — 目录结构说明
- [SECURITY-REVIEW.md](./docs/SECURITY-REVIEW.md) — 安全复查报告（9 条安全条款 + 16 条硬性约束逐项核对）
- [docs/decisions/](./docs/decisions/) — ADR 决策记录（依赖基线、SQLite 记账、备份范围、JWT 管理、静态面板托管等）
- [CHANGELOG.md](./CHANGELOG.md) — 各阶段交付记录
