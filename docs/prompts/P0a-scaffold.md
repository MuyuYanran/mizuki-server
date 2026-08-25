# 任务：创建 Mizuki-Server 仓库骨架（阶段 P0a）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是第 1 次会话，目标只有一个：**创建仓库骨架，不实现任何业务逻辑**。后续阶段的提示词会由人工陆续注入，本阶段生成的所有 stub 文件头注释中标注了它属于哪个阶段。

工作目录规则：当前工作目录即仓库根目录，结构第一层直接落在当前目录。**若当前目录非空，先列出冲突文件并停止，不要覆盖任何已存在文件。**

## 1. 项目背景（只需了解，无需实现）

Mizuki-Server 是为 Astro 静态博客主题 Mizuki 开发的本地优先管理服务端：管理文章/日记/友链/项目/时间线/技能/设备/相册等内容（数据主要存于 Mizuki 项目内的 TS 数据文件与 Markdown 文件），接管站点配置，驱动 npm 构建预览，并提供公开 REST API。完整规划将存放于 `docs/MASTER-PLAN.md`（本任务只创建其占位文件）。

## 2. 技术栈（已锁定，不得更换、不得增删）

- Node.js ≥ 22 LTS，pnpm ≥ 9，TypeScript ≥ 5.5（`strict: true`）
- pnpm monorepo：`apps/server`、`apps/web`（后期）、`packages/shared`
- 后端：NestJS ≥ 11 全家桶同 major（Express 适配器）
- 数据库：Drizzle ORM + better-sqlite3（文件库 `apps/server/data/mizuki.db`）
- TS 数据文件解析：ts-morph；校验：zod；认证：jose + argon2
- 子进程：cross-spawn + tree-kill；图片：sharp
- Markdown：gray-matter + marked + sanitize-html
- 测试：Vitest + supertest + unplugin-swc（用于装饰器元数据）
- 默认端口 **20154**，全局 API 前缀 **`/api/v1`**

## 3. 目标目录结构（逐字执行，`#` 后为给你的注释，不是文件名的一部分）

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
│   ├── MASTER-PLAN.md                  # 占位文件（内容见 4.5）
│   ├── STRUCTURE.md                    # 你生成：目录说明 + 模块→阶段映射
│   ├── decisions/
│   │   ├── ADR-000-template.md
│   │   └── ADR-001-dependency-versions.md   # 安装完成后填实际版本
│   └── prompts/
│       └── README.md                   # 说明：各阶段提示词存档于此
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   ├── vitest.config.ts
│   │   ├── drizzle.config.ts           # [P0b] stub
│   │   ├── data/
│   │   │   ├── README.md               # 运行时产物说明
│   │   │   └── backups/.gitkeep
│   │   ├── test/
│   │   │   ├── app.e2e-spec.ts         # 实现：冒烟测试
│   │   │   └── fixtures/
│   │   │       └── mizuki/README.md    # [P3] 假 Mizuki 项目占位
│   │   └── src/
│   │       ├── main.ts                 # 实现
│   │       ├── app.setup.ts            # 实现：统一应用配置入口
│   │       ├── app.module.ts           # 实现：注册全部模块
│   │       ├── common/
│   │       │   ├── security/safe-join.ts                     # [P1] stub
│   │       │   ├── pipes/zod-validation.pipe.ts              # [P1] stub
│   │       │   ├── guards/jwt-auth.guard.ts                  # [P6] stub
│   │       │   ├── decorators/public.decorator.ts            # [P6] stub
│   │       │   ├── interceptors/operation-log.interceptor.ts # [P6] stub
│   │       │   └── filters/all-exceptions.filter.ts          # [P0b] stub
│   │       ├── config/app-config.ts                          # [P0b] stub
│   │       ├── infra/
│   │       │   ├── db/schema.ts                              # [P0b] stub
│   │       │   ├── db/migrate.ts                             # [P0b] stub
│   │       │   └── backup/backup.service.ts                  # [P2] stub
│   │       └── modules/
│   │           ├── system/
│   │           │   ├── system.module.ts                 # 实现
│   │           │   ├── system.controller.ts             # 实现：health
│   │           │   └── mizuki-detector.service.ts       # [P6] stub
│   │           ├── auth/          # auth.module.ts / auth.controller.ts / auth.service.ts          # [P6] stub
│   │           ├── data-files/    # module + data-file.service / evaluator / serializer /
│   │           │                  # syntax-check / file-lock / value-cache（共 7 文件）# [P3] stub
│   │           ├── collections/   # module + registry / collections.controller / collections.service # [P4] stub
│   │           ├── posts/         # module + posts.controller / posts.service                     # [P5] stub
│   │           ├── articles/      # module + articles.controller / articles.service              # [P8] stub
│   │           ├── albums/        # module + albums.controller / albums.service                   # [P7] stub
│   │           ├── media/         # module + media.controller / media.service                     # [P7] stub
│   │           ├── process/       # module + process.controller / process-manager.service         # [P9] stub
│   │           ├── backup/        # module + backup.controller                                     # [P2] stub
│   │           └── settings/      # module + settings.controller / settings.service                # [P8] stub
│   └── web/
│       ├── package.json           # 最小占位
│       └── README.md              # 说明 P10 技术栈
└── packages/
    └── shared/
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts           # 占位导出

```

**文件数量必须与上树完全一致，不多、不少。** `node_modules/`、`dist/` 等构建产物除外。

## 4. 关键文件规格

### 4.1 需要真正实现的文件（仅此 6 个，代码如下，可微调但不改变行为）

`apps/server/src/main.ts`：

```ts
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = Number(process.env.MIZUKI_SERVER_PORT ?? 20154);
  await app.listen(port);
  new Logger('Bootstrap').log(`Mizuki-Server: http://localhost:${port}`);
}

void bootstrap();

```

`apps/server/src/app.setup.ts`：

```ts
import { INestApplication } from '@nestjs/common';

/**
 * [阶段 P0a] 统一应用配置入口
 * [职责] main.ts 与测试共用，保证生产行为与测试行为一致
 * [状态] ACTIVE
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  // P1 将在此追加 helmet / CORS / 全局管道 / 限流
}

```

`apps/server/src/app.module.ts`：imports 依序为 SystemModule、AuthModule、DataFilesModule、CollectionsModule、PostsModule、ArticlesModule、AlbumsModule、MediaModule、ProcessModule、BackupModule、SettingsModule，每个 import 上方一行注释标注其阶段（P0a/P6/P3/P4/P5/P8/P7/P7/P9/P2/P8）。

`apps/server/src/modules/system/system.controller.ts`：

```ts
import { Controller, Get } from '@nestjs/common';

/**
 * [阶段 P0a] System 控制器
 * [职责] 健康检查（P6 起本路由将加 @Public() 豁免认证）
 * [状态] ACTIVE
 */
@Controller('system')
export class SystemController {
  @Get('health')
  getHealth(): { status: string; service: string; uptime: number } {
    return { status: 'ok', service: 'mizuki-server', uptime: process.uptime() };
  }
}

```

`apps/server/test/app.e2e-spec.ts`：

```ts
import 'reflect-metadata';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('P0a 骨架冒烟测试', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /api/v1/system/health → 200 { status: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

```

`apps/server/vitest.config.ts`（NestJS 官方 Vitest 方案）：

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.spec.ts'], environment: 'node' },
  plugins: [swc.vite()],
});

```

### 4.2 stub 文件规范

每个 stub 文件 = 规范头注释 + 一个空的具名导出（与文件同名的 class，或配置文件仅留注释）。**stub 一律不注册进任何 @Module 的 providers/controllers**，且**禁止 import ts-morph/drizzle 等业务依赖**（保持零成本编译）。头注释格式：

```ts
/**
 * [阶段 P3] data-files / AST 求值器
 * [职责] 将 ts-morph AST 初始化表达式求值为 JS 值，仅接受自包含字面量
 * [状态] SKELETON — P0a 生成，待 P3 提示词实现
 */

```

各 stub 的阶段与职责一句话（写入头注释）：

| 文件 | 阶段 | 职责 |
|---|---|---|
| common/security/safe-join.ts | P1 | 路径监狱：resolve + 前缀校验 + realpath，全项目唯一合法路径入口 |
| common/pipes/zod-validation.pipe.ts | P1 | 基于 zod schema 的请求校验管道 |
| common/guards/jwt-auth.guard.ts | P6 | 全局 JWT 守卫，识别 @Public() 豁免 |
| common/decorators/public.decorator.ts | P6 | @Public() 公开路由标记 |
| common/interceptors/operation-log.interceptor.ts | P6 | 管理操作审计日志 |
| common/filters/all-exceptions.filter.ts | P0b | 统一错误响应 {code, message, detail} |
| config/app-config.ts | P0b | 读取并 zod 校验 data/config.json |
| infra/db/schema.ts | P0b | Drizzle 全部 11 张表定义（见 MASTER-PLAN 第 3 节） |
| infra/db/migrate.ts | P0b | 启动时执行迁移 |
| infra/backup/backup.service.ts | P2 | 唯一备份实现：pre_write/手动/DB 备份 + manifest + 恢复 |
| modules/system/mizuki-detector.service.ts | P6 | 检测目录是否为 Mizuki 项目（astro 依赖、astro.config、src/data、src/content/posts 四项检查） |
| modules/auth/* | P6 | 登录（argon2）、JWT 双 Token、me |
| modules/data-files/* | P3 | ts-morph 引擎：门面 service / AST 求值 / 序列化 / 语法校验 / 文件锁 / mtime 读缓存 |
| modules/collections/* | P4 | 六类内容注册表 + 动态 CRUD 控制器 |
| modules/posts/* | P5 | Markdown 文章 gray-matter 读写与文件管理 |
| modules/articles/* | P8 | 富文本文章 + 统一文章索引 |
| modules/albums/* | P7 | 相册 CRUD 与 info.json |
| modules/media/* | P7 | 上传管线（魔数嗅探+sharp 重编码）与媒体索引 |
| modules/process/* | P9 | 白名单子进程任务管理 + SSE 日志推送 |
| modules/backup/* | P2 | 备份 REST API（调用 infra/backup） |
| modules/settings/* | P8 | 站点设置与 Mizuki config 接管 |

### 4.3 配置文件

- 根 `package.json`：`private: true`、`engines: { node: ">=22" }`，scripts：`dev`→`pnpm --filter @mizuki/server dev`、`build`→`pnpm -r build`、`test`→`pnpm --filter @mizuki/server test`、`lint`→`eslint .`。devDependencies：`eslint`、`typescript-eslint`。
- `pnpm-workspace.yaml`：`packages: ['apps/*', 'packages/*']`
- `tsconfig.base.json`：`strict`、`noUncheckedIndexedAccess`、`target: ES2022`、`module: commonjs`、`moduleResolution: node`、`esModuleInterop`、`skipLibCheck`、`sourceMap`、`forceConsistentCasingInFileNames`。
- `apps/server/tsconfig.json`：extends base，追加 `experimentalDecorators`、`emitDecoratorMetadata`、`outDir: ./dist`、`include: ["src"]`、`exclude: ["node_modules", "test", "dist"]`；`tsconfig.build.json`：extends 之并同样 exclude。
- `nest-cli.json`：sourceRoot `src`，`deleteOutDir: true`。
- `eslint.config.mjs`（flat config）：typescript-eslint recommended，ignore `**/dist/**`、`**/node_modules/**`、`**/data/**`、`**/coverage/**`。
- `.gitignore`：
  ```
  node_modules/
  dist/
  coverage/
  .env
  *.log
  .DS_Store
  apps/server/data/*
  !apps/server/data/README.md
  !apps/server/data/backups/
  !apps/server/data/backups/.gitkeep
  
  ```
- `.env.example`：`MIZUKI_SERVER_PORT=20154` 与 `NODE_ENV=development`，附一行说明。
- `apps/server/data/README.md`：说明运行时产物——`config.json`（P0b 起）、`mizuki.db`（P0b 起）、`backups/`（P2 起，含 pre_write 快照）。
- `packages/shared`：package.json 名 `@mizuki/shared`、`main: dist/index.js`、build 脚本 `tsc -p tsconfig.json`；tsconfig extends base 并开 `declaration`；`src/index.ts` 为带规范头注释的占位导出。
- `apps/web`：仅最小 package.json（名 `@mizuki/web`、private）+ README 说明 P10 技术栈（Vue 3 + Element Plus + TipTap + CodeMirror，经 /api/v1 与 server 通信）。

### 4.4 依赖清单（写入 `apps/server/package.json`，版本取安装时最新稳定版，禁用 next/beta/rc；NestJS 系列必须同 major）

**dependencies**：`@mizuki/shared`（`workspace:*`）、`@nestjs/common`、`@nestjs/core`、`@nestjs/platform-express`、`@nestjs/throttler`、`reflect-metadata`、`rxjs`、`drizzle-orm`、`better-sqlite3`、`ts-morph`、`zod`、`nanoid`、`jose`、`argon2`、`cross-spawn`、`tree-kill`、`sharp`、`gray-matter`、`marked`、`sanitize-html`、`helmet`

**devDependencies**：`@nestjs/cli`、`@nestjs/testing`、`typescript`、`vitest`、`supertest`、`@types/supertest`、`unplugin-swc`、`@swc/core`、`drizzle-kit`、`@types/node`、`@types/express`、`@types/cross-spawn`

**scripts**：`dev: nest start --watch`、`build: nest build`、`test: vitest run`、`lint: eslint .`、`db:generate: drizzle-kit generate`、`db:migrate: drizzle-kit migrate`

### 4.5 文档文件

- `docs/MASTER-PLAN.md`：占位，内容为「# Mizuki-Server 主规划书（占位）」+ 说明“请将《Mizuki-Server 技术规划书》全文粘贴至此处；骨架文件头注释引用了规划中的阶段编号 P0a–P11”。
- `docs/STRUCTURE.md`：你生成——完整目录树、每个目录一句话职责、模块→阶段映射表。
- `docs/decisions/ADR-000-template.md`：字段为 状态/日期/背景/决策/备选方案/后果。
- `docs/decisions/ADR-001-dependency-versions.md`：安装完成后填入实际解析到的依赖版本表。
- `docs/prompts/README.md`：说明此目录存档各阶段提示词，命名如 `P0a-scaffold.md`。
- 根 `README.md`：项目一句话简介、目录速览、四个命令、开发方式说明（分阶段 AI 提示词驱动，见 docs/prompts/）、链接 MASTER-PLAN。
- 根 `CHANGELOG.md`：初始条目「P0a：仓库骨架与可启动 NestJS 服务」。

## 5. 禁止事项

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

## 6. 验收标准（完成后逐项执行自检）

1. `pnpm install` 成功
2. `pnpm build` 成功（strict 编译通过）
3. `pnpm test` 通过（至少 1 条 e2e：health 返回 200 与 `status: "ok"`）
4. `pnpm lint` 通过
5. `pnpm dev` 启动后，访问 `http://localhost:20154/api/v1/system/health` 返回 200 JSON
6. 生成的文件树与第 3 节完全一致
7. 抽查任意 3 个 stub 文件，头注释符合第 4.2 节规范

## 7. 交付报告

完成后输出：(1) 实际生成的文件树；(2) 关键依赖的实际版本（同步写入 ADR-001）；(3) 第 6 节验收命令的逐条执行结果；(4) 偏差清单——理想状态为空，任何偏差必须显式列出原因。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。