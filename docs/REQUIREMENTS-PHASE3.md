# REQUIREMENTS-PHASE3 —— 三期需求规格（草案基线）

> 起草批次：Phase3-C0（2026-08-28）。决议来源：人工裁决会议 2026-08-28 拍板；
> 官方文档快照三件见 `docs/audits/phase3/`（press-key / twikoo / giscus）。
> 二期基线：测试 295/295（Phase2-B2.1 收官）。

## §1 决议登记（人工裁决 2026-08-28，逐条转录）

1. **评论**：采用主题自带 Twikoo/Giscus，Server 零自建；comment 表休眠；`/public/comments`
   永久冻结（记 **ADR-016**）；commentConfig 面板化管理归 **C7**（override 批）。
2. **文章密码锁（新 C1）**：字段面 `encrypted`/`password`/`comment` 纳入 post schema 与面板表单；
   公开 API 修复两个泄漏点（详情 html 明文正文 + frontmatter 明文密码）——encrypted 文章详情
   返回 `{frontmatter:<剥离 password>, html:''}`，非加密文章零变化，列表不动。**公开 API 冻结
   优先级最高的安全例外**，理由：泄漏点为存量缺陷非新面。
3. **C3 方案**：包管理器解析链四层——① config/env 显式路径 → ② lockfile 探测（P9 既有）→
   ③ 真实二进制定位：Windows `where.exe` / POSIX `which -a` 列全候选，逐候选 `--version`
   探活，失败跳下个 → ④ 全失败报错附配置指引；全程 `shell:false`。C3 批先核对 ADR-011 原文，
   冲突时以 ADR-011 为准并回报。
4. **C4 方案**：`/preview` 通道（Astro dist，GET-only + JWT cookie + ADR-012 同构四边界，
   批次内 ADR）+ 上传缩略图变体（sharp `-thumb.webp` 同目录，网格用缩略图/灯箱用原图）。
5. **C6 撤销**：cpolar 通道已关闭（2026-08-28），安全事件闭环；部署 checklist 残项并入 C5。
6. **B2.1 疑问两条已裁决**：PATCH 不强制存量补齐、uploadCover 维持放行（面板前端必填引导补齐）。
7. **流程规则**：批次提示词 §0 必含裁决/需求映射表 n/n；前置检查基线以 stash 态验证。
8. **序列**：C0→C1→C2→C3→C4→C5→C7→收官。

## §2 批次范围（每批一句话）

| 批次 | 范围 |
|---|---|
| C0 | 三期规划对齐（本批，纯文档）：决议登记 + 快照三件 + 本规格起草 |
| C1 | 文章密码锁：post schema 字段面 + 面板表单 + 公开 API 双泄漏点修复（决议 2） |
| C2 | 面板功能补齐批：含 description 存量体检（真实主题构建是否报错 → 本批核对） |
| C3 | 包管理器确定性解析（R2-16 认领，决议 3 四层解析链，先核对 ADR-011） |
| C4 | /preview 通道 + 上传缩略图变体（决议 4，批次内 ADR） |
| C5 | 部署 checklist 收口（并入 C6 残项）+ p9 测试数据目录隔离 |
| C7 | override 批：commentConfig 面板化管理（决议 1） |
| 收官 | 三期收尾回归与验收 |

## §3 遗留入册（三期承接，落地时逐项销账）

1. **B4 审计【B2 落地（待裁决）】8 项**（`SPEC-ALIGNMENT-B4.md`）：b1/b2/b3 相册 info.json
   官方字段面（mode/hidden/layout 枚举/columns/cover.jpg 校验）、g2 timeline type 枚举
   （education|work|project|achievement 映射语义）、h3~h6 projects/timeline/skills/devices
   字段面——落地时遵守 **ADR-013 幽灵字段禁令**（字段、服务、表单同批可见）。
2. **R2-16 包管理器确定性解析**：→ C3 认领（ADR-011 设计基线在位）。
3. **description 存量体检**：真实主题构建是否因存量 md 缺 description 报错 → C2 核对。
4. **p9 测试数据目录隔离**：p9-process 等基线套件使用仓库真实 data 目录 → C5 统一 mkdtemp 隔离。
5. **外链 photos 富元数据子规格**：camera/lens/settings 待官方文档补齐后收紧。
6. **工程债清单**：前端路由级代码分割（chunk 2.5MB）、eslint-plugin-vue 引入评估、
   Vditor 代码高亮暗色配色（B3.6 已知限制 2）、RichArticleEditPage pubDate 裸 el-input
   （TipTap 冻结唯一残留）、UploadedFileLike 类型收敛、富文本软删恢复入口、部署 checklist 残项。
