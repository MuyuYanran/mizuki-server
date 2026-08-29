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
   优先级最高的安全例外**，理由：泄漏点为存量缺陷非新面。（**C1 已落地**：2026-08-29，
   四可删键含 P5 既有 permalink；PATCH 增设 null 删键哨兵语义；详见 CHANGELOG Phase3-C1 节。）
3. **C3 方案**：包管理器解析链四层——① config/env 显式路径 → ② lockfile 探测（P9 既有）→
   ③ 真实二进制定位：Windows `where.exe` / POSIX `which -a` 列全候选，逐候选 `--version`
   探活，失败跳下个 → ④ 全失败报错附配置指引；全程 `shell:false`。C3 批先核对 ADR-011 原文，
   冲突时以 ADR-011 为准并回报。**（C3 已落地**：2026-08-29；③ 的 .cmd 处置与本决议
   「策略 A/cmd.exe 包装」冲突，按铁律以 ADR-011 垫片穿透为准，见 ADR-011「C3 落地」节与
   CHANGELOG Phase3-C3。）
4. **C4 方案**：`/preview` 通道（Astro dist，GET-only + JWT cookie + ADR-012 同构四边界，
   批次内 ADR）+ 上传缩略图变体（sharp `-thumb.webp` 同目录，网格用缩略图/灯箱用原图）。
5. **C6 撤销**：cpolar 通道已关闭（2026-08-28），安全事件闭环；部署 checklist 残项并入 C5。
6. **B2.1 疑问两条已裁决**：PATCH 不强制存量补齐、uploadCover 维持放行（面板前端必填引导补齐）。
7. **流程规则**：批次提示词 §0 必含裁决/需求映射表 n/n；前置检查基线以 stash 态验证。
   【候选追加（2026-08-29，C3 评审先例）】「批次提示词执行前红队评审」——批次提示词
   下发前先行评审修订（C3 v2 即先例：评审发现层①快速失败语义、.cmd 策略冲突、测试
   PATH 口径等 14 项并出 v2），待人工确认转正式流程规则。
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
   **b1/b2/b3 已由 C2a 落地**（hidden/layout/columns 对齐共享面、外链 photos 收紧官方 14
   字段 + settings 四子键；白名单重裁决见 ADR-017；详情见 CHANGELOG Phase3-C2a）。
   **g2/h3~h6 已由 C2b 落地**（字段面逐字对齐、id 修正为官方字符串名称串 + 载入触发值域
   迁移、timeline type 迁移 certificate→work/other→achievement；见 **ADR-018** 与
   CHANGELOG Phase3-C2b）。**anime 第七集合决议登记**（C0.1 快照推翻 B4 i2「无规格」判定，
   C2b 以 local 模式落地，title 定位、无 id 字段；mode/bangumi/bilibili 配置归 C7）。
2. **R2-16 包管理器确定性解析**：→ C3 认领（ADR-011 设计基线在位）。
3. **description 存量体检**：真实主题构建是否因存量 md 缺 description 报错 → C2 核对。
   **C2a 已核对**：fixture 两 post 与官方示例 frontmatter（press-file/press-folder/
   other-structure）均含 description，官方 press 文档明确 description 为必需字段——
   存量无缺项；若真实构建对缺字段报错，三期补「缺失字段体检」工具（本批仅清点）。
4. **p9 测试数据目录隔离**：p9-process 等基线套件使用仓库真实 data 目录 → C5 统一 mkdtemp 隔离。
5. **外链 photos 富元数据子规格**：camera/lens/settings 待官方文档补齐后收紧。
   **C2a 已收紧**：官方 14 字段逐字对齐（src 必填其余可选），settings 从自由 record 收紧
   为 `{aperture/shutter/iso/focal 均 string}` 四子键 `.strict()` 对象，photos 整体
   `.strict()` 未知子字段拒绝（B2 疑问 4 二次收紧条件达成）。
6. **工程债清单**：前端路由级代码分割（chunk 2.5MB）、eslint-plugin-vue 引入评估、
   Vditor 代码高亮暗色配色（B3.6 已知限制 2）、RichArticleEditPage pubDate 裸 el-input
   （TipTap 冻结唯一残留）、UploadedFileLike 类型收敛、富文本软删恢复入口、部署 checklist 残项。
