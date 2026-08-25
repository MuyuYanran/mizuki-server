# ADR-003: manual 备份 `full` scope 的实际备份集合

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-26 |
| 阶段 | P2（备份与恢复） |

## 背景

P2 §3.4 规定 REST scope `full` 为「备份整个 Mizuki 项目目录（内容数据文件 + 内容目录）」。两处表述存在张力：字面上「整个项目目录」若按字面全量遍历，将包含 `node_modules/`（Astro 项目安装依赖后数百 MB）、`.git/`、构建产物等与内容无关的目录，备份体积与耗时不可控；而括号注「内容数据文件 + 内容目录」指向内容数据本身。

## 决策

按括号注取保守解释：`full` 的备份集合 = `data` 与 `content` 两个 scope 的并集：

- `src/data/*.ts`（内容数据文件，与 `data` scope 一致）；
- `src/content/**`（内容目录递归，与 `content` scope 一致）。

即 `full = data ∪ content`。`node_modules/`、`.git/`、`dist/` 等一律不进入备份。REST scope → 记录层 scope 映射为 `full/data/content → 'manual'`、`db → 'db'`（P2 §3.4 定型）。

## 备选方案

- 全量遍历项目目录并排除 `node_modules/.git/dist` 黑名单：更接近「整个目录」字面，但黑名单维护成本与遗漏风险高（pnpm store 链接、隐藏目录等），且本服务的职责边界是内容管理而非项目镜像 → 否决。

## 后果

- 「一键回滚内容」语义完整（内容数据 + 文章 + about 均可恢复）；
- 图片类内容（`public/images/` 等）不在 full 集合内，属媒体库管理范围（P7 media 索引与 `media.changed` 事件），后续若需纳入须修订本 ADR；
- db 与 config.json 的备份由 `db` scope 与服务端自身机制分别覆盖。
