# 官方文档快照：站点配置（siteConfig）

- 来源 URL：`https://docs.mizuki.mysqil.com/Basic-Layout/site-config/`
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

主题 `src/config.ts` 的 `siteConfig` 对象，字段面含：

- `title` / `subtitle` / `site` / `siteCreatedDate` / `timezone` / `lang`
- `themeColor`（`hue` 色相）
- `featurePages`（八个特色页开关）
- `bannerSource`
- `enableBookmark` / `enableProfileWallpaper`
- `homeListLayout`（`'landing' | 'list'`）
- `tagNumbers`
- `wallpaperMode`（`enable`、`mode`）

**逐字以原页为准。**

## Server 现状对照

纯字面量对象，无标识符引用 → **C7 config.ts 对象管理候选**（纯字面量先行批）。
