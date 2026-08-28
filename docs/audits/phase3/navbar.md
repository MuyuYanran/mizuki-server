# 官方文档快照：导航栏（navBarConfig）

- 来源 URL：`https://docs.mizuki.mysqil.com/Basic-Layout/navBarConfig/`
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

主题 `src/config.ts` 的 `navBarConfig.links[]`，元素结构：

- `{ name, url, icon }`
- `children` 下拉子菜单
- 外链 `external` 标志
- **`LinkPreset.Home` / `LinkPreset.About` 预设标识符引用**——links 数组中可引用代码标识符而非纯字符串

**注记**：标识符引用是 P3 引擎 `UnsupportedLiteralError` 雷点——面板化管理若允许编辑含
`LinkPreset` 的行，序列化/回写会破坏代码语义 → **C7 需专项裁决**（保守拒绝 vs 白名单透传）。
