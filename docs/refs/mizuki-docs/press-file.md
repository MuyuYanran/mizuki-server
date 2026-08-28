> 快照说明：抓取自 https://docs.mizuki.mysqil.com/press/file/ ，快照日期 2026-08-28，文档日期 2025-09-01。仅供 B4 审计引用。

# 单文件方案（编写文章）

这是在 Mizuki 博客系统中创建文章的两种方法之一。适用于简单的文章，不需要管理大量图片资源的情况。**单文件方案会导致 RSS 无法正常构建图片的路径（指本地；如果使用图床则不会有这个问题），如果需要使用 RSS 功能请使用文件夹写作方案。**

## 创建文章

1. 在 `src/content/posts` 目录下创建一个新的 Markdown 文件，文件名应该具有描述性，例如 `my-first-post.md`。
2. 在文件中添加 frontmatter（前置元数据），**必须包含 `title` 和 `description` 字段**：

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
- `date`：文章创建日期（可选，不提供时系统使用文件的创建日期）
- `draft`：是否为草稿，true 表示草稿，false 表示正式发布
- `permalink`：固定链接

### 内容分类

- `tags`：文章标签数组，用于标记文章主题
- `category`：文章分类，用于组织文章
- `pinned`：是否置顶文章，true 表示置顶

### 作者信息

- `author`：文章作者姓名
- `licenseName`：文章许可证名称，如 "MIT"、"CC BY 4.0" 等
- `sourceLink`：文章源链接，通常指向 GitHub 仓库或原始来源

### 图片设置

- `image`：文章封面图片

## 最佳实践

- 日期格式：建议 ISO 8601（YYYY-MM-DD）。
- 标签和分类：标签具体且相关；分类用于高级组织，通常比标签更宽泛。
- 草稿管理：`draft: true` 不在生产环境显示。
- 常见许可证名称："MIT"、"Apache-2.0"、"CC BY 4.0"、"CC BY-SA 4.0"、"Unlicensed"。

## 添加图片

如果需要在文章中添加图片，可以将图片文件放在 `public` 目录下，然后在文章中通过相对路径引用：

```md
![图片描述](/images/my-image.webp)
```

## 创建多篇文章

`src/content/posts/` 目录下创建多个 `.md` 文件，**文件名将被用作文章的 URL 路径**。

## 注意事项

- 文件名将被用作文章的 URL 路径，所以应该具有描述性且**不含特殊字符**。
- frontmatter 中的 `date` 字段是可选的，如果不提供，系统会使用文件的创建日期。
- 这种方法适合简单的文章，但如果文章包含大量图片，建议使用子文件夹方案。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
