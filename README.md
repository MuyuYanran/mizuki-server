# Mizuki-Server

为 [Mizuki](https://github.com)（Astro 静态博客主题）配套的**本地优先管理服务端**：接管站点配置、管理文章/日记/友链/项目/时间线/技能/设备/相册等内容，驱动 npm 构建预览，并提供公开 REST API。

## 目录速览

```
.
├── apps/
│   ├── server/   # NestJS 后端服务（主实现，默认端口 20154）
│   └── web/      # 管理前端（P10 阶段，Vue 3 + Element Plus）
├── packages/
│   └── shared/   # 前后端共享类型/常量
├── docs/         # 主规划书、结构说明、ADR、阶段提示词存档
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs
└── package.json
```

## 常用命令

```bash
pnpm install      # 安装全部依赖
pnpm dev          # 启动后端开发服务（端口 20154）
pnpm build        # 构建全部工作区
pnpm test         # 运行后端测试（含 P0a 骨架冒烟测试）
pnpm lint         # 代码风格检查
```

## 开发方式

本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段（P0a、P0b、P1、P2……），不越界实现业务逻辑。各阶段的提示词存档于 [`docs/prompts/`](./docs/prompts/)，主规划书见 [`docs/MASTER-PLAN.md`](./docs/MASTER-PLAN.md)。

> 本仓库当前处于 **P0a 阶段**：仅包含可启动的仓库骨架与 health 端点，所有业务模块均为 stub。
