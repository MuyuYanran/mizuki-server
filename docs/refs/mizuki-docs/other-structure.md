> 快照说明：抓取自 https://docs.mizuki.mysqil.com/Other/structure/ ，快照日期 2026-08-28，文档日期 2025-11-20。仅供 B4 审计引用。

# 结构说明（内容仓库）

本文档说明如何创建和组织 Mizuki 博客的内容仓库（Mizuki-Content）。

## 推荐的目录结构

```
Mizuki-Content/
├── posts/              # 博客文章
│   ├── post-1.md
│   ├── post-2.md
│   └── my-article/
│       ├── index.md
│       └── cover.jpg
├── spec/               # 特殊页面
│   └── about.md
├── data/               # 数据文件
│   ├── anime.ts
│   ├── projects.ts
│   ├── skills.ts
│   ├── timeline.ts
│   ├── friends.ts
│   ├── diary.ts
│   └── devices.ts
├── images/             # 图片资源
│   ├── albums/         # 相册图片
│   ├── diary/          # 日记图片
│   └── posts/          # 文章图片
└── README.md
```

## 连接到 Mizuki 代码仓库

- 方式一：Git Submodule（推荐）——`git submodule add <repo> content`，`.env` 配置 `CONTENT_REPO_URL=...`、`USE_SUBMODULE=true`。
- 方式二：独立仓库模式——`.env` 配置 `CONTENT_REPO_URL`、`CONTENT_DIR=./content`、`USE_SUBMODULE=false`，运行 `pnpm run sync-content`。

## 内容编写指南

### 文章前言（Frontmatter）

每篇文章都应该包含以下前言：

```yaml
---
title: 文章标题
published: 2024-01-01
description: 文章描述
image: ./cover.jpg
tags: [标签1, 标签2]
category: 分类
draft: false
pinned: false
lang: zh-CN
---
```

### 目录组织

- **单文件文章**：直接在 `posts/` 目录下创建 `.md` 文件
- **包含图片的文章**：创建文件夹，将 `index.md` 和图片放在一起

```
posts/
├── simple-post.md          # 简单文章
└── complex-post/           # 复杂文章
    ├── index.md            # 文章内容
    ├── cover.jpg           # 封面图
    └── diagram.png         # 文章中的图片
```

## 数据文件说明

- `anime.ts`：番剧数据配置，包含你观看的动画列表。
- `projects.ts`：项目展示数据。
- `skills.ts`：技能数据。
- `timeline.ts`：时间线数据。

## 图片管理

### 目录说明

- `images/albums/`：相册页面的图片
- `images/diary/`：日记页面的图片
- `images/posts/`：文章中引用的公共图片

### 图片引用

```md
<!-- 相对路径 (推荐) -->
![描述](./image.jpg)

<!-- 公共图片目录 -->
![描述](/images/posts/image.jpg)
```

## 注意事项

1. **不要**在内容仓库中包含代码文件
2. **保持**目录结构与主仓库一致
3. **定期**备份重要内容
4. **使用** Git LFS 管理大型图片文件（可选）

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
