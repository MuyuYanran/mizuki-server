# 官方文档快照：番剧页（anime）

- 来源 URL：`https://docs.mizuki.mysqil.com/special/anime/`
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

番剧页数据源**三选一**，由主题 `src/config.ts` 的 `animeConfig.mode` 决定：

| mode | 配置 | 说明 |
| --- | --- | --- |
| `'bangumi'` | 配 `userId` | 拉取 Bangumi 收藏数据 |
| `'bilibili'` | 配 `vmid` | 拉取 B 站收藏数据；可选环境变量 `SESSDATA` 提升数据完整度 |
| `'local'` | `src/data/anime.ts` | 本地条目数组，元素类型 `AnimeItem` |

`AnimeItem` 字段面（要点，全表以原页为准）：

- `title`、`cover`
- `status` 枚举：`wish | doing | done`
- `rating`、`progress`、`totalEpisodes`
- `genre[]`、`date`、`comment`、`link` 等

## Server 现状对照

B4 审计曾判「anime 无规格依据」（i2）——**该判定已被本页推翻**：`local` 模式即官方规格，
anime 可作为**第七集合**（local 模式）纳入规划（→ C2 候选，待人工确认）。
