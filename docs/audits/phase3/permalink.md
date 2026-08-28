# 官方文档快照：文章固定链接（permalink）

- 来源 URL：`https://docs.mizuki.mysqil.com/press/permalink/`
- 裁决级快照：架构师 2026-08-28 抓取原文 verbatim，以本文件为准。

---

# 固定连接

2025-11-21 · Mizuki 7.2 以上新特性

「这是在Mizuki7.2以上加入的新特性,支持你为文章配置固定链接,优化SEO!」

## 使用方法

在文章的 Front Matter 中添加以下配置：

```yaml
---
permalink: "encrypted-example"
---
```

「他会相对于`posts`构建路径生成一个固定链接」——即相对 posts 构建路径生成固定链接。
