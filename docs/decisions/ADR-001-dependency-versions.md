# ADR-001: 依赖版本（安装时实际解析）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-25 |

## 背景

P0a 阶段需锁定 Mizuki-Server 技术栈依赖。规格要求：Node ≥ 22 LTS、pnpm ≥ 9、TypeScript ≥ 5.5；NestJS 系列同 major（≥ 11）；禁用 next/beta/rc 版本。本 ADR 记录 `pnpm install` 时实际解析到的依赖版本，作为后续阶段复现与审计依据。

## 决策

安装时统一采用「NestJS 系列固定 `^11`，其余取最新稳定版（`latest`）」，安装后由本文件固化实际解析版本。

## 实际依赖版本表

> 以下由 P0a 安装后从 `node_modules/.pnpm` 解析固化（2026-08-25）。NestJS 系列锁定 `^11` major，其余 `latest` 解析为当时最新稳定版。

### apps/server — dependencies

| 包 | 解析版本 | 约束写法 |
|---|---|---|
| @nestjs/common | 11.2.1 | ^11.0.0 |
| @nestjs/core | 11.2.1 | ^11.0.0 |
| @nestjs/platform-express | 11.2.1 | ^11.0.0 |
| @nestjs/throttler | 6.5.0 | latest |
| reflect-metadata | 0.2.2 | ^0.2.0 |
| rxjs | 7.8.2 | ^7.8.0 |
| drizzle-orm | 0.45.2 | latest |
| better-sqlite3 | 13.0.3 | latest |
| ts-morph | 28.0.0 | latest |
| zod | 4.4.3 | latest |
| nanoid | 6.0.1 | latest |
| jose | 6.2.10 | latest |
| argon2 | 0.45.1 | latest |
| cross-spawn | 7.0.6 | latest |
| tree-kill | 1.2.2 | latest |
| sharp | 0.35.3 | latest |
| gray-matter | 4.0.3 | latest |
| marked | 18.0.10 | latest |
| sanitize-html | 2.17.7 | latest |
| helmet | 8.3.0 | latest |
| @mizuki/shared | 0.0.0 (workspace:*) | workspace:* |

> P0b 追加（2026-08-26）：`@nestjs/event-emitter` 3.1.0（latest）、`pino` 10.3.1（latest）。

### apps/server — devDependencies

| 包 | 解析版本 | 约束写法 |
|---|---|---|
| @nestjs/cli | 11.0.24 | ^11.0.0 |
| @nestjs/testing | 11.2.1 | ^11.0.0 |
| typescript | 5.9.3 | ^5.5.0 |
| vitest | 4.1.11 | latest |
| supertest | 7.2.2 | latest |
| @types/supertest | 7.2.1 | latest |
| unplugin-swc | 1.5.11 | latest |
| @swc/core | 1.16.1 | latest |
| drizzle-kit | 0.31.10 | latest |
| @types/node | 26.2.0 | latest |
| @types/express | 5.0.6 | latest |
| @types/cross-spawn | 6.0.6 | latest |

> P0b 追加（2026-08-26）：`@types/better-sqlite3` 9.6.0（latest）。P0a 清单未含它，因 P0a 无代码 import better-sqlite3；P0b 起 infra/db 在 strict TS 下 import 该包，类型声明为必需（与既有 @types/express、@types/cross-spawn 同一模式）。

### 根 / packages/shared

| 包 | 解析版本 | 说明 |
|---|---|---|
| typescript | 5.9.3 | 经 workspace 根 tsconfig.base.json 共享 |
| zod | 4.4.3 | 经 @mizuki/shared 复用 |
| @mizuki/shared | 0.0.0 | workspace:*（仅含 build 脚本，无独立运行时依赖） |

> P0b 追加（2026-08-26）：
>
> - 根 devDependencies：`eslint-plugin-boundaries` 7.2.0（latest，P0b §3.6 指定）、`eslint-import-resolver-typescript` 4.4.5（latest）。后者为 boundaries 正常工作所必需：TS 无扩展名 import 必须经它解析到文件路径，否则 §6.4「跨模块 import 被 lint 拒绝」验收无法成立（boundaries 官方 TypeScript 支持指南即此方案）。
> - packages/shared dependencies：`zod` ^4.4.3（events.ts 的 payload schema 需要；与 P0a 备注一致，属既定复用而非新增包）。

> 注：`@nestjs/config`、`@nestjs/jwt`、`@nestjs/swagger`、`class-validator`、`class-transformer` 在 P0a 未引入（属 P6 安全 / 后续阶段依赖），符合「骨架不接线」原则。

## 备选方案

- 全部写死精确版本号：可复现性最佳，但需在安装前人工确定每个包的最新稳定版，成本高且易过时。
- 统一 `latest`：简单，但 NestJS 系列可能跨 major，违背「同 major」约束。→ 最终 NestJS 用 `^11` 约束。

## 后果

- 锁定 NestJS major 为 11，后续阶段实现须兼容该 major。
- 非 Nest 依赖使用 `latest` 解析，长期可通过本 ADR 与 lockfile 追溯当时版本。
