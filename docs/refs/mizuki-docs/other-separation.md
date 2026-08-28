> 快照说明：抓取自 https://docs.mizuki.mysqil.com/Other/separation/ ，快照日期 2026-08-28，文档日期 2025-11-20。仅供 B4 审计引用。

# 内容分离

本指南详细说明如何在 Mizuki 中使用内容分离功能，包括基础配置、私有仓库、CI/CD 部署等所有场景。

## 快速开始

### 新手推荐：本地模式（最简单）

**不需要任何配置**，直接开始使用。内容存放在 `src/content/` 和 `public/images/` 目录，与代码一起管理。

### 进阶：启用内容分离

如果需要将内容独立管理（多人协作、私有内容、独立版本控制），按以下步骤配置：

```
# 1. 创建 .env 文件
cp .env.example .env
# 2. 编辑 .env，启用内容分离
ENABLE_CONTENT_SYNC=true
CONTENT_REPO_URL=https://github.com/your-username/Mizuki-Content.git
# 3. 同步内容
pnpm run sync-content
# 4. 启动开发
pnpm dev
```

## ENABLE_CONTENT_SYNC 控制开关

| 值 | 说明 | 适用场景 |
|---|---|---|
| `false` 或未设置 | **禁用内容分离**（默认） | 新手、个人博客、内容较少 |
| `true` | **启用内容分离** | 团队协作、私有内容、大量文章 |

## 环境变量说明

```
# 是否启用内容分离功能
ENABLE_CONTENT_SYNC=false
# 内容仓库地址（支持 HTTPS 和 SSH）
CONTENT_REPO_URL=https://github.com/your-username/Mizuki-Content.git
# 内容目录路径（默认 ./content 一般无需改动）
CONTENT_DIR=./content
```

私有仓库支持：SSH 密钥（推荐）或 HTTPS + Personal Access Token。

## 自动构建触发（内容更新时）

启用内容分离后，默认只有代码仓库更新会触发部署，内容仓库更新**不会**自动触发。推荐使用 Repository Dispatch 解决（见 other-auto.md）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm run init-content` | 运行交互式初始化向导 |
| `pnpm run sync-content` | 手动同步内容仓库 |
| `pnpm run check-env` | 检查环境变量配置 |
| `pnpm dev` | 启动开发服务器（自动同步） |
| `pnpm build` | 构建项目（自动同步） |

当 `ENABLE_CONTENT_SYNC=true` 时，`pnpm dev` 和 `pnpm build` 会自动同步内容；同步失败不会中断开发/构建，会显示警告并继续（回退到本地内容）。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
