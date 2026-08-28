# 官方文档快照：侧边栏（sidebarLayoutConfig 及各组件）

- 来源 URL：`https://docs.mizuki.mysqil.com/Sidepanel/global/`（含 profile/announcement/categories/tag/site-stats/calendar 六子页，合并取证）
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

主题 `src/config.ts` 的 `sidebarLayoutConfig`：

- **布局面**：左/右栏归属、抽屉（drawer）配置、**组件排布数组**（数组顺序即渲染顺序）

各组件参数（要点）：

| 组件 | 参数 |
| --- | --- |
| profile | `avatar`、`name`、`title`、`social` |
| announcement | `icon`、`content` |
| categories | 组件开关类参数 |
| tag | 组件开关类参数 |
| site-stats | 组件开关类参数 |
| calendar | `enable`、`locale` 等 |

**逐字以原页为准。**

## Server 现状对照

纯字面量对象（数组排布 + 参数面）→ **C7 config.ts 对象管理候选**。
