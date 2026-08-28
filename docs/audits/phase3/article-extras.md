# 官方文档快照：文章区组件（article-extras，五子页合并）

- 来源 URL：`https://docs.mizuki.mysqil.com/Article-layout/toc/`（含 share/、Edit-History/、copyright/、codeblock/ 四子页，合并取证）
- 规划级快照：架构师 2026-08-28 取证的要点转述；该页面被选定落地时须重新抓取原文升级为裁决级快照。

## 要点转述

文章区组件开关与参数（均位于主题 `src/config.ts`）：

| 组件 | 配置对象 / 字段面 |
| --- | --- |
| 目录 | `toc`——目录组件开关与参数 |
| 分享 | `shareConfig`——分享组件开关与渠道参数 |
| 编辑历史 | `showLastModified` / Edit-History 展示开关 |
| 版权 | `licenseConfig`——文章版权许可声明 |
| 代码块 | `codeblock`——代码块配置（主题/复制按钮等） |

**逐字以原页为准。**

## Server 现状对照

纯字面量对象 → **C7 config.ts 对象管理候选**。
