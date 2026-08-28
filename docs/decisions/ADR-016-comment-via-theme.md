# ADR-016: 评论采用主题自带 Twikoo/Giscus，Server 零自建

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-28 |
| 阶段 | Phase3-C0（人工裁决 2026-08-28） |

## 背景

主题原生提供完整评论链路（Twikoo / Giscus，`commentConfig` 全局配置 + 文章级 `comment: false` 开关，快照见 `docs/audits/phase3/twikoo.md`、`giscus.md`）；一期 P0b 预建了 comment 表与 `/public/comments` 端点骨架。

## 决策

自建评论路径关闭：comment 表休眠（不删、不迁移、不再读写）；`/public/comments` **永久冻结（不实现）**；三期 C7 仅做 commentConfig 的面板化管理配置面（生成/写回主题 `src/config.ts`），Server 不承载任何评论数据。

## 理由

评论数据持久化在第三方后端（Twikoo 自配 MongoDB/MySQL/PostgreSQL；Giscus 存 GitHub Discussions），审核与垃圾过滤在 Twikoo/Giscus 自有管理后台完成——Server 在此链路无增量价值，自建即重复建设。

## 影响

P8 冻结表第 5 行（`GET /public/comments` ⏳ 规划中）→ 🔒 **永久不实现**，以本 ADR + README「API 概览」注记为准；历史交付报告不做回改。
