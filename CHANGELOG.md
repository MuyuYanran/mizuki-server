# 变更日志

## P0b — 配置加载、数据库 11 表与统一异常

- `config/app-config.ts`：`data/config.json` zod 校验加载（非法即启动失败、错误含字段路径；缺省返回默认值），进程内单例 + pino 日志
- `infra/db/schema.ts`：Drizzle 定义全部 11 张表（逐字对齐 MASTER-PLAN §3）；`drizzle/0000_*.sql` 首个迁移由 drizzle-kit 生成
- `infra/db/migrate.ts` + `db.module.ts`：`runMigrations()` 幂等迁移（migrator 记账表处理见 ADR-002）；`@Global` DbModule 提供 better-sqlite3 / drizzle 双实例，启动自动迁移
- `common/filters/all-exceptions.filter.ts`：全局统一异常格式 `{ code, message, detail }`，未知异常对外固定「内部服务器错误」，堆栈仅入日志
- `packages/shared/src/events.ts`：事件目录骨架——6 个事件常量 + 各 payload zod schema（MASTER-PLAN §4.4 逐字）
- `common/logger.ts`：pino 共享日志实例（`MIZUKI_LOG_LEVEL` 控制级别）
- 根 `eslint.config.mjs`：eslint-plugin-boundaries 四层依赖规则（L0/L1/L2/L3），L2 互导禁止、L3 互通允许，error 级；配 `eslint-import-resolver-typescript` 解析 TS import
- 接线：`app.setup.ts` 挂全局过滤器；`app.module.ts` 注册 `EventEmitterModule.forRoot()` 与 DbModule
- 新增依赖：`@nestjs/event-emitter` 3.1.0、`pino` 10.3.1、`@types/better-sqlite3` 9.6.0、`eslint-plugin-boundaries` 7.2.0、`eslint-import-resolver-typescript` 4.4.5、shared 声明 `zod`（见 ADR-001 追加记录、ADR-002）
- 测试：5 个文件 17 用例全绿（迁移建表/幂等、config 三态、过滤器双单测、事件目录、health 回归 + 启动迁移断言）；分层拦截人工验证两轮（违规 import → lint error → 移除 → 恢复绿）

## P0a — 仓库骨架与可启动 NestJS 服务

- 初始化 pnpm monorepo（apps/server、apps/web、packages/shared）
- 建立 NestJS 服务端骨架，默认端口 `20154`，全局 API 前缀 `/api/v1`
- 实现 health 健康检查端点（`GET /api/v1/system/health`）
- 建立 stub 文件体系，按阶段 P0a–P11 标注（见各文件头注释）
- 文档占位：MASTER-PLAN / STRUCTURE / ADR / prompts 归档目录
