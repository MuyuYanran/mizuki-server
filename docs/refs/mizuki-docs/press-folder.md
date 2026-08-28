> 快照说明：抓取自 https://docs.mizuki.mysqil.com/press/folder/ ，快照日期 2026-08-28，文档日期 2025-09-01。仅供 B4 审计引用。

# 文件夹方案（编写文章·推荐）

这是在 Mizuki 博客系统中创建文章的**推荐方法**。适合复杂的文章，特别是包含大量图片或其他资源的文章。**特别适合那些希望在不依赖外部图床的情况下，优雅地管理和存储图片资源的用户。**

## 创建文章

1. 在 `src/content/posts` 目录下创建一个新的**文件夹**，文件夹名应该具有描述性，例如 `my-complex-post`。
2. 在新创建的文件夹中创建一个名为 `index.md` 的文件。
3. 在 `index.md` 文件中添加 frontmatter，**必须包含 `title` 和 `description` 字段**：

```yaml
---
title: Markdown Tutorial
published: 2025-01-20
pinned: true
description: A simple example of a Markdown blog post.
tags: [Markdown, Blogging]
category: Examples
licenseName: "Unlicensed"
author: emn178
sourceLink: "https://github.com/emn178/markdown"
draft: false
date: 2025-01-20
image: "./cover.png"
pubDate: 2025-01-20
permalink: "encrypted-example"
---
```

## Frontmatter 字段详解

### 必需字段

- `title`：文章标题（必需）
- `description`：文章描述（必需）

### 发布相关

- `published`：文章发布日期，格式为 YYYY-MM-DD
- `pubDate`：文章发布日期（与 published 类似）
- `date`：文章创建日期
- `draft`：是否为草稿，true 表示草稿，false 表示正式发布
- `permalink`：固定链接

### 内容分类

- `tags`：文章标签数组
- `category`：文章分类
- `pinned`：是否置顶

### 作者信息

- `author`：文章作者姓名
- `licenseName`：许可证名称，如 "MIT"、"CC BY 4.0" 等
- `sourceLink`：文章源链接

### 图片设置

- `image`：文章封面图片。**图片路径最佳实践：在子文件夹方法中，推荐使用相对路径引用图片 `image: './cover.jpg'`。**

## 管理图片和其他资源（无需图床方案）

**这是使用 Mizuki 最优雅的图片管理方案，完全无需依赖外部图床服务！**

使用这种方法，你可以将文章相关的所有资源都放在同一个文件夹中，实现真正的"自托管"图片存储：

```
src/content/posts/my-complex-post/
├── index.md
├── image1.png
├── image2.jpg
└── data.json
```

### 图片引用方式

在文章中引用图片时，可以直接使用相对路径：

```md
![图片描述](image1.png)
```

**重要提示：** 像这样直接填写文件的名字，这样才能让 RSS 正常构建图片的路径，同时确保图片与文章一同打包部署。

### 优势对比

| 方案 | 文件夹方案 | 图床方案 |
|---|---|---|
| 控制权 | 完全自主控制 | 依赖第三方服务 |
| 稳定性 | 100%稳定 | 可能宕机或失效 |
| 隐私性 | 数据完全私有 | 部分服务会扫描图片 |
| 加载速度 | 与站点同源加载 | 跨域加载可能较慢 |
| 成本 | 无额外成本 | 可能有流量/存储费用 |
| 维护 | 与文章一同管理 | 需要单独维护 |

## 图片优化建议（节选）

- 格式选择：照片类用 WebP 或 JPEG；图标类用 PNG 或 SVG；动态图片用 WebP 或 GIF。
- 控制大小：照片建议宽度不超过 1200px；缩略图 300-400px；大图考虑懒加载。
- 目录结构建议：

```
my-complex-post/
├── index.md
├── images/
│   ├── cover.jpg        # 封面图
│   ├── screenshot-1.webp
│   └── diagram.svg      # 示意图
├── assets/
│   ├── data.json
│   └── download.zip
```

对于图片较多的文章，可以创建子目录进一步组织资源。

## 预览文章

将文件夹名拼接到预览 URL 末尾即可查看（如 `http://localhost:4321/posts/my-complex-post`）。

## 创建多篇文章

`src/content/posts/` 下创建多个文件夹，每个文件夹代表一篇文章（含 index.md 与资源）。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
