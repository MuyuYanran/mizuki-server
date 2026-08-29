# 项目交接文档：Mizuki-Ts-Server 架构师 AI 交接（2026-08-28）
（新会话的架构师 AI：读完本文即接任本项目架构师/技术决策者角色）

> **[时效注记（2026-08-29，Phase3-F 收官批入库）]** 本文系**历史交接快照**（二期
> 收官前时点 2026-08-28 入库存档），所载状态与计划已被三期各批交付覆盖，不反映
> 当前实况；其中「再暴露公网用 https + cpolar HttpAuth 双层」建议（原 §八末段，
> 注记插入后行号下移，以内容定位为准）**已作废**——公网部署口径以
> `docs/DEPLOYMENT-CHECKLIST.md` 为准（https + 反向代理 + Swagger 置 false）。

## 一、项目概况
- 目标：给 Mizuki 博客主题（Astro）做管理后台。官方文档 docs.mizuki.mysqil.com
  已快照至 docs/refs/mizuki-docs/*.md——**快照是唯一规格依据，禁访问外网**。
- 仓库：D:/_paths/Workspace/Projects/BlogFiles/Mizuki-Ts-Server（pnpm monorepo）
- 结构：apps/server（NestJS+SQLite data/mizuki.db，端口 20154）、
  apps/web（Vue3+element-plus+pinia）、packages/shared（zod schema，
  六类集合 diary/projects/timeline/skills/devices/friends 为 mapper 驱动）
- 用户：Windows+PowerShell 环境，站长兼**人工裁决者**，愿意自己跑诊断命令

## 二、协作模式（角色与节奏）
- 三方分工：**架构师 AI**（规划批次、写执行提示词、判卷；不直接改码）+
  **人工裁决**（用户拍板）+ **执行 AI**（Codex/Kimi/GLM；Kimi 已认证 B3，
  e2e 大户建议 GLM）。
- 节奏：批次制。每批一份完整提示词（C-Plus 连续执行模式），完成即停在
  停止点，SESSIONS.md 报告，人工验收后进下一批。
- 提示词必备件：前置检查（HEAD/工作树/前置交付在位）→ 必读输入 → 任务
  分解（带编号、规则写死不留解释空间）→ 硬性边界 → 环境自检 → 报告义务
  （Conventional Commits + SESSIONS 报告含偏差/疑问/fixture 变更/手动
  走查清单）→ 停止点。
- 判卷方法：三账核对（数字账=测试数与基线+增量吻合、交付物存在性、停止
  点纪律），并给用户可自己跑的抽查命令（git show --stat 等）。
- 血泪教训：超长提示词输出若中途损坏（本会话曾连续三次），必须重出完整
  干净版并声明旧版作废，绝不让用户拼残骸；评审者（另一 AI/用户）能在
  残骸下发现真问题——「写时迁移死锁」就是评审抓出来的。

## 三、批次时间线
- 一期 P0a–P11（完成）：P6 auth（argon2id，**无改密功能**）、P7 双上传
  管线、P8 公开API四路径冻结、P10b/c/d 前端、P11 helmet+docs+config
  provider（**坑5：快照语义，改配置须重启**）。
- 二期：B1（六类集合+向导+mode：manage/additive；R2-5 manage 隐藏六类
  集合+富文本）→ B1.5（安全加固：/site-assets 通道+ADR-012 四边界
  [safeJoin/扩展名白名单/魔数嗅探/JPT更正:JWT]、穿越三变体 e2e、10 用例）
  → B3（TipTap→Vditor）→ B3.5+B3.6（已合入：Vditor 自托管 public/vditor、
  暗色内容区修复、日期控件 el-date-picker 默认当天、编辑区全宽、相册上传
  接线修复——原调错媒体库端点）→ B4（规格对齐审计，**已完成**，提交
  b11db32/dc5bcb8/4bb443b，测试 254，产物 docs/SPEC-ALIGNMENT-B4.md 含
  「B2 输入增量」小节、ADR-013）→ **B2（终版提示词已交付，待执行，
  二期收官批）**。

## 四、九项裁决（2026-08-27 用户全部拍板，B2 落地）
1. content-posts 预览通道：/site-assets 扩挂 src/content/posts 只读出口，
   四边界复用；预览层无条件改写（解析后仍在 slug 目录内含子目录即改写，
   ../ 逃逸不改写），无存在性检查，目标缺失由服务端 404。
2. 转码拆分：相册移除「非JPG强转JPG」原格式落盘；posts 封面维持
    （cover.jpg 硬约定）；媒体库直传维持现状。
3. 上传白名单终集 jpg/jpeg/png/gif/webp/avif；bmp（sharp 实证不可解码）
   与 svg（XSS）排除；tiff 魔数能力+单测保留、放行层排除（两层分离）。
4. PATCH /admin/system/mode 运行期改模式（provider 活取值，不重启）。
5. PATCH /admin/auth/password 改密：admin_user 加 token_version（改密+1，
   refresh 比对 ver 不一致 401；access 15min 自然过期不吊销，窗口语义记录）。
6. Swagger 生产开关：config.swagger 默认 true，false 时 docs 404。
7. manage 菜单收窄：仅藏富文本，六类集合保留。
8. posts description：server 端创建/修改强制必填。
9. 六类 id：nanoid string → number（max+1 冲突重试上界1000，自动换新，
   无旧映射兼容）。
- 另有 R2-14 重定义（B4 审计纠错，非裁决）：相册外链 info.json =
  {mode:"external", cover:<url>, photos:[{src 必填, thumbnail, alt,
  width, height, camera, lens, settings}]}；**禁止旧形状
  source:"external"+urls[]**。
- mode 切换 409 规则：切 external 要求本地照片目录与记录为空；切 local
  要求 photos 为空（错误信息含数量）。

## 五、B2 关键设计与判卷要点
- **id 迁移防死锁（最重要）**：迁移触发点=引擎载入时，在 zod parse 之前
  的原始 JSON 层检测非 number id → max+1 换新 → 原子写回（temp+rename+文件锁）
  → 再走正常流程。写时迁移是死锁（读失败永远到不了写）。max 基准取文件内
  现存 number 最大值（全 string 从 1 起），幂等。
- **死锁证明用例防假测试**：fixture 本体已 number 化，迁移触发用例必须由
  测试 setup 直接向数据目录写入构造的 string id 文件验证，不得拿已迁移
  fixture 自证。
- 测试：基线 254，新增 ≥27，期末 ≥281。
- **判卷四盯**：死锁证明用例真伪、外链相册 e2e 是否真全生命周期、改密
  吊销窗口语义记录、content-posts 穿越三变体+无JWT 401。

## 六、硬事实速查
- 媒体库上传 POST /admin/media → public/images/uploads/<nanoid>.jpg，
  进 media_file 索引；相册上传 → public/images/albums/<名>/原名.jpg，
  不进索引；本地相册封面必须 cover.jpg。
- /site-assets 挂认证中间件之后（公网实证 401）；status 端点在
  GET /api/v1/system/status（**无 admin 前缀**，需 token）；health 公开。
- config：apps/server/data/config.json（mode、jwtSecret；data/ 已 ignore）。
- friends 官方 interface {id:number,title,imgurl,desc,siteurl,tags:string[]}
  全必填、tags≥1；官方图片格式含 bmp/tiff；frontmatter title/description
  必填；文件夹方案文章图片用相对路径 ![](./x.png)。
- 历史诊断闭环：友链消失=manage 模式设计行为（非 bug，已给用户手改
  config.json+重启的解法）；相册上传落媒体库=前端调错端点（B3.6 已修）。

## 七、坑与纪律（写进每份执行提示词）
1. P11 坑5：config 快照语义，改配置须重启（B2 T4② 改活取值）。
2. 幽灵字段禁令（ADR-013）：mapper 驱动 schema 新增字段=表单自动长控件
   +服务端静默丢弃；新增持久化字段必须与服务/UI 接线同批。
3. safeJoin 路径纪律、零 any/@ts-ignore、零新增依赖、boundaries 分层、
   fixture 唯一测试数据源。
4. 公开 API 四路径冻结（P8）；/site-assets 既有行为不变。
5. 环境：lint/build 清洁环境（unset BASH_ENV、NODE_OPTIONS=""）；test
   单独串行（PATH 真实 node 置于 corepack shims 前）；三连 pnpm
   test/build/lint 全绿 0/0；测试基线只增不减。
6. 表结构变更走 migration 或 ALTER+实测，禁删库重来。
7. 「先对齐再动刀」sequencing：规格审计（B4）先于行为开发（B2），
   避免返工——本项目的审计曾纠出 R2-14 形状错误与 id 类型炸弹两个
   潜在返工点，此方法论有效，三期沿用。

## 八、安全事件与遗留
- 2026-08-27 cpolar http 明文公网暴露：四边界公网实证完好（管理API 401/
  site-assets 401/穿越外层401内层404/公开面最小化），无泄露路径；但
  凭据 MuyuYanran/wodeshijie111 已进对话与明文网络记录。
- **⚠️ B2 改密功能上线后第一件事：用户立即改密**。
- 再暴露公网用 https + cpolar HttpAuth 双层；生产部署 Swagger 置 false。

## 九、下一步
1. 用户把 **B2 终版提示词**（上一会话 2026-08-28 评审修订版：单一完整
   markdown 块，含 §0 规格基线/前置检查/T1–T8/硬边界/环境/报告/停止点）
   粘贴给 GLM 执行。该块替代更早的 8 节拼接残骸版。
2. B2 报告回来 → 按 §五 判卷 → 二期收官。
3. 三期规划以 B2 报告「三期输入增量」小节为输入（仅记录未展开）。
4. 用户手动走查：改密全流程、外链相册 UI、mode 切换菜单变化、暗色外链
   相册页。
