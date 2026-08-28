# 官方文档快照：音乐播放器（musicPlayerConfig）

- 来源 URL：`https://docs.mizuki.mysqil.com/Feature/MusicPlayer/`
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

主题 `src/config.ts` 的 `musicPlayerConfig`，字段面含：

- `enable`
- `playerServer`（Meting 系播放服务）
- `id`（歌单 ID）
- `server`（音乐平台）
- `type`（`'playlist'`）
- `volume` / `fixed`

**逐字以原页为准。**

## Server 现状对照

纯字面量对象；数据源走 Meting（主题侧 Serverless）→ **C7 config.ts 对象管理候选**（仅管配置面，数据面排除）。
