# Mizuki-Server 需求规格书（REQUIREMENTS）

| 项 | 值 |
|---|---|
| 版本 | 1.0（最终版，替代旧《Mizuki-Server 项目总结》） |
| 日期 | 2026-08-25 |
| 状态 | 已确认 |

## 0. 文档定位（AI 会话必读）

本仓库有两份事实来源，分工如下：

| 文档 | 职责 | 冲突时优先级 |
|---|---|---|
| **本文档（REQUIREMENTS）** | 字段级 / 行为级需求：内容数据结构、功能行为、约束 | **数据字段、功能行为以本文档为准** |
| `docs/MASTER-PLAN.md` | 架构级方案：数据库表结构、REST API 路径、模块拆分、实现方案 | **表结构、API 路径、阶段划分以 MASTER-PLAN 为准** |

各阶段提示词的 §1 上下文注入必须引用本文档相应章节。旧版需求文档中所有 Java 时期的技术决议已废弃，见附录 A；**任何 AI 会话不得重新引入已废弃决议**。

---

## 1. 项目定位与目标

### 1.1 项目目标

Mizuki-Server 是为 Mizuki 博客主题（基于 Astro 的静态博客主题）开发的服务端程序，需具备：

1. 本地可视化管理 Mizuki 博客项目；
2. 管理文章、日记、友链、项目、时间线、技能、设备、相册等内容；
3. 可选为 Mizuki 接入后端 API，实现动态文章、评论、统计等能力；
4. 提供远程公开 API，供博客前端获取文章、日记等信息；
5. 尽可能安全，防止注入、越权、文件穿越等攻击；
6. 支持后续内嵌 AI 功能，但第一阶段不作为核心功能。

### 1.2 技术策略（已定版，锁定）

1. 全栈 TypeScript：后端 Node.js + NestJS，管理面板 Vue 3，与 Mizuki（TS 项目）同语言生态；
2. **不引入 Java、Python 等第二运行时**；原 Python 管理器 app.py 仅作为功能行为参考，不作为运行依赖；
3. 调用 Node 工具链（npm/pnpm/yarn）执行 Astro 构建与预览；
4. 具体版本与依赖清单见 MASTER-PLAN §1，以仓库 `apps/server/package.json` 与 lockfile 为最终事实。

### 1.3 工作区结构

- Mizuki 原项目目录（用户指定，运行时探测）；
- Mizuki-Server 工程目录（本仓库，pnpm monorepo）；
- `apps/server/data/`：config.json（服务配置）、mizuki.db（SQLite）、backups/（备份）；
- `apps/server/test/fixtures/mizuki/`：测试用假 Mizuki 项目，**测试一律使用它，绝不允许触碰真实 Mizuki 目录**。

---

## 2. 运行形态

### 2.1 本地管理面板

1. 默认通过 `localhost:20154` 访问（端口可经环境变量覆盖）；
2. 体验类似本地桌面软件，用于初始化、配置、内容管理、构建预览；
3. 管理面板默认只监听本地。

### 2.2 远程公开 API

1. 需支持远程访问，供博客前端获取文章、日记、友链、项目等信息；
2. 公开 API 与管理接口**必须分离**（路径、认证、限流策略均独立）；
3. 管理接口强认证；公开接口无需认证但有限流。

### 2.3 构建、预览、进程管理

管理面板内需支持：安装依赖、启动开发预览、执行构建、预览站点、查看实时构建日志、停止进程、端口占用检测。实现约束（命令白名单、`shell:false`、工作目录限制、进程组停止）见 MASTER-PLAN §7。

---

## 3. Mizuki 项目改造三模式

初始化时用户选择 Mizuki 目录，服务端检测其有效性（检测规则见 MASTER-PLAN §4.3），随后选择运行模式并存入配置：

### 模式一：仅管理模式（无侵入）— MVP 完整实现

不修改 Mizuki 原项目任何文件结构（仅按需写入其内容数据文件，见 §6）。提供：内容管理、图片/相册管理、about 管理、备份恢复、构建预览。

### 模式二：新增文件接入（低侵入）— 二期

只**新增**文件接入后端能力（API 客户端、评论组件、动态文章组件、配置文件、脚本、样式），不覆盖原文件。

### 模式三：覆盖文件接入（高侵入）— 二期

允许修改/覆盖 Mizuki 原文件，接入完整后端能力。

### 侵入式操作通用铁律（适用于一切覆盖/删除行为，含模式一内的数据文件写入）

1. 用户明确确认；2. 自动备份；3. 可回滚；4. 记录操作日志；5. 失败不得破坏原项目。

---

## 4. 文章体系

### 4.1 双类型文章

系统同时支持两种文章，**在数据库中有明确标识**：

| source_type | 存储位置 | 加载方式 |
|---|---|---|
| `'markdown'` | Mizuki 项目内 `src/content/posts/` | Astro 静态构建 |
| `'richtext'` | Mizuki-Server 数据库 | API 动态获取 |

### 4.2 Markdown 文章

保存在 Mizuki 原项目中，可被 Astro 静态构建；博客打开时可直接加载静态页面。保留 Mizuki 原本的静态博客特性。

### 4.3 富文本文章

由后台所见即所得编辑器创建，正文保存到数据库（结构化 JSON 为信任源），经 API 动态获取；公开输出 HTML 前必须过 XSS 过滤。

### 4.4 前端混合加载策略

1. 首屏/部分文章由 Astro 静态生成（Markdown）；
2. 更多文章通过分页 API 从 Mizuki-Server 获取；
3. 文章列表必须**聚合两类来源**，按发布时间降序统一分页。

### 4.5 类型标识规范

数据库统一文章索引表中：`source_type ∈ {'markdown','richtext'}`；markdown 文章记录 `file_path` + `file_hash`（sha256，同步扫描用）；richtext 文章关联 `article_content` 表。渲染方式由 source_type 派生，不单独存储字段。

---

## 5. Mizuki 设置接管范围

尽可能通过 `localhost:20154` 可视化接管以下配置，替代手动改代码：

1. 网站基础信息、主题配置、导航配置、社交链接、功能开关；
2. `src/data/` 下全部数据文件（见 §6）；
3. Mizuki 的 `config` / 主题配置文件中原本需要改 JS/TS/JSON 的内容。

---

## 6. 内容数据规格（本文件核心：字段级）

### 6.0 通用约定（适用于 6.2–6.11 全部内容类型）

1. **文件即数据库**：六类集合内容（diary/friends/projects/timeline/skills/devices）的唯一事实来源是 Mizuki 项目内 TS 数据文件，**不为其建数据库表**（架构决议，见附录 A.3）；
2. 所有对 Mizuki 目录的写入必须经过统一管线：路径校验 → zod 校验 → 语法校验 → 备份 → 原子写入（见 MASTER-PLAN §2 决策 3）；
3. `id` 字段：新建条目若未提供，由服务端自动生成（nanoid）；
4. 日期字段：ISO 8601 字符串；
5. ⚠ **字段类型以 Mizuki 项目内真实 interface 定义为准**。下表类型为规格基线；实现前（P4/P5/P7）须与真实 Mizuki 源码核对，偏差记 ADR，**不得静默修改字段名**。

### 6.1 Mizuki-Server 自身配置

- 位置：`apps/server/data/config.json`（数据库可用之前即需读取）；
- 内容：Mizuki 项目根路径、运行模式、备份目录、上传限制等；
- 读取时必须经 zod 校验，非法配置启动即报错。
- ~~interfaces.json~~：**已废弃**（ts-morph 原生保留 interface，无需辅助回写文件，见附录 A.4）。

### 6.2 TS 数据文件通用规格

- 位置：`src/data/*.ts`，形式为 `export const xxxData: SomeType = [...]` 或对象；
- 读取与回写必须基于 AST（ts-morph），**禁止**括号计数 / 正则 / JSON5 文本 hack（旧 app.py 方案已废弃）；
- 读写能力必须覆盖：数组与对象、嵌套结构、单/双引号、模板字符串（无插值）、注释、尾随逗号、`as const`、`satisfies`；
- 写回时保留文件内 interface、type、import、数据块以外的全部内容（逐字节不变）；
- 实现规格见 MASTER-PLAN §6。

### 6.3 diary 日记

文件 `src/data/diary.ts`，变量 `diaryData`（数组）。图片目录 `public/images/diary`。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | |
| content | string | 是 | 正文 |
| date | string | 是 | ISO 8601 |
| images | string[] | 否 | 目录内文件名 |
| location | string | 否 | |
| mood | string | 否 | |
| tags | string[] | 否 | |

功能：列表 / 详情 / 创建 / 修改 / 删除 / 上传日记图片 / 标签管理（从条目聚合派生，不单独存储）。

### 6.4 friends 友链

文件 `src/data/friends.ts`，变量 `friendsData`（数组）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | |
| title | string | 是 | 站点名 |
| imgurl | string | 是 | 头像 URL |
| desc | string | 否 | 描述 |
| siteurl | string | 是 | 站点 URL |
| tags | string[] | 否 | |

功能：CRUD / 友链标签管理。

### 6.5 projects 项目

文件 `src/data/projects.ts`，变量 `projectsData`（数组）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | |
| title | string | 是 | |
| description | string | 否 | |
| image | string | 否 | 封面 |
| category | string | 否 | |
| techStack | string[] | 否 | |
| status | string | 否 | 项目状态 |
| liveDemo | string | 否 | URL |
| sourceCode | string | 否 | URL |
| startDate | string | 否 | |
| endDate | string | 否 | |
| featured | boolean | 否 | |
| tags | string[] | 否 | |
| visitUrl | string | 否 | |

功能：CRUD / 封面管理 / 技术栈管理 / 状态管理。

### 6.6 timeline 时间线

文件 `src/data/timeline.ts`，变量 `timelineData`（数组）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | |
| title | string | 是 | |
| description | string | 否 | |
| type | `'education' \| 'certificate' \| 'project' \| 'other'` | 是 | |
| icon | string | 否 | 可按 type 自动设置 |
| color | string | 否 | 可按 type 自动设置 |
| startDate | string | 是 | |
| location | string | 否 | |
| organization | string | 否 | |
| skills | string[] | 否 | |
| featured | boolean | 否 | |

功能：CRUD；**按 type 自动设置默认 icon/color**（默认映射表实现时从 Mizuki 主题源码确认并记 ADR）。

### 6.7 skills 技能

文件 `src/data/skills.ts`，变量 `skillsData`（数组）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | |
| name | string | 是 | |
| description | string | 否 | |
| icon | string | 否 | |
| category | string | 否 | |
| level | number | 否 | 熟练度（刻度以 Mizuki interface 为准） |
| experience | `{ years: number, months: number }` | 否 | |
| color | string | 否 | |

功能：CRUD / 经验年限设置 / 熟练度设置 / 图标颜色设置。

### 6.8 devices 设备

文件 `src/data/devices.ts`，变量 `devicesData`。**结构为按分类分组的对象**：`{ [分类名: string]: Device[] }`。图片目录 `public/images/device`。

Device 字段（`name` 为分组内标识）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| name | string | 是 | 分组内唯一 |
| image | string | 否 | |
| specs | string | 否 | ⚠ 结构以 Mizuki interface 为准 |
| description | string | 否 | |
| link | string | 否 | |

功能：分类与设备列表 / 设备 CRUD / 创建分类 / 上传设备图片 / **删除设备后自动清理空分类**。

### 6.9 albums 相册

目录 `public/images/albums/<相册名>/`，内含图片文件与 `info.json`。

info.json 字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 是 | |
| description | string | 否 | |
| date | string | 否 | |
| location | string | 否 | |
| tags | string[] | 否 | |
| layout | string | 否 | 布局方式 |
| columns | number | 否 | 列数 |

功能：相册列表 / 创建 / 修改 / 删除 / 上传图片 / 上传封面 / 删除图片 / 图片预览 / **非 JPG 图片自动转 JPG**。

### 6.10 posts 文章

目录约定：`src/content/posts/<slug>/index.md` + 封面图片（如 cover.jpg）。

frontmatter 字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 是 | |
| published | boolean | 否 | ⚠ 类型以 Mizuki 为准（可能为日期） |
| description | string | 否 | SEO 摘要 |
| tags | string[] | 否 | |
| category | string | 否 | |
| author | string | 否 | |
| permalink | string | 否 | |
| pinned | boolean | 否 | 置顶 |
| draft | boolean | 否 | 草稿 |
| image | string | 否 | 封面引用 |
| date | string | 否 | 创建日期 |
| pubDate | string | 否 | 发布日期 |

功能：列表 / 读内容 / 创建 / 修改 / 删除 / 上传 Markdown 文件 / 上传封面（转 JPG）/ frontmatter 保存（**往返保真**：字段与类型不丢失）/ 草稿管理 / 置顶管理 / 同步重建数据库索引（file_hash 用 sha256，幂等）。

### 6.11 about 页

文件 `src/content/spec/about.md`。功能：上传 / 编辑 / 保存前备份 / 支持回滚。

---

## 7. 后台管理功能清单

1. **初始化向导**：欢迎 → 选择 Mizuki 目录 → 检测并展示结果 → 选择运行模式（§3）→ 设置管理员账号 → 完成（SQLite 自动创建，无需用户配置数据库）；初始化仅可执行一次；
2. **仪表盘**：项目/服务状态、文章数、草稿数、日记数、友链数、相册数、备份状态、最近操作日志；
3. **文章管理**：列表、新建（Markdown / 富文本）、编辑、删除、草稿箱、回收站、标签、分类、封面、置顶、发布时间、SEO 描述、预览；
4. **富文本编辑器**：所见即所得，支持标题/列表/引用/代码块/图片/链接/表格，保存为结构化 JSON，可导出 HTML 与 Markdown；
5. **内容模块管理**：§6.3–6.11 全部能力；
6. **设置管理**：站点、主题、导航、社交链接、功能开关、API/端口/上传/备份目录设置；
7. **文件与媒体管理**：上传、列表、删除（**先做引用检查**）、重命名、链接复制、格式转换、防止删除被引用图片；
8. **备份与回滚**：手动/自动备份（Mizuki 文件、数据库、配置）、备份列表、恢复（须 confirm）、删除备份、覆盖前自动快照、一键回滚；
9. **构建与预览**：安装依赖、开发服务、构建、预览、停止、实时日志、端口检测。

---

## 8. 用户与权限

**角色**：管理员（博客所有者）/ 普通访客。

- 管理员：登录后台、管理全部内容与配置、备份回滚、构建预览；
- 访客：浏览博客、获取公开内容、发表评论（评论系统二期启用，需昵称，可选邮箱/网址）、**不得访问任何管理接口**。

**认证**：账号密码登录；密码 argon2id 哈希存储；JWT 双 Token（access + refresh，支持过期与刷新）；管理接口必须校验 JWT；登录失败计数与锁定；操作日志不得记录密码/Token。

---

## 9. 安全需求

威胁目标：SQL 注入、命令注入、路径穿越、XSS、未授权访问、恶意上传、SSRF、越权、敏感信息泄露；所有危险操作可审计。

措施（与栈绑定）：

1. SQL：Drizzle ORM 全参数化，禁止拼接 SQL；
2. 输入：所有边界输入过 zod 校验；
3. 路径：所有文件路径经统一"路径监狱"（resolve + 前缀校验 + realpath 防符号链接逃逸），限制在 Mizuki 目录与上传目录内；
4. 命令：子进程仅白名单任务、`shell:false`、工作目录锁定、进程组停止；
5. 上传：扩展名白名单 + 魔数嗅探 + 大小限制 + 随机文件名 + sharp 重编码（顺带去 EXIF 与内嵌 payload）；
6. XSS：富文本存结构化 JSON（信任源），公开输出 HTML 一律过 sanitize-html；Markdown 渲染输出同样过滤；
7. SSRF：MVP 服务端不主动请求用户提供的 URL；后续若实现（友链头像抓取等）必须做内网地址校验；
8. CORS 明确白名单（默认仅 localhost）；公开路由全局限流，登录路由独立严格限流；
9. 危险操作（覆盖/删除/恢复）必须：确认 + 备份 + 操作日志；
10. 依赖保持更新，lockfile 锁定，定期 `pnpm audit`。

---

## 10. 数据持久化需求

1. 数据库：SQLite（better-sqlite3），文件 `apps/server/data/mizuki.db`，Drizzle ORM + drizzle-kit 迁移；
2. 设计须兼容后续迁移 PostgreSQL / MySQL（标准 SQL 类型、不依赖 SQLite 专有函数）；
3. **必须入库**（11 张表，字段见 MASTER-PLAN §3）：admin_user、article（统一索引）、article_content（富文本正文）、category、tag、article_tag、comment（建表，二期启用）、operation_log、backup_record、media_file、site_setting；
4. **必须不入库**：六类集合内容（文件即数据库，§6.0）；
5. 数据库文件与运行时产物不进 git。

---

## 11. API 需求

分三类，**精确路径以 MASTER-PLAN §5 为准**：

1. **系统 API**：健康检查、状态、Mizuki 目录检测、初始化（一次性）；
2. **管理 API**（全部需 JWT）：认证（登录/刷新/登出/me）、六类集合 CRUD、posts、富文本文章、相册、媒体、备份、构建/预览任务（含 SSE 日志）、设置；
3. **公开 API**（无需认证 + 限流）：混合文章列表与详情、六类集合只读、相册；（二期）评论读取与提交。

---

## 12. 技术栈（锁定，变更须走 ADR）

Node.js ≥22 LTS / TypeScript ≥5.5（strict）/ pnpm monorepo / NestJS ≥11 / Drizzle + better-sqlite3 / ts-morph / zod / jose + argon2 / cross-spawn + tree-kill / sharp / gray-matter + marked + sanitize-html / Vitest + supertest / 管理面板 Vue 3 + Element Plus + TipTap + CodeMirror 6。完整清单见 MASTER-PLAN §1。

---

## 13. 版本规划

- **MVP（P0–P11）**：可启动服务、初始化向导、登录、六类内容管理、Markdown 文章、富文本文章、混合列表公开 API、媒体/相册、备份回滚、构建预览、管理面板、基础安全；
- **二期**：评论系统、友链申请审核、媒体库完善、文件 diff、模式二/三前端侧接入、富文本前端渲染完善；
- **三期**：浏览量统计、点赞、动态说说、全文搜索、访客分析、RSS、缓存、PG/MySQL 迁移；
- **四期**：内嵌 AI（摘要/标签推荐/评论审核/辅助写作/自动修复配置）、插件系统、多主题。

MVP 明确不做：完整评论、统计、搜索、AI、多主题、插件、自动部署。

---

## 14. 开发方式：分阶段 AI 提示词驱动

1. 每阶段一个会话，规格存于 `docs/prompts/`，顺序见其 INDEX.md；
2. 每阶段必须通过可机械执行的验收（测试 + 命令）才可进入下一阶段；
3. 人工关卡：P0b（数据库定型）、P3（数据文件引擎）、P6（安全边界）、P8（公开 API 定型，此后路径不再变更）；
4. 测试一律使用 fixture 假项目；所有写入走统一管线；规格歧义选更简单方案并记 ADR；
5. 完整规则见各阶段提示词及 MASTER-PLAN §9。

---

## 15. 硬性约束清单（MUST）

1. 默认地址 localhost:20154，全局前缀 /api/v1；
2. 管理接口与公开接口分离，前者强认证、后者限流；
3. 技术栈锁定 Node/TS，无第二运行时；
4. app.py 能力以 ts-morph AST 方案复刻，禁止文本 hack；
5. 保留 Mizuki 静态文章能力，Markdown 静态加载、富文本走数据库；
6. 文章类型在数据库明确标识（§4.5）；
7. 六类集合内容不建数据库表；
8. 覆盖/删除 Mizuki 文件必须：通知确认 + 备份 + 可回滚 + 日志；
9. JWT 登录与权限体系，密码 argon2 哈希；
10. 删除操作优先备份/回收站；
11. 高安全基线：防注入/越权/穿越/XSS/命令注入（§9）；
12. 网页内可启动/构建/预览/停止 Mizuki；
13. 先 MVP，AI 功能后置；
14. 公开 API 路径 P8 定型后不再变更。
15. 领域模块禁止互 import（lint 强制），跨模块交互仅走 §16 三通道；
16. 事件发射点位于写入管线成功出口，恰好一次；订阅者幂等且不冒泡异常。

---

## 16. 解耦与互动需求

1. 领域模块（modules/ 下内容模块）禁止互相 import，eslint-plugin-boundaries
   error 级机械化强制；
2. 跨模块交互仅限三通道：事件目录（异步）、贡献者注册表（同步反查）、共享层提升；
3. 事件目录（名称、payload schema）集中定义于 packages/shared，新增事件只改该文件；
4. 媒体引用检查经注册表反转：任何模块新增"内容引用图片"能力时自注册检查器，
   media 模块零改动；
5. 新增内容类型 / 新增反应型功能（搜索索引、webhook、AI）不得修改既有领域模块代码
   （开闭原则，为四期插件系统铺路）；
6. 事件订阅者幂等、异常内部捕获记日志，不影响发起请求。

---

## 附录 A：对旧版需求文档（Java 时期）的废弃决议

| # | 旧决议 | 新决议 | 理由 |
|---|---|---|---|
| A.1 | 主体后端 Java / Spring Boot | **废弃** → Node.js + NestJS | TS 数据文件 AST 操作、与前端共享类型、运行时零额外成本、npm 工具链集成（完整论证见技术选型讨论） |
| A.2 | H2 Database（后续 MySQL/PG） | **废弃** → SQLite（better-sqlite3）+ Drizzle | 零配置内嵌，迁移路径不变 |
| A.3 | 为 diary/friend_link/project/timeline/skill/device/album 等建 24 张表 | **废弃** → 文件即数据库，仅 11 张表 | 消除双数据源同步问题，TS 文件是唯一事实来源 |
| A.4 | interfaces.json 辅助回写 TS interface | **废弃** | ts-morph 原生保留 interface，无需辅助文件 |
| A.5 | source_type 取值 STATIC_MARKDOWN / RICH_TEXT_DB | **废弃** → `'markdown'` / `'richtext'` | 对齐 MASTER-PLAN §3 |
| A.6 | render_type 单独存储 | **废弃** → 由 source_type 派生 | 消除冗余字段 |
| A.7 | app.py 括号平衡 + JSON5 解析方案 | **废弃** → ts-morph AST 求值 | 从根本解决可靠性，注释/引号/尾随逗号天然兼容 |
| A.8 | Spring Security / Sa-Token | **废弃** → jose（JWT）+ argon2 | 同栈实现 |
| A.9 | Python app.py 长期依赖 | **废弃** → 仅作行为参考 | 单一运行时 |

> 任何 AI 会话若发现代码或文档中出现已废弃决议的实现倾向，必须停下报告，不得延续。
