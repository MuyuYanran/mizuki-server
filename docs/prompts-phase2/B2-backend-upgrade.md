# 任务：二期 B2 —— 目录浏览、WebP、控制台历史与相册对齐（后端为主，含少量前端）

## 0. 任务定位
二期第二批（B1 已合入）。范围一句话：完成 R2-2（目录浏览端点 + 向导树形
点选器）、R2-7（上传保留原格式）、R2-10（增量式：既有控制台功能一行不动，仅加 task_run 持久化 + 任务模板配置 + 历史记录 UI）+ R2-16（包管理器确定性解析）、R2-14（相册外部源/加密标记/items 合并输出 + 前端分页）。

## 1. 上下文注入
1. docs/REQUIREMENTS-PHASE2.md：上述条目全文
2. docs/prompts/P7-media-albums.md 与 P8 报告（既有上传管线与注册表现状）
3. docs/prompts/P9-process.md 与其交付报告（SSE/环形缓冲/停机机制现状）
4. docs/SESSIONS.md P10b 报告踩坑 1（corepack shim PATH 顺序问题）——R2-16 是它的工程化正解。
5. docs/decisions/ADR-006（魔数嗅探定案——本阶段沿用不推翻）
6. docs/SESSIONS.md P10d/P11 报告（幽灵代码教训：否决即删码）

## 2. 实现文件清单
后端：
- 迁移：新增 task_run 表（drizzle 迁移文件 + schema.ts 增表）
- 转正/新建：modules/system 目录浏览 handler（并入 system.controller.ts 或
  新建 browse.controller.ts，取简者）、modules/media/media.service.ts 与
  modules/posts/posts.service.ts 中的转换分支改造、
  modules/process/{process-manager.service.ts 增强持久化钩子,
  process-runs.controller.ts 新建}
- 修改：app-config.ts（tasks 模板 schema 扩展）、system controller（status
  响应确认含 mode，缺则补——记补白）、albums service/info 处理（items 合并
  输出 + encrypted/source 字段）
  前端：
- InitWizardView.vue 新增目录树点选组件（el-tree 手写懒加载，调
  browse-dirs）、ConsolePage.vue 增加历史记录区
  依赖：前后端均零新增。

## 3. 详细规格
全部按 R2 条目执行；五处强调：
- browse-dirs 安全三闸：safeJoin 全程、跳过 symlink、需认证；isMizuki 标记
  复用 MizukiDetectorService 的静态存在性检查（不发起新检测流程）；
- WebP 语义：sharp 保持格式 requires 元数据剥离一并生效；GIF 保留动图首帧
  还是大文件原样由实施者决定并记报告（倾向原样）；
- task_run.log_text 尾部截断策略与内存环形缓冲一致（保留最新）；
- tasks 模板默认值 = 当前硬编码的四任务命令，保证老配置零破坏；
  shell 字段合法枚举 ['default','pwsh','cmd','bash']，其他值启动报错；
- R2-16 按规格执行：解析链 = 目标项目 .bin 垫片 → 全局；.cmd/.bat 一律
  提取其内指向的 js 入口改用 process.execPath 直跑，shell:false 红线不动；
  解析失败的报错必须包含人类可读的诊断指引（如检测到多版本共存或垫片悬空）。

## 4. 接线
process-run 持久化经 EventEmitter 既有任务事件订阅实现（订阅 exit 事件），
不改广播行为；新表入 DbModule 既有一体迁移。

## 5. 禁止事项
继承一期七条。专属：
- 不得触碰进程白名单机制与 shell:false 安全条款（config 模板仅换具体的
  cmd/args/shell 取值）；
- 公开端点输出扩展必须向后兼容（新增字段允许，改名/删除禁止）；
- 服务端永不抓取外部相册 URL 内容（SSRF）；
- ADR-010 必须撰写（废止一期转 JPG 决策的理由与影响面）。
- 不得以 shell:true 或额外 cmd /c 中转来『修好』spawn .cmd 的问题——那等于
  绕过白名单安全模型；唯一正解是解析到真实 js 入口直跑
  （docs/decisions/ADR-011-package-manager-deterministic-resolution.md）。

## 6. 验收
先跑三连全绿（累计 ≥253 用例；B2 收尾后下限 ≥256，含 R2-16 相关 ≥3 条，基线上继续只增不减）。随后逐项：
1. browse-dirs e2e：根列表 >0；带 path 枚举 fixture 项目子目录正确且
   diary/src/data 命中 isMizuki=true；../ 注入 403/400；无 token 401；
2. WebP e2e：上传 .webp → 产物 format='webp' 且 exif undefined；
   旧 jpg/png 回归产物格式不变；info.json 文件名后缀跟随；
3. task_run e2e：启动 build → 完成后 GET runs 列表出现且字段齐全 →
   GET :id 日志非空 → DELETE → 再查 404；
4. 模板配置 e2e：config.json 设 build.shell='pwsh' + 自定义 args → 启动
   spawn 参数命中；设 shell='evil' → 启动校验 500 且原因清晰；
5. 相册 e2e：建含 external urls 的 info.json → /public/albums（与 admin
   列表）items 含 url 项；encrypted:true 透传；本地+外部排序稳定；
6. 向导树形点选人工核验（含触达深层的回退路径）；
7. 包管理器解析 e2e：夹具 mini-project 含 pnpm-lock.yaml → 启动 build 任务
   断言 spawns 数组首元素为 process.execPath、第二元素以 .cjs/.js 结尾；
   人为制造悬空垫片（指向不存在路径）→ 失败报错含诊断指引文案而非原始
   ENOENT；
8. 回归项补记：本阶段完成后累计用例数下限 = 原基线 + 本阶段新增
   （R2-16 相关 ≥3 条）。
9. 回归：P1–P11 全部既有用例绿（尤其 P7 上传组、P9 进程组、P11 冒烟组）。

## 7. 交付报告
同 B1 格式；《B2 手动走查清单》；CHANGELOG/SESSIONS 追加 Phase2-B2。

## 8. 冲突处理
同一期八条。特别提醒：遇到「既有代码与 R2-7/14 语义冲突需要改 PROMPT 而非
代码」的情况——停下上报，不要绕过 P7/P9 阶段提示词的任何字面承诺。
