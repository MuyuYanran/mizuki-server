# 目录结构与阶段映射

> 本文档由 P0a 阶段生成，描述仓库骨架的目录职责与「模块 → 实现阶段」映射。后续阶段仅填充 stub，不改变本树结构（除非对应阶段提示词另有说明）。

## 1. 目录树

```
.
├── .editorconfig
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── README.md
├── eslint.config.mjs
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   ├── MASTER-PLAN.md                  # 主规划书占位
│   ├── STRUCTURE.md                    # 本文档
│   ├── decisions/
│   │   ├── ADR-000-template.md
│   │   └── ADR-001-dependency-versions.md
│   └── prompts/
│       └── README.md
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   ├── vitest.config.ts
│   │   ├── drizzle.config.ts
│   │   ├── data/
│   │   │   ├── README.md
│   │   │   └── backups/.gitkeep
│   │   ├── test/
│   │   │   ├── app.e2e-spec.ts
│   │   │   └── fixtures/mizuki/README.md
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.setup.ts
│   │       ├── app.module.ts
│   │       ├── common/
│   │       │   ├── security/safe-join.ts
│   │       │   ├── pipes/zod-validation.pipe.ts
│   │       │   ├── guards/jwt-auth.guard.ts
│   │       │   ├── decorators/public.decorator.ts
│   │       │   ├── interceptors/operation-log.interceptor.ts
│   │       │   └── filters/all-exceptions.filter.ts
│   │       ├── config/app-config.ts
│   │       ├── infra/
│   │       │   ├── db/schema.ts
│   │       │   ├── db/migrate.ts
│   │       │   └── backup/backup.service.ts
│   │       └── modules/
│   │           ├── system/{system.module.ts,system.controller.ts,mizuki-detector.service.ts}
│   │           ├── auth/{auth.module.ts,auth.controller.ts,auth.service.ts}
│   │           ├── data-files/{data-files.module.ts,data-file.service.ts,evaluator.ts,serializer.ts,syntax-check.ts,file-lock.ts,value-cache.ts}
│   │           ├── collections/{collections.module.ts,collections.controller.ts,collections.service.ts}
│   │           ├── posts/{posts.module.ts,posts.controller.ts,posts.service.ts}
│   │           ├── articles/{articles.module.ts,articles.controller.ts,articles.service.ts}
│   │           ├── albums/{albums.module.ts,albums.controller.ts,albums.service.ts}
│   │           ├── media/{media.module.ts,media.controller.ts,media.service.ts}
│   │           ├── process/{process.module.ts,process.controller.ts,process-manager.service.ts}
│   │           ├── backup/{backup.module.ts,backup.controller.ts}
│   │           └── settings/{settings.module.ts,settings.controller.ts,settings.service.ts}
│   └── web/
│       ├── package.json
│       └── README.md
└── packages/
    └── shared/
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts
```

## 2. 目录职责（一句话）

| 路径 | 职责 |
|---|---|
| 仓库根 | 工作区装配：pnpm workspace、统一 tsconfig/base、ESLint、脚本入口 |
| `docs/` | 规划与决策文档；`prompts/` 存档各阶段提示词 |
| `apps/server` | NestJS 后端主实现；`src/` 为源码根，`data/` 为运行时产物，`test/` 为 e2e |
| `apps/server/src/common` | 跨切面能力（安全/校验/守卫/装饰器/拦截器/过滤器）的 stub 占位 |
| `apps/server/src/config` | 运行时配置读取（zod 校验）stub |
| `apps/server/src/infra` | 基础设施：数据库（Drizzle schema/migrate）、备份服务 stub |
| `apps/server/src/modules` | 业务模块；当前除 `system` 外均为 stub，按阶段逐步实现 |
| `apps/web` | 管理前端（P10 阶段技术栈）最小占位 |
| `packages/shared` | 前后端共享类型与常量 |

## 3. 模块 → 阶段映射

`app.module.ts` 按以下顺序注册模块，每个 import 上方标注其实现阶段：

| 模块 | 阶段 | 职责 |
|---|---|---|
| SystemModule | P0a | 健康检查；Mizuki 项目探测（P6） |
| AuthModule | P6 | 登录（argon2）、JWT 双 Token、me |
| DataFilesModule | P3 | ts-morph 引擎：门面 service / AST 求值 / 序列化 / 语法校验 / 文件锁 / mtime 读缓存 |
| CollectionsModule | P4 | 六类内容注册表 + 动态 CRUD 控制器 |
| PostsModule | P5 | Markdown 文章 gray-matter 读写与文件管理 |
| ArticlesModule | P8 | 富文本文章 + 统一文章索引 |
| AlbumsModule | P7 | 相册 CRUD 与 info.json |
| MediaModule | P7 | 上传管线（魔数嗅探 + sharp 重编码）与媒体索引 |
| ProcessModule | P9 | 白名单子进程任务管理 + SSE 日志推送 |
| BackupModule | P2 | 备份 REST API（调用 infra/backup） |
| SettingsModule | P8 | 站点设置与 Mizuki config 接管 |

### 跨切面 stub 阶段标注

| 文件 | 阶段 |
|---|---|
| common/security/safe-join.ts | P1 |
| common/pipes/zod-validation.pipe.ts | P1 |
| common/guards/jwt-auth.guard.ts | P6 |
| common/decorators/public.decorator.ts | P6 |
| common/interceptors/operation-log.interceptor.ts | P6 |
| common/filters/all-exceptions.filter.ts | P0b |
| config/app-config.ts | P0b |
| infra/db/schema.ts | P0b |
| infra/db/migrate.ts | P0b |
| infra/backup/backup.service.ts | P2 |
| modules/system/mizuki-detector.service.ts | P6 |
