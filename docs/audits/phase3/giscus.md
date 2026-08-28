# 官方文档快照：Giscus 评论（Article-layout/Giscus）

- 来源 URL：`https://docs.mizuki.mysqil.com/Article-layout/Giscus/`
- 快照内容由架构师 2026-08-28 抓取，执行会话无网，以本文件为准。

## 配置位置

与 Twikoo 同一 `commentConfig`（主题 `src/config.ts`），`system: "giscus"` 时启用 `giscus` 键（结构见 `twikoo.md` verbatim 代码块）。

## giscus 键语义

- `repo` / `repoId` / `category` / `categoryId`：由 giscus.app 配置页自动生成；
  `category` 建议 **Announcements**（仅管理员可建 Discussion，防访客乱开主题）；
- `mapping`：推荐 `pathname`（按路径关联 Discussion）；
- `theme`：推荐 `preferred_color_scheme`（跟随访客系统明暗）；
- `loading`：推荐 `lazy`（懒加载）。

## 前置条件

1. 公开 GitHub 仓库；
2. 安装 Giscus App；
3. 仓库启用 Discussions。

评论数据存 GitHub Discussions。
