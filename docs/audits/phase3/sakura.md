# 官方文档快照：樱花特效（sakuraConfig）

- 来源 URL：`https://docs.mizuki.mysqil.com/Feature/sakura/`
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

主题 `src/config.ts` 的 `sakuraConfig`，特效参数面含：

- `enable`
- `quantity` / `size` / `opacity` / `speed` / `zIndex`

**逐字以原页为准。**

## Server 现状对照

纯字面量对象 → **C7 config.ts 对象管理候选**。
