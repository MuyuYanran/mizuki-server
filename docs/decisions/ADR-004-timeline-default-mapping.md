# ADR-004: timeline 默认 icon/color 映射（暂定值）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳（B4 修订：education 类已按官方文档核对；其余三类仍暂定并注记） |
| 日期 | 2026-08-26（2026-08-28 B4 修订） |
| 阶段 | P4（六类集合 CRUD）；B4（规格对齐审计修订） |

## 背景

REQUIREMENTS §6.6 要求 timeline 条目「按 type 自动设置默认 icon/color」，并注明「默认映射表实现时从 Mizuki 主题源码确认并记 ADR」。本会话无真实 Mizuki 项目源码可核对（守则禁止触碰真实 Mizuki 目录，仓库内仅有 fixture 假项目），无法逐字确认主题使用的图标名与配色。

## 决策

P4 先以暂定映射实现（`collections.service.ts` 的 `TIMELINE_DEFAULTS`），语义为「POST 新增时未提供 icon/color 则按 type 填充非空默认值」：

| type | icon | color |
|---|---|---|
| education | graduation-cap | #3b82f6 |
| certificate | award | #f59e0b |
| project | rocket | #10b981 |
| other | star | #8b5cf6 |

icon 取 Lucide 风格图标名（与 Mizuki/Astro 生态常用图标库一致），color 取 Tailwind 调色板 500 号色（education=blue、certificate=amber、project=emerald、other=violet）。

## B4 修订（2026-08-28，官方文档快照核对）

官方文档快照 `docs/refs/mizuki-docs/special-timeline.md` 已到位，核对结论：

1. **图标集**：官方使用 **Iconify 图标集**（§2「icon?: string: 使用 Iconify 图标集」），非 Lucide——暂定映射的图标名风格需要换系；
2. **education 可核对**：官方 §2 示例逐字给出 `icon: "material-symbols:school"`、`color: "#059669"` → `TIMELINE_DEFAULTS.education` 已按官方值修订；
3. **work 可核对**（`material-symbols:work` / `#DC2626`，§3 示例），但当前 `TimelineTypeSchema` 枚举无 `work`（官方枚举为 `education|work|project|achievement`，与现行 `education|certificate|project|other` 不一致）——枚举对齐涉及集合服务行为与存量数据，未在本批处理，转 B4 审计总表（SPEC-ALIGNMENT-B4.md T2-g/h）裁决；
4. **certificate/project/other 无官方示例**：暂定值保留，代码处逐行注记「暂定：无官方示例」；
5. fixture `timeline.ts` t-001 同步为官方示例值。

**遗留义务勾销**：P4 报告偏差 1 与原文「待与真实 Mizuki 主题源码核对后修订」义务就此兑现——可核对项已修订，不可核对项已注记理由并转审计裁决。

## 备选方案

- 暂不实现默认填充、等真实源码到位后再加：P4 §6.8 验收（icon/color 被填充非空）当期即不成立 → 否决。

## 后果

- 拿到真实 Mizuki 主题源码后须核对映射并修订本 ADR 与 `TIMELINE_DEFAULTS`（一次常量表变更，无结构性改动）；
- 默认值仅作用于「新增时未提供」的场景，用户显式提供的 icon/color 不受影响。

## C2b 修订（2026-08-29，官方枚举落地）

Phase3-C2b（ADR-018）将 `TimelineTypeSchema` 对齐官方枚举 `education|work|project|achievement`（certificate/other 经载入迁移分别映射为 work/achievement），`TIMELINE_DEFAULTS` 随之换键：

| type | icon | color | 依据 |
|---|---|---|---|
| education | material-symbols:school | #059669 | 官方 §2 示例逐字（B4 修订已定） |
| **work** | **material-symbols:work** | **#DC2626** | 官方 §3 示例逐字（本修订新增，B4 修订节遗留义务兑现） |
| project | rocket | #10b981 | 暂定：无官方示例（注记保留） |
| achievement | star | #8b5cf6 | 暂定：无官方示例（注记保留；承接原 other 键的暂定值） |

certificate/other 键随枚举迁移一并移除（默认填充仅作用于 POST 新增，存量条目 icon/color 不回填——迁移只动 §2 迁移表列明的字段）。
