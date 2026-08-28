# 官方文档快照：文章固定链接（permalink）

- 来源 URL：`https://docs.mizuki.mysqil.com/press/permalink/`
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

v7.2+ 新增 frontmatter 字段 `permalink`——为**单篇文章**指定固定链接路径，覆盖默认的 URL 生成规则。

- **独立于目录名（slug）**：`permalink` 与文章所在目录名相互独立，不改变文件在仓库中的位置；
- **影响面**：站点 URL 生成、RSS、sitemap 均按 `permalink` 输出（已设置时）。

## Server 现状对照

P5 定义的 posts 十二字段面未包含 `permalink` → **C1 候选字段**。
