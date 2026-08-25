# 任务：管理面板 — 文章模块（阶段 P10c）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P10c**，前置依赖阶段：**P10b（六类集合页）**。

本会话范围一句话：**实现面板文章模块——文章列表（含草稿箱/回收站）、Markdown 编辑（CodeMirror 6 + frontmatter 表单）、富文本编辑（TipTap）**。

只做本阶段：媒体库/相册/备份/构建控制台/仪表盘在 P10d；后端代码不动（例外见 §2）。

> 技术栈（锁定）：Markdown 编辑 = CodeMirror 6；富文本 = TipTap；均为 REQUIREMENTS §12 锁定栈。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§5「Posts」「Articles」路由清单、§2 决策 2（双类型文章）、§3（article 表 status/deleted_at 语义）
2. `docs/REQUIREMENTS.md`：**§6.10**（frontmatter 字段，表单依据）、§4 文章体系、**§7 第 3 条（文章管理功能清单）与第 4 条（富文本编辑器能力）**
3. `CHANGELOG.md`：P10b 条目（最近一条）
4. `docs/decisions/` 全部 ADR
5. `docs/SESSIONS.md` 最近记录（如有）
6. 后端契约（只读参考）：`apps/server/src/modules/posts/`、`modules/articles/` 控制器（P5/P8 实现）；`common/markdown/` frontmatter 字段集

## 2. 实现文件清单

`apps/web` 下**新建**：

- `src/views/posts/PostListPage.vue` — Markdown 文章列表（含草稿箱、回收站视图/筛选）
- `src/views/posts/PostEditPage.vue` — Markdown 编辑页（CodeMirror 6 + frontmatter 表单 + 封面）
- `src/views/articles/RichArticleListPage.vue`、`src/views/articles/RichArticleEditPage.vue` — 富文本列表与 TipTap 编辑页
- `src/lib/editors/` — CodeMirror 6 封装组件、TipTap 封装组件（基础扩展集）
- `src/api/posts.ts`、`src/api/articles.ts` — 端点客户端
- 路由与菜单接入（替换占位）

**允许修改**：`apps/web/src/router/`、`src/layouts/MainLayout.vue`、`apps/web/package.json`（新增 `codemirror` 系与 `@tiptap/*` 系依赖，**记入 ADR-001**）。

**禁止触碰**：`apps/server/` 任何源码文件；`src/views/collections/`（P10b 成果）。

## 3. 详细规格

### 3.1 文章列表（Markdown 源）

- 数据：`GET /admin/posts`；列表列：标题、slug、状态（published/draft）、置顶、发布日期、更新时间。
- **草稿箱**：按 `draft === true`（或 `published === false`，与后端 status 口径一致）筛选视图。
- **回收站**：`deleted_at` 非空的行（后端软删语义）——列表 + 「恢复」动作（经备份恢复链路，前端调对应接口；若后端无独立恢复端点，按现有 `POST /admin/backups/:id/restore` 组合实现并在报告说明）。
- 操作：新建、编辑、删除（二次确认）、置顶切换、封面上传入口（`POST /admin/posts/:slug/cover`）。

### 3.2 Markdown 编辑页

- **CodeMirror 6**：正文编辑（markdown 语法高亮），行号、等宽字体；内容保存到 `PATCH /admin/posts/:slug`。
- **frontmatter 表单**：侧栏表单编辑 §6.10 的 12 个字段（title*、published、description、tags、category、author、permalink、pinned、draft、image、date、pubDate）；未知额外字段**原样保留**（往返保真约束，前端不得丢弃未见过的键——提交时以读取时的完整 frontmatter 为基础合并表单变更）。
- 封面：上传控件 → `POST /admin/posts/:slug/cover`，成功后刷新预览。
- 新建文章：slug 输入（目录名）+ 初始 frontmatter + 正文 → `POST /admin/posts`。
- 「上传 Markdown 文件」入口（§6.10 功能清单）：文件选择 → 读文本 → 填入编辑器（或直接创建）。
- **about 页编辑**（REQUIREMENTS §6.11：上传/编辑/保存前备份/支持回滚）：`/about` 路由提供单文件编辑器（CodeMirror 6 复用，编辑 `src/content/spec/about.md`）；保存调 `PUT /api/v1/admin/about`（P5 §3.5），保存前自动备份由后端完成，页面展示「已自动备份」提示；「上传替换」入口读本地 .md 文本后走同一保存链路。

### 3.3 富文本编辑页（TipTap）

- 编辑器能力（REQUIREMENTS §7 第 4 条）：标题（1–6）、列表（有序/无序）、引用、代码块、图片、链接、表格。
- 保存：`editor.getJSON()` → `doc_json` → `POST/PATCH /admin/articles`（服务端生成 `html_cache`）。
- 元数据表单：title、slug、status（draft/published）、pubDate、pinned、summary、cover、category。
- 「可导出 HTML 与 Markdown」（§7 第 4 条）：提供导出按钮——HTML 用服务端返回的 `html_cache`（或编辑器 `getHTML()`，取舍记报告）；Markdown 导出为可选增强（无成熟库时降级为复制 HTML + 说明，不得为此引入重型转换器，取舍记报告）。

### 3.4 交互与安全

- 保存成功后明确提示；后端 400 的 `detail`（zod issues）映射到字段。
- 富文本预览只在编辑器内渲染（TipTap 自身渲染），**前端不执行任何后端返回的 HTML 字符串**（`v-html` 禁用；确需预览的场景用沙箱说明——本阶段默认不做公开预览）。

## 4. 接线说明

1. 路由：`/posts`、`/posts/new`、`/posts/:slug/edit`、`/articles`（富文本）、`/articles/:id/edit`。
2. 菜单：「文章」菜单下分「Markdown 文章」「富文本文章」（或单页 tab 切换，取简者记报告）。
3. 依赖新增：`codemirror`（或 `@codemirror/*` 集合）、`@tiptap/vue-3` + 所需扩展包——版本记 ADR-001。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1/2 条 = 只建 §2 清单内文件；第 3 条 = 不得改动后端接线；第 4 条 = 前端新增依赖记 ADR-001。

**本阶段专属禁止**：

- **前端绕过 `/api/v1` 直接操作文件**；**任何前端代码中出现 secret**。
- **`v-html` 渲染后端返回的 HTML**（XSS 防线，硬性）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

### 手动验收场景清单（逐条执行并记录结果）

1. **Markdown 往返**：新建文章（slug、全部 12 个 frontmatter 字段、正文）→ 保存 → 重开编辑页断言字段完整 → 直接改 `index.md` 加一个自定义 frontmatter 键 → 面板重新打开并保存 → 自定义键仍在（往返保真）。
2. **CodeMirror**：编辑器语法高亮可用、多行编辑保存后文件内容一致。
3. **草稿箱**：`draft: true` 的文章只出现在草稿箱视图；取消草稿后回到主列表。
4. **删除与回收站**：删除文章 → 出现在回收站 → 恢复 → 回主列表（后端文件回来）。
5. **置顶与封面**：置顶切换生效；上传封面图成功显示。
6. **富文本**：新建富文本文章——插入标题/列表/引用/代码块/图片/链接/表格 → 保存 → 重开内容与结构一致（doc_json 往返）；发布后公开列表可见（可用 curl/面板验证 `GET /api/v1/public/articles`）。
7. **导出**：HTML 导出按钮产出内容；Markdown 导出的实际能力（实现/降级）与报告一致。
8. **构建与回归**：`pnpm --filter @mizuki/web build` 通过；根 `pnpm test` 全绿。

## 7. 交付报告要求

1. 文件清单：新建/修改的全部文件路径。
2. 依赖新增版本表（ADR-001）。
3. §6 手动场景逐条结果。
4. 疑问清单（回收站恢复链路、Markdown 导出能力、列表/草稿视图组织方式等取舍）。
5. `CHANGELOG.md` 追加 P10c 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
