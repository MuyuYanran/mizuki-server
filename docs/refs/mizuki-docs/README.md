# Mizuki 官方文档快照

- 来源：`https://docs.mizuki.mysqil.com/`
- 快照日期：2026-08-28
- 快照方式：本批（Phase2-B4）执行时由代理一次性抓取落盘；原计划由人工落盘，
  执行时发现缺失，为不阻塞批次以最小例外方式补齐（抓取一次后即冻结，
  此后一律以本目录为唯一依据）。该偏差已记入 `docs/SESSIONS.md` B4 报告。
- 文档自身「最后更新于」：2026/4/21 10:12 PM（各页一致）
- 版权：LyraVoid Team，CC-BY-4.0

## 快照清单

| 文件 | 源页面 | 文档日期 |
|---|---|---|
| special-friends.md | /special/friends/ | 2025-08-17 |
| special-gallery.md | /special/gallery/ | 2025-08-28 |
| special-timeline.md | /special/timeline/ | 2025-11-20 |
| special-diary.md | /special/diary/ | 2025-08-17 |
| special-projects.md | /special/projects/ | 2025-11-20 |
| special-skills.md | /special/skills/ | 2025-11-20 |
| special-devices.md | /special/devices/ | 2025-11-20 |
| special-about.md | /special/about/ | 2025-08-17 |
| press-file.md | /press/file/ | 2025-09-01 |
| press-folder.md | /press/folder/ | 2025-09-01 |
| press-image.md | /press/image/ | 2026-01-13 |
| press-permalink.md | /press/permalink/ | 2025-11-21 |
| other-separation.md | /Other/separation/ | 2025-11-20 |
| other-structure.md | /Other/structure/ | 2025-11-20 |
| other-auto.md | /Other/auto/ | 2025-11-20 |

## 未快照页面（与本批审计无关）

部署类（/guide/deploy/*）、布局配置类（/Basic-Layout/*、/Article-layout/*、
/Sidepanel/*）、特色组件（/Feature/*）、Markdown 增强语法（/press/Markdown/*）、
视频嵌入、迁移指南（/transfer/*）、API 文档（/API/*，Bangumi/Meting/PicFlow
为前台展示功能而非数据文件规格）、FAQ（/problem/*）、番剧页面
（/special/anime/，Server 无对应集合，如后续裁决需要再补）。
