# 官方文档快照：横幅（banner）

- 来源 URL：`https://docs.mizuki.mysqil.com/Basic-Layout/layout/banner/`
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

主题 `src/config.ts` 的 `banner` 对象，字段面含：

- `enable`
- `home` 与 `about` 各自的 album 图片组（多图）/ `url` / 外链 API
- `type`（`'fullscreen' | 'nomask'`）
- `waves` / `rainbow` / `overlay` / `swiper` / `opacity`
- `source`（`{ text, author, url }` 图片署名）
- `transparentMode`

**逐字以原页为准。**

## Server 现状对照

纯字面量对象 → **C7 config.ts 对象管理候选**。
