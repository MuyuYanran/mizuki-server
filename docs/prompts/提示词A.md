---
提示词 A：阶段提示词生成器（生成会话用）
---

# 任务：生成 Mizuki-Server P0b–P11 全部阶段提示词

## 0. 任务定位

你是 Mizuki-Server 项目的提示词工程师。项目采用分阶段提示词驱动开发，P0a（仓库骨架）已完成。本会话任务：**为剩余全部阶段编写开发提示词，存档到 `docs/prompts/`**。

本会话是纯文档会话：
1. 只允许创建/修改 `docs/prompts/` 下的 .md 文件；
2. 禁止编写任何业务代码、禁止修改 `src/` 下任何文件、禁止修改 MASTER-PLAN / REQUIREMENTS / STRUCTURE；
3. 若发现必读文件缺失或仍为占位内容，立即停止并报告。

## 1. 必读输入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md` — 架构级唯一事实来源（技术栈、数据库 11 表、API 清单、ts-morph 引擎规格、安全要求、路线图）
2. `docs/REQUIREMENTS.md` — 字段级唯一事实来源（六类内容字段、posts frontmatter 字段、相册 info.json、后台功能清单、原 app.py 行为）
3. `docs/prompts/P0a-scaffold.md` — 提示词格式样板，所有生成物必须与之同构
4. `docs/STRUCTURE.md` — 目录结构与模块→阶段映射
5. `apps/server/src` 下全部 stub 文件的头注释（每份阶段提示词的"实现文件清单"必须与 stub 标注一致）
6. `docs/decisions/` 全部 ADR — 注意 P0a 勘误：`@types/tree-kill` 已移除，后续提示词不得再引用
7. `CHANGELOG.md`

两份事实来源冲突时：**数据库表结构、API 路径、阶段划分以 MASTER-PLAN 为准；数据字段、功能行为以 REQUIREMENTS 为准**。仍有矛盾则按 §8 停下报告。

## 2. 生成物清单（固定，不得增删）

`docs/prompts/` 下：
- `INDEX.md`：阶段顺序表（阶段号 / 文件名 / 前置依赖 / 一句话范围 / 验收摘要）
- `P0b-config-db-exception.md`
- `P1-security-foundation.md`
- `P2-backup.md`
- `P3-data-files-engine.md`
- `P4-collections.md`
- `P5-posts.md`
- `P6-auth-init.md`
- `P7-media-albums.md`
- `P8-articles-public-api.md`
- `P9-process.md`
- `P10a-web-shell.md`、`P10b-web-collections.md`、`P10c-web-editor.md`、`P10d-web-console.md`
- `P11-finalize.md`

共 15 份提示词 + 1 份 INDEX。除 P10 按上表拆四份外，禁止拆分其他阶段；若你认为某阶段规模必须再拆，停下报告，不得自行拆。

## 3. 提示词模板（每份严格遵循，与 P0a 同构八节）

- **§0 任务定位**：阶段号、前置依赖阶段、本会话范围一句话、明确的"只做本阶段"声明
- **§1 上下文注入**：执行 AI 必读文件路径（MASTER-PLAN/REQUIREMENTS 的具体章节号、前一阶段 CHANGELOG 条目、相关 ADR、本阶段涉及的 stub 路径）
- **§2 实现文件清单**：精确到路径，列出"本次转正的 stub"；同时列出**禁止实现**的其他 stub，防越界
- **§3 详细规格**：从两份事实来源派生，具体到表/字段/路径/行为规则
- **§4 接线说明**：模块注册、全局管道/守卫/过滤器挂载、依赖注入关系
- **§5 禁止事项**：逐字继承 P0a §5 全部 7 条 + 本阶段专属禁止（见 §4 锚点表）
- **§6 验收标准**：全部可机械执行——每条是命令或测试断言；必须以 `pnpm test && pnpm build && pnpm lint` 开头
- **§7 交付报告要求**（文件清单、测试结果、偏差清单）
- **§8 冲突处理**：逐字继承 P0a §8（停下→报告→≤2 候选方案→等人工）

## 4. 内容映射与规格锚点（防稀释核心——生成每份后逐项自检是否覆盖）

> **防稀释声明**：生成器会"概括"它读到的规格，所以必须把事件规格钉进锚点表，防止被稀释。以下所有锚点均为硬性要求，逐字搬运，不得概括、省略或"优化"。

### P0b config / DB / 异常过滤器
- 文件：`app-config.ts`、`infra/db/schema.ts`、`infra/db/migrate.ts`、`common/filters/all-exceptions.filter.ts`；`app.setup.ts` 追加全局过滤器
- 锚点：11 张表**逐字**搬自 MASTER-PLAN §3（admin_user / article / article_content / category / tag / article_tag / comment / operation_log / backup_record / media_file / site_setting）；时间戳一律 `integer({mode:'timestamp'})`；`data/config.json` 用 zod 校验；启动时自动执行迁移；未知异常统一 `{code, message, detail}`
- 事件与分层基建锚点：依赖 `@nestjs/event-emitter`；根加 `eslint-plugin-boundaries` 并配置 MASTER-PLAN §4.4 分层规则；创建 `shared/src/events.ts`（常量 + zod payload，照搬 MASTER-PLAN §4.4）；验收含"故意跨模块 import 被 lint 拒绝"
- 测试：迁移后用 sqlite_master 断言 11 表存在；config 非法值报错；过滤器对 HttpException 与未知异常两种单测
- 专属禁止：不得创建任何业务 service；不得读写 Mizuki 目录任何文件

### P1 安全基建
- 文件：`safe-join.ts`、`zod-validation.pipe.ts`；`app.setup.ts` 追加 helmet / CORS 白名单（默认仅 localhost）/ 全局 zod pipe / 全局 throttler
- 锚点：safeJoin = resolve + 前缀校验 + 已存在祖先 realpath（防符号链接逃逸）；攻击用例单测**必须**覆盖：`../`、绝对路径、`..\`、URL 编码、空字节、symlink 逃逸；throttler 全局 60 次/分/IP（登录路由 5 次/分在 P6 挂到 auth 时启用）
- 测试：safe-join ≥8 个攻击用例 + 正常用例；zod pipe 拒绝非法 body
- 专属禁止：**禁止实现 JWT 守卫**（P6 的活）

### P2 备份
- 文件：`infra/backup/backup.service.ts`、`modules/backup/*`
- 锚点：`data/backups/<时间戳-nanoid>/` + manifest.json（原路径 + sha256）；scope ∈ pre_write/manual/db；pre_write 只备目标文件、每文件保留 10 份自动清理；db 备份用 better-sqlite3 `.backup()`；restore 前先对当前状态备份 + body 须含 `confirm:true`；REST：POST / GET / POST :id/restore / DELETE :id（+ POST full scope）
- 测试：tmp 目录中 备份→篡改→恢复→哈希一致；保留策略清理；manifest 完整性

### P3 数据文件引擎（全项目地基，规格最重）
- 文件：`modules/data-files/` 全部 7 文件 + `test/fixtures/mizuki/` 假项目（6 个数据文件，刻意覆盖：块/行注释、单引号、尾随逗号、`as const`、`satisfies`、嵌套对象、字符串含引号与换行）
- 锚点：**逐字搬 MASTER-PLAN §6 全部规格**——每次操作新建一次性 Project；`getVariableDeclaration(varName)`；astToValue 节点分派表（Array/Object/String/NoSubTemplate/Numeric/True/False/Null/As/Satisfies/Parenthesized/一元负号 → 递归；TemplateExpression/Identifier/PropertyAccess/Spread/Shorthand → 抛错带文件名行号）；valueToTsLiteral（JSON.stringify + 去键引号正则）；写管线 8 步顺序不可变（读盘记哈希→AST 求值→深拷贝 mutate→zod 整体校验→生成文本+`ts.transpileModule` 语法零错→磁盘哈希陈旧检测（冲突重试 1 次后 409）→pre_write 备份→临时文件+rename 原子写→失效缓存）；file-lock 用 `Map<path, Promise>` 串行同文件；mtime+size 读缓存
- 测试：golden-file 三断言——①读改写读往返值正确；②**写后初始化表达式以外的字节与原文件逐字节一致**；③不支持节点报错含行号
- 专属禁止：禁止引入 JSON5、禁止正则/括号计数等文本 hack（这正是弃用 app.py 方案的原因）

### P4 集合 CRUD
- 文件：`modules/collections/*`（registry / controller / service）+ `packages/shared/src/collections/` 六个 zod schema（schema 放 shared 供 P10 表单复用——须在提示词中写明此动机）
- 锚点：CollectionDef 结构逐字（type/file/varName/shape/idField/imageDir/public）；六类配置逐字（diary→diaryData、friends→friendsData、projects→projectsData、timeline→timelineData、skills→skillsData 均 array；devices→devicesData 为 grouped、idField=name、空分组自动清理）；每类 itemSchema 字段以 REQUIREMENTS §6.3–6.8 为准；`:type` 必须先对注册表白名单校验；API：GET/POST/PATCH/DELETE `/admin/collections/:type(/:id)`
- 事件锚点：每次写入发射 `content.changed`（e2e 测试订阅者断言）
- 测试：supertest e2e 六类 CRUD + grouped 增删改与空分组清理 + 未知 type 拒绝；写后 fixture 执行 `tsc --noEmit` 通过；`content.changed` 事件发射断言
- 专属禁止：**禁止为六类内容建数据库表**（MASTER-PLAN §2 架构决策 1：文件即数据库）

### P5 Posts（Markdown 文章）
- 文件：`modules/posts/*`
- 锚点：目录约定 `src/content/posts/<slug>/index.md` + 封面；frontmatter 字段以 REQUIREMENTS §6.10 为准；gray-matter 读写，frontmatter 往返保真（字段顺序与类型不丢失）；写入必须走 P2 的 pre_write 备份 + 原子写；封面上传走 sharp 转 JPG；`POST /admin/posts/sync` 重建 article 索引（file_hash 用 sha256）
- 事件锚点：发射 `post.changed` / `article.published`；frontmatter 工具提升至 `common/markdown/`
- 测试：e2e 创建/修改/删除/恢复；frontmatter 往返断言；sync 幂等（跑两次结果一致）；`post.changed` 与 `article.published` 事件发射断言
- 专属禁止：禁止在 P5 实现富文本（P8）

### P6 Auth + 初始化
- 文件：`modules/auth/*`、`jwt-auth.guard.ts`、`public.decorator.ts`、`operation-log.interceptor.ts`、`mizuki-detector.service.ts`；`system.controller.ts` 扩展
- 锚点：argon2id 哈希；jose HS256 双 Token（access+refresh，支持过期与刷新）；全局 guard + @Public 豁免清单（`/public/**`、health、login、refresh、detect）；登录限流 5 次/分 + failed_login_count 锁定；JWT secret 从 config/env 读取；init 一次性（已存在 admin 则 409）；检测规则四项（astro 依赖、astro.config、src/data、src/content/posts）+ lockfile 探测包管理器；操作日志不得记录密码/Token
- 测试：无 Token 访问**每个模块至少一条 admin 路由**断言 401；错误密码计数与锁定；init 二次 409；detector 正反用例
- 专属禁止：secret 硬编码或写入任何日志

### P7 媒体 + 相册
- 文件：`modules/media/*`、`modules/albums/*`
- 锚点：上传管线 = 扩展名白名单 + file-type 魔数嗅探 + 10MB 上限 + 随机文件名 + sharp 重编码（顺带去 EXIF）；删除前引用检查（media_file 与文章封面、六类内容 image 字段交叉引用）；相册 = 目录 + info.json（字段以 REQUIREMENTS §6.9 为准）+ 转 JPG
- 事件锚点：`MediaReferenceContributor` 注册表（接口签名照搬 MASTER-PLAN §4.4），四模块注册，删除被引用时返回 409 + 明细
- 测试：伪造扩展名（改后缀的文本文件）被拒；被引用图片删除被拒（409 + 引用明细）；相册 CRUD 往返；四模块注册断言
- 专属禁止：无

### P8 富文本 + 公开 API
- 文件：`modules/articles/*`、`modules/settings/*`；公开路由
- 锚点：article 表 source_type/file_path/file_hash 设计；富文本存 TipTap JSON（信任源）+ sanitize-html 后的 html_cache；**混合列表分页**：markdown+richtext 按 pub_date 降序聚合（首屏静态、后续分页 API，见 MASTER-PLAN §2 决策 3）；公开 API 全部 @Public + 限流；settings 为 key-value JSON 表
- 事件锚点：articles 订阅 `post.changed` 增量更新索引；公开缓存订阅 `article.published`
- 测试：两源数据交错的分页正确性；`<script>` 注入被清除；未发布文章不出现在公开 API；`post.changed` 触发索引增量更新断言；`article.published` 触发缓存更新断言
- 专属禁止：公开输出任何未经 sanitize 的 HTML

### P9 进程管理
- 文件：`modules/process/*`
- 锚点：任务白名单硬编码 install/dev/build/preview；包管理器按 lockfile 探测；cross-spawn 且 **shell:false**；env 只透传 PATH/HOME/APPDATA；POSIX detached + tree-kill 停整组；日志内存环形缓冲 2000 行 + SSE；端口占用检测
- 事件锚点：发射 `process.finished`
- 测试：对 fixture 项目启停 `npm run dev` 并断言 SSE 收到日志（标 slow）；task 传入 `install;rm -rf /` 之类被白名单拒绝；`process.finished` 事件发射断言
- 专属禁止：shell:true、任何形式的命令字符串拼接

### P10a–d 管理面板（Vue 3 + Element Plus + TipTap + CodeMirror 6）
- P10a：Vite 工程搭建、登录页、主布局与侧边栏导航、路由守卫、请求封装（401 自动 refresh）
- P10b：六类集合管理页——**由 packages/shared 的 zod schema 驱动生成表单**（渲染策略自选但须在提示词中写明并记 ADR）；日记/友链/项目/时间线/技能/设备
- P10c：文章模块——Markdown 编辑（CodeMirror 6 + frontmatter 表单）、富文本（TipTap）、列表/草稿/回收站
- P10d：媒体库、相册、备份恢复 UI、构建预览控制台（SSE 日志终端）、仪表盘（统计卡片）；可选：`GET /admin/events` SSE 转发事件总线供仪表盘实时刷新（做不做须记 ADR）
- 每份含手动验收场景清单；P10d 给端到端场景：登录→建日记→传图→建文章→备份→构建→预览
- 专属禁止：前端绕过 /api/v1 直接操作文件；在任何前端代码中出现 secret

### P11 收尾
- Swagger 按公开/管理/系统分组、根 README、`bin/mizuki-server` 启动脚本（shebang + package.json bin）、对照 MASTER-PLAN §7 安全条款逐项复查并输出复查报告、全量回归
- 验收：全新 clone 后从 `pnpm install` 到面板可用全程无人工改码

## 5. 生成规则

1. **逐字搬运**：表名/列名/API 路径/端口 20154/前缀 /api/v1/pre_write 保留 10 份/限流数值/测试场景清单——复制，禁止改写、概括、"优化"；
2. **验收只许细化不许放宽**：细化 = 把 MASTER-PLAN §8 路线图的验收描述转成命令+断言；
3. **测试下限**：每个后端阶段测试文件 ≥2、用例数 ≥ 该阶段锚点数；
4. **跨阶段一致性**：P4/P5 的 admin 路由在 P6 前无守卫属预期，P6 提示词须包含"为既有全部 admin 路由挂守卫"的验收项；
5. 每份提示词 §1 必须指示执行 AI 先读：本阶段涉及的 MASTER-PLAN/REQUIREMENTS 章节、上一阶段 CHANGELOG 条目、全部 ADR；
6. **事件规格逐字钉入**：事件名称、payload 结构、发射时机、订阅方行为均从 MASTER-PLAN §4.4 逐字复制，禁止概括为"发射相关事件"之类的模糊描述；
7. **事件发射方与订阅方配对**：每个事件在发射方阶段的提示词 §3/§4 中写明发射逻辑，在订阅方阶段的提示词中写明订阅逻辑与验收断言；
8. **注册表模式**：凡涉及 `MediaReferenceContributor` 等注册表接口，接口签名逐字照搬 MASTER-PLAN §4.4，注册方与调用方分属不同阶段时须在两阶段提示词中均写明；
9. **事件目录覆盖检查**：MASTER-PLAN §4.4 每个事件必须出现在发射方阶段的提示词中，且订阅方阶段有对应验收项；生成过程中逐一核对事件清单，遗漏即停下补齐。

## 6. 自检（15 份全部写完后执行，结果写入交付报告）

1. stub 覆盖率：STRUCTURE.md 中每个 stub 恰好出现在一份提示词的 §2；
2. MASTER-PLAN 覆盖率：11 张表 → P0b；§5 每个端点 → 某阶段；§6 全部规格 → P3；§7 安全条款分配至 P1/P6/P7/P8/P9；
3. REQUIREMENTS 覆盖率：六类字段 → P4；frontmatter 字段 → P5；info.json 字段 → P7；后台功能清单 → P10a–d；
4. 验收可执行性：每份抽 3 条，确认能写成命令或断言；
5. §4 锚点表逐项核对；
6. **交互矩阵逐行核对**：事件表的发射方 + 订阅方阶段均有规格；注册表的全部注册方阶段均有注册规格。逐行检查 MASTER-PLAN §4.4 事件清单，确认每个事件的发射方提示词包含发射逻辑描述，订阅方提示词包含订阅逻辑与测试断言；`MediaReferenceContributor` 注册表的每个注册方（四模块）在对应阶段提示词中均有注册规格。

## 7. 交付报告

INDEX 摘要 + 自检结果 + 疑问清单（对规格歧义处列出你的处理方式；重大歧义不得静默决定）。

## 8. 冲突处理

继承 P0a §8：规格矛盾时停下、报告、给 ≤2 候选方案等人工选择，不得静默取舍。