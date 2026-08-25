# 提示词 A 交付报告 — P0b–P11 阶段提示词生成

- 日期：2026-08-25
- 会话性质：纯文档会话（仅创建/修改 `docs/prompts/` 下 .md，未触碰 `src/`、MASTER-PLAN、REQUIREMENTS、STRUCTURE）
- 结论：**15 份阶段提示词 + 1 份 INDEX 全部生成，§6 自检通过（含两处规格缺口补白，见下）**

## 1. 生成物（16 份）

| 文件 | 阶段 | 人工关卡 |
|---|---|---|
| `INDEX.md` | 阶段顺序表 + 事件矩阵速查 + 覆盖说明 | — |
| `P0b-config-db-exception.md` | config / 11 表 / 异常过滤器 / 分层基建 / events 骨架 / pino | ✅ 数据库定型 |
| `P1-security-foundation.md` | safeJoin / zod pipe / helmet / CORS / throttler | |
| `P2-backup.md` | BackupService + manifest + 恢复 + 保留策略 | |
| `P3-data-files-engine.md` | ts-morph 引擎 + 假项目 | ✅ 引擎定型 |
| `P4-collections.md` | 六类集合注册表驱动 CRUD | |
| `P5-posts.md` | Markdown 文章 + about 补白 | |
| `P6-auth-init.md` | Auth + 全局守卫 + 初始化 | ✅ 安全边界 |
| `P7-media-albums.md` | 媒体 / 相册 / 引用注册表 | |
| `P8-articles-public-api.md` | 富文本 + 公开 API | ✅ 公开路径定型 |
| `P9-process.md` | 白名单子进程 + SSE | |
| `P10a-web-shell.md` | 面板外壳 / 登录 / 布局 | |
| `P10b-web-collections.md` | 六类集合页（schema 驱动表单） | |
| `P10c-web-editor.md` | 文章编辑（CodeMirror 6 / TipTap / about） | |
| `P10d-web-console.md` | 媒体 / 备份 / 控制台 / 仪表盘 / 设置 | |
| `P11-finalize.md` | Swagger / README / bin / 安全复查 | |

## 2. §6 自检结果

1. **stub 覆盖率**：45 个 stub 恰好各出现在一份提示词 §2 —— P0b×5（含 drizzle.config.ts）、P1×2、P2×3、P3×7、P4×3、P5×3、P6×7、P7×6、P8×6、P9×3。与 `apps/server/src` 全部头注释阶段标注及 STRUCTURE.md 映射逐一核对一致。✅
2. **MASTER-PLAN 覆盖率**：11 张表 → P0b §3.2（逐字）；§5 全部端点 → system/auth(P6)、collections(P4)、posts+about(P5)、articles+settings(P8)、albums+media(P7)、backup(P2)、process(P9)、public(P8)；§6 全部规格 → P3 §3（节点分派表、8 步管线、golden 三断言逐字）；§7 安全条款 → 路径监狱/上传五件套/进程安全/备份要点/SQL 分配至 P1/P7/P9/P2（复查归 P11）。✅
3. **REQUIREMENTS 覆盖率**：六类字段 → P4 §3.2（§6.3–6.8 逐字）；frontmatter → P5 §3.2（§6.10 逐字）；info.json → P7 §3.3（§6.9 逐字）；后台功能清单九条 → P10a（初始化向导）/P10d（仪表盘、文件媒体、备份、构建预览、设置）/P10b（内容模块）/P10c（文章、富文本、about）。✅
4. **验收可执行性**：每份抽 3 条复核（如 P3「外部字节逐字节一致」、P6「每模块至少一条 admin 路由无 Token 401」、P9「`install;rm -rf /` 被白名单拒绝」），均为命令或断言形式。✅
5. **§4 锚点表**：逐阶段核对生成物，锚点逐字落位（数值未改写：端口 20154、前缀 /api/v1、pre_write 保留 10 份、限流 60/分与登录 5/分、环形缓冲 2000 行、10MB、四检测规则等）。✅
6. **交互矩阵逐行核对**：六事件发射方/订阅方配对完整（见 INDEX 矩阵）；`MediaReferenceContributor` 四注册方分阶段落位（posts/collections/albums 在 P7、articles 在 P8）。✅

### 自检中发现并补白的规格缺口（3 处）

| # | 缺口 | 处理 |
|---|---|---|
| 1 | **about 页**（REQUIREMENTS §6.11）不在任何阶段锚点，但 `content.changed` 的 scope 枚举含 `'about'` 且 REQUIREMENTS §7 第 5 条要求该能力 | 归入 **P5**（§3.5：`GET/PUT /admin/about`，markdown 内容文件、复用备份+原子写，编辑在 P10c）——理由：与 posts 同为内容文件读写，P4 是数据文件引擎、P8 是数据库文章，均不贴合 |
| 2 | `content.changed` 发射方表含 **posts（scope:'post'）与 albums（scope:'album'）**，原始锚点只写了 collections 与 settings | 补入 **P5 §3.8 第 3 条**（scope:'post' 与 'about'）与 **P7 §3.6**（scope:'album'），并在各自验收中加入断言 |
| 3 | **设置管理前端页**（REQUIREMENTS §7 第 6 条）未落在任何 P10 子阶段；**timeline 按 type 自动 icon/color**（§6.6）未进 P4 | 前者补入 **P10d §3.6**（SettingsPage）；后者补入 **P4 §3.2/§6.8**（默认映射表从主题源码确认记 ADR） |

## 3. 疑问清单（歧义处理方式；重大歧义未静默决定）

1. **P0b config 字段基线**（`mizukiRoot/mode/backupDir/uploadLimitMb`）：REQUIREMENTS §6.1 只给了内容类别未给字段名，我按最小集拟定并要求执行 AI 扩展须记 ADR。
2. **备份 scope 双口径**：REST scope（full/data/content/db，MASTER-PLAN §5 逐字）与 `backup_record.scope`（pre_write/manual/auto/db，§3 逐字）不一致——P2 §3.2 给出映射（full/data/content→manual 记录）并要求记 ADR。
3. **JWT secret 持久化**：规格只说「从 config/env 读取」，未定义缺失时行为——P6 给方案（环境变量优先，缺失自动生成并持久化到 config.json）并列入 P6 疑问清单。
4. **登录锁定阈值/时长**（5 次/15 分钟）：规格只说「锁定」未给数值——P6 给定值并要求写入报告确认。
5. **settings REST 路径**：MASTER-PLAN §5 未列——P8 §3.7 定型最小规格（`GET/PUT/DELETE /admin/settings(/:key)`）并列入疑问清单。
6. ~~**file-type 为 ESM-only**~~ → **已定案（第二次验收人工裁决）**：不引入 `file-type`，P7 在 `common/security/magic-sniff.ts` 自实现最小魔数嗅探器（四格式魔数 + 扩展名比对 + sharp 解码兜底拒绝），ADR 记录理由（file-type@16 已停止维护、v17+ ESM-only 与本项目 CJS 不兼容）。
7. **`GET /admin/events` SSE**：提示词A 标注「做不做须记 ADR」——P10d 按可选实现处理，两种选择都要求记 ADR。
8. **P5 状态推导规则**（draft/published 由 `draft`/`published` 字段派生）：REQUIREMENTS 未明确推导式——P5 §3.6 给定规则并要求报告确认。

## 4. 偏差清单

理想为空——除 §2 所列 3 处规格缺口补白（均已显式记录，非静默决定）外，无对提示词A 生成物清单、八节模板、生成规则的偏离。未拆分任何阶段，未增加生成物清单之外的文件。

## 5. 第二次验收修订记录（9 处）

| # | 修订 | 落点 |
|---|---|---|
| A1 | stub 计数 44→45（逐个清点含 drizzle.config.ts）；P0a 验收描述改「`pnpm test` 冒烟（health 200）」 | `INDEX.md` |
| A2 | 删除规格外端点 `POST /admin/collections/:type/reorder` 的提及 | `P4-collections.md` |
| A3 | file-type 选型定案：不引入，自实现魔数嗅探器（§2 补文件路径、§4 定案、禁释与偏差同步） | `P7-media-albums.md` |
| A4 | 优雅停机：§2 允许改 `main.ts`（仅 enableShutdownHooks）、新增 §3.4b（SIGTERM/SIGINT tree-kill 停组 + 5 秒超时强杀 + 关 SSE/定时器）、§6 加验收 #2、接线加第 4 条 | `P9-process.md` |
| B5 | 公开路由归属补全：§2 加 `public-collections.controller.ts` / `public-albums.controller.ts` 与两个模块的允许修改清单；§4 第 1 条改为公开路由归各自领域模块（L2 互不 import） | `P8-articles-public-api.md` |
| B6 | 分层规则修正：允许 L3 之间相互依赖（编排层内部协作）；L0/L1/L2 不得依赖 L3 | `P0b-config-db-exception.md` |
| B7 | 未初始化探测：health 响应加 `initialized` 字段 + 验收断言；P10a 改经 `health.initialized` 判断 | `P6-auth-init.md`、`P10a-web-shell.md` |
| B8 | 日志读取端点：P6 加 `GET /admin/system/logs`（规格补白入疑问清单）+ 验收；P10d 仪表盘改对接该端点 | `P6-auth-init.md`、`P10d-web-console.md` |
| B9 | `mutateCollection` 校验参数澄清：签名加 `schema?` 参数、第 3 步改 `schema?.parse(next)`、要点加「调用方传入，未传跳过」 | `P3-data-files-engine.md` |

修订后疑问清单新增两项（均已写入对应提示词）：`GET /admin/system/logs` 规格补白（P6）、file-type 定案转为记录项。
