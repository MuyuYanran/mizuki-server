# 官方文档快照：杂项配置（misc-config，七子页合并）

- 来源 URL：`https://docs.mizuki.mysqil.com/Basic-Layout/font/`（含 footer/、auto-res-algo/、layout/fullscreen/、layout/hide/、Feature/umami-config/、Feature/pio/ 六子页，合并取证）
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

杂项配置面（均位于主题 `src/config.ts`，同一对象模式）：

| 配置 | 内容 |
| --- | --- |
| `fontConfig` | 自定义字体 |
| `footerConfig` | 页脚（文案/链接等） |
| auto-res | 缩放算法（自适应方案） |
| layout/fullscreen | 全屏布局开关 |
| layout/hide | 隐藏布局开关 |
| umami | 统计配置（`umamiConfig`） |
| pio | Live2D 看板娘配置 |

**逐字以原页为准。**

## Server 现状对照

纯字面量对象 → **C7 config.ts 对象管理候选**。
