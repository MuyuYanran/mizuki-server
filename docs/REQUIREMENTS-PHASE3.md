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
   【转正（2026-08-29，架构师裁决，C5 为首批实践）】「批次提示词执行前红队评审」升为
   正式流程规则（C5 v1 评审 14 项全消化：11 采纳/2 修正后采纳/1 采纳并纠偏）。
   【流程先例（2026-08-29，C5）】「评审→裁定全权模式」：人工授权「检验完成后直接通过」
   ——v2 无遗留即视同红队通过，免二轮往返；随本台账注记生效。
   【候选追加（2026-08-29，C4 先例）】红队清单增补「部署拓扑检查项」——T4.1 实证
   hostname 硬编码 127.0.0.1 会在 localhost/127.0.0.1 双访问形态下破坏 cookie host 匹配
   （C4 v2 已先例修正为 window.location.hostname 派生），后续批次提示词涉 URL 拼装/
   绑定地址时须列入红队检查单；待人工确认并入。
   【处置记录（2026-08-29，C4 执行时）】「红队评审转正」候选项：检查工作树与 SESSIONS
   均无人工裁决落笔 → 维持候选不转正（无悬空等待）。（追记：同日 C5 时点该候选已由
   架构师裁决转正，见上行，本处置记录仅存档 C4 时点状态。）
   【处置记录（2026-08-29，C5 执行时）】「部署拓扑检查项」候选项：复查工作树与 SESSIONS
   无人工裁决落笔 → 维持候选不转正（C4 处置模式复用；红队评审既已转正，本项按其检查单
   惯例先行实践，转正仍待人工确认）。
   【转正终态（2026-08-29，Phase3-F 收官批，人工裁决免红队 + 架构师自查替代）】流程候选
   四项转正为正式流程规则，权威载体设立为 `docs/PROCESS-RULES.md`（T1.1 侦查定案，跨期
   可发现性）：R1 部署拓扑检查项（上行候选就此转正关闭）、R2 前置检查条件化规则（C5
   载体先例）、R3 四格语义表（C5 先例）、R4 裁决复用域核验（**本节增补行**——C7 zh_CN
   先例，三期在案首登）。转正条文自三期收官后生效、对四期起适用，不追溯既往批次裁决。
8. **序列**：C0→C1→C2→C3→C4→C5→C7→收官。

## §2 批次范围（每批一句话）

| 批次 | 范围 |
|---|---|
| C0 | 三期规划对齐（本批，纯文档）：决议登记 + 快照三件 + 本规格起草 |
| C1 | 文章密码锁：post schema 字段面 + 面板表单 + 公开 API 双泄漏点修复（决议 2） |
| C2 | 面板功能补齐批：含 description 存量体检（真实主题构建是否报错 → 本批核对） |
| C3 | 包管理器确定性解析（R2-16 认领，决议 3 四层解析链，先核对 ADR-011） |
| C4 | /preview 通道 + 上传缩略图变体（决议 4，批次内 ADR）
  【状态：**C4 已落地**（2026-08-29，ADR-019）：自有静态通道不托管 astro preview 进程 +
  preview-ticket 签发（cookie 参数终值表）+ 缩略图变体相册面管线（fail-open 仅限变体、
  删除耦合）；详见 CHANGELOG Phase3-C4 节】 |
| C5 | 部署 checklist 收口（并入 C6 残项）+ p9 测试数据目录隔离
  【状态：**C5 已落地**（2026-08-29，含架构师裁决 i18n 收口并入）：部署 checklist 收口
  产物 `docs/DEPLOYMENT-CHECKLIST.md`（C6 残项闭环 + env 全量盘点）+ 测试数据目录隔离
  （app/p1/p11 三裸启套件 → mkdtemp，真实 data 目录零交集）+ posts `lang` 字段（官方
  frontmatter 对齐疏漏收口，additive 授权例外）；详见 CHANGELOG Phase3-C5 节】 |
| C7 | override 批：commentConfig 面板化管理（决议 1）+ config 受控子集管理（siteConfig.lang，i18n 收官面）
  【状态：**C7 已落地**（2026-08-29，ADR-020）：侧车 JSON + ts-morph 声明级定点置换
  （硬约束两条满足：主题仓非 git 跟踪树零 diff、声明级置换构造保证非受控值不变）+
  admin config 三端点（.strict() 禁蔓延）+ 站点配置页（schema-form 驱动，债堆④判定
  不触发）；详见 CHANGELOG Phase3-C7 节】 |
| 收官 | 三期收尾回归与验收
  【状态：**F 已落地**（2026-08-29，收官批）：流程候选四项转正（`docs/PROCESS-RULES.md`）
  + siteConfig lang 拆分 siteLangSchema（C7 疑问①）+ preview 缓存三档分派（ADR-019 追加）
  + 遗留终裁四项 + 真实 DB 只读核查零残留 + 走查总账（本文件 §4）；详见 CHANGELOG
  Phase3-F 节】 |

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
   **C5 已销账**：实际裸启者为 app / p1-security / p11-static-panel 三套件（p9 系本就 mkdtemp），
   均已注入 mkdtemp 临时域；真实 `apps/server/data/` 系本地实例数据（非测试污染），未做清理。
5. **外链 photos 富元数据子规格**：camera/lens/settings 待官方文档补齐后收紧。
   **C2a 已收紧**：官方 14 字段逐字对齐（src 必填其余可选），settings 从自由 record 收紧
   为 `{aperture/shutter/iso/focal 均 string}` 四子键 `.strict()` 对象，photos 整体
   `.strict()` 未知子字段拒绝（B2 疑问 4 二次收紧条件达成）。
6. **工程债清单**：前端路由级代码分割（chunk 2.5MB）、eslint-plugin-vue 引入评估、
   Vditor 代码高亮暗色配色（B3.6 已知限制 2）、RichArticleEditPage pubDate 裸 el-input
   （TipTap 冻结唯一残留）、UploadedFileLike 类型收敛、富文本软删恢复入口、部署 checklist 残项
   （已由 C5 收口，见 `docs/DEPLOYMENT-CHECKLIST.md`）。
7. **articles lang 是否补**（C5 i18n 全景裁决豁免项，有意遗留）：posts frontmatter lang 系
   posts 专属机制，articles 为 DB 富文本域官方无 frontmatter lang——是否补由收官批裁。
   **【终裁（2026-08-29，Phase3-F）】不补**——articles 系 DB 富文本域无 frontmatter 概念，
   lang 无承载位；未来引入 frontmatter 机制再议。

## §4 三期收官（Phase3-F，2026-08-29）

### 4.1 批次总表（C0~C7+F 终态）

| 批次 | 终态 | 测试基线 | 交付要点 |
|---|---|---|---|
| C0 / C0.1 | 完成 | 295（不变） | 决议登记 + 官方快照三件入仓 + 规格起草 |
| C1 | 完成 | 301（+6） | 文章密码锁 + 公开 API 双泄漏点修复 |
| C2a | 完成 | 312（+11） | 相册字段面对齐 + 上传白名单重裁决（ADR-017） |
| C2b | 完成 | 333（+21） | 六类集合字段面对齐 + id 官方串修正（ADR-018）+ anime 第七集合 |
| C3 | 完成 | 342（+9） | 包管理器确定性解析链（ADR-011 落地） |
| C4 | 完成 | 355（+13） | /preview 预览通道 + 上传缩略图变体（ADR-019） |
| C5 | 完成 | 359（+4） | 部署 checklist 收口 + 测试数据隔离 + posts lang |
| C7 | 完成 | 369（+10） | override 批：commentConfig 面板化 + config 受控子集管理（ADR-020） |
| F | 完成 | 373（+4） | 收官批：流程候选四项转正 + siteLang 拆分 + preview 缓存策略 + 遗留终裁 |

基线链：**295 → 301 → 312 → 333 → 342 → 355 → 359 → 369 → 373**（C6 撤销无基线；F 恰达
下限 ≥373：lang +2、缓存 +2）。

### 4.2 遗留清单终态

- §3.1~3.6 已逐项销账（见各行注记；§3.6 工程债清单中非 checklist 项明确不在三期收口面，
  保留原状移交四期裁量）；§3.7 articles lang **终裁「不补」**（2026-08-29，见上行）。
- C7 疑问①（zh_CN 形）由 F siteLangSchema 拆分关闭；C7 疑问③（全序 500 观察项）由 F
  全量全序 373/373 绿关闭；C4 疑问 1（缓存策略）由 F 三档分派关闭；C4 疑问 2（preview
  绑定）终裁维持镜像语义（ADR-019 既有裁决）。C7 疑问②（物化态警示）**未清**，
  见 SESSIONS 收官报告走查总账未清项。

### 4.3 流程演进注记

红队评审（C5 转正）→ 评审→裁定全权模式（C5 先例确立，C7 首批实践）→ 架构师自查替代
（F 收官批人工裁决变体：自查七项 + v1 评审 17 项全消化）。流程规则权威载体自 F 起
为 `docs/PROCESS-RULES.md`（转正四项 R1~R4，条文/缘起/先例链接三要素齐备）。
