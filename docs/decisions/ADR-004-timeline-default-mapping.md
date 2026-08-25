# ADR-004: timeline 默认 icon/color 映射（暂定值）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳（暂定，待与真实 Mizuki 主题源码核对后修订） |
| 日期 | 2026-08-26 |
| 阶段 | P4（六类集合 CRUD） |

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

## 备选方案

- 暂不实现默认填充、等真实源码到位后再加：P4 §6.8 验收（icon/color 被填充非空）当期即不成立 → 否决。

## 后果

- 拿到真实 Mizuki 主题源码后须核对映射并修订本 ADR 与 `TIMELINE_DEFAULTS`（一次常量表变更，无结构性改动）；
- 默认值仅作用于「新增时未提供」的场景，用户显式提供的 icon/color 不受影响。
