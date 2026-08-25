# 任务：管理面板 — 六类集合管理页（阶段 P10b）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P10b**，前置依赖阶段：**P10a（面板外壳）**。

本会话范围一句话：**实现六类集合管理页面（日记/友链/项目/时间线/技能/设备）——由 `packages/shared` 的 zod schema 驱动生成表单，打通 `/admin/collections/:type` CRUD**。

只做本阶段：文章编辑（P10c）、媒体/备份/控制台/仪表盘（P10d）不在本阶段；后端代码不动（例外见 §2）。

> 核心设计：**表单由 zod schema 驱动生成**——字段、类型、必填性、枚举选项全部从 `@mizuki/shared` 的六个 itemSchema 推导，不为每类内容手写重复表单结构（P4 将 schema 放 shared 的动机在此兑现）。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§4.2（CollectionDef/注册表）、§5「集合」路由清单、§8 路线图 P10 行
2. `docs/REQUIREMENTS.md`：**§6.3–6.8**（六类字段，表单字段与说明文案依据）、§7 第 5 条（内容模块管理）
3. `CHANGELOG.md`：P10a 条目（最近一条）
4. `docs/decisions/` 全部 ADR
5. `docs/SESSIONS.md` 最近记录（如有）
6. `packages/shared/src/collections/`（六个 zod schema——表单生成的唯一字段来源）与 `packages/shared/src/index.ts` 导出方式
7. P10a 既有结构：`apps/web/src/{router, api, layouts, views}`（只读参考，遵循其封装约定）

## 2. 实现文件清单

`apps/web` 下**新建**：

- `src/views/collections/CollectionListPage.vue` — 通用列表页（表格 + 新增/编辑/删除），按路由参数 `:type` 复用
- `src/lib/schema-form/` — **zod schema → 表单渲染器**（核心，见 §3.2）
- `src/api/collections.ts` — collections 端点客户端
- 路由注册：`/collections/:type`（type ∈ 六类）接入主布局菜单（替换 P10a 占位）

**允许修改**：`apps/web/src/router/`、`src/layouts/MainLayout.vue`（菜单指向真实页面）、`apps/web/package.json`（如需渲染辅助依赖，记 ADR-001）。

**跨包改动（仅限）**：如需前端直接消费 `@mizuki/shared` 的运行时导出（zod schema 对象），确认 `packages/shared` 的构建产物可被 vite 消费；若需调整 `packages/shared/package.json` 的 `exports`/`main` 字段，**属于允许的最小后端侧改动**，须在交付报告中列出并说明理由（除此之外 `apps/server/` 源码一律不动）。

**禁止触碰**：`apps/server/src/` 任何业务文件。

## 3. 详细规格

### 3.1 页面清单与路由

六类各一个列表管理页（同一通用组件按 `:type` 实例化）：

| 菜单 | 路由 | 后端 |
|---|---|---|
| 日记 | `/collections/diary` | GET/POST `/admin/collections/diary`、PATCH/DELETE `/:id` |
| 友链 | `/collections/friends` | 同上 |
| 项目 | `/collections/projects` | 同上 |
| 时间线 | `/collections/timeline` | 同上 |
| 技能 | `/collections/skills` | 同上 |
| 设备 | `/collections/devices` | grouped：含分组选择 + 空分组自动清理后的刷新 |

### 3.2 schema 驱动表单（渲染策略，须写入交付报告并记 ADR）

- 遍历 zod schema 的 shape（`ZodObject` → 各字段 `ZodType`），映射到 Element Plus 控件：
  - `ZodString` → `el-input`（`string().url()` 或字段名含 url/site → 文本输入 + URL 提示；长文本字段如 `content`/`description` → `el-input type="textarea"`，按字段名白名单判断）
  - `ZodBoolean` → `el-switch`
  - `ZodNumber` → `el-input-number`（skills.level）
  - `ZodArray(ZodString)` → 标签输入（tags/techStack/skills/images 等，`el-tag` + 输入）
  - `ZodObject`（嵌套，如 skills.experience）→ 嵌套字段组
  - `ZodEnum`（timeline.type）→ `el-select`（选项来自枚举值）
  - `ZodOptional` → 解包 + 非必填标记
- 必填性（`isOptional()`）、默认值、校验信息全部由 schema 推导；提交前用**同一份 schema** 在浏览器端 `parse` 一次（错误逐字段提示）。
- 渲染策略选型（如自写映射器 / zod-to-json-schema 转换）在提示词执行时确定，**写入交付报告并记 ADR**。
- grouped（devices）：页面上先选分组（`z.record` 的键列表）再展示条目列表；新增条目时带 `group` 字段；删除条目后重新拉取列表（空分组由后端清理）。

### 3.3 交互规格

- 列表：表格展示（字段列由 schema 键生成，长文本截断）；支持分页（前端分页可接受，取简者，记报告）。
- 新增/编辑：抽屉或对话框表单；编辑时预填现值；提交经请求封装（P10a 的 401 自动 refresh 自动生效）。
- 删除：`ElMessageBox.confirm` 二次确认 → DELETE → 刷新；后端 409（被媒体引用时，P7）展示引用明细。
- 图片字段（diary.images、projects.image、devices.image）：本阶段用文本输入（文件名/路径），上传组件在 P10d 媒体库打通后可增强（预留插槽，记报告）。

### 3.4 后端契约（只读引用，不得修改）

- `GET /admin/collections/:type`、`POST`、`PATCH /:id`、`DELETE /:id`（P4 实现）。
- 错误格式 `{ code, message, detail }`；zod 校验失败 `detail` 含 issues → 前端映射到对应字段提示。

## 4. 接线说明

1. 路由：`/collections/:type` 单路由 + 动态组件实例；`:type` 非法时 404 占位提示。
2. 菜单：P10a 的六类占位项指向真实路由。
3. 请求层复用 `src/api/` 封装；六类端点常量集中。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1/2 条 = 只建 §2 清单内文件，文章/媒体/备份/控制台页一律保持占位；第 3 条 = 不得改动后端接线；第 4 条 = 前端新增依赖须记 ADR-001。

**本阶段专属禁止**：

- **前端绕过 `/api/v1` 直接操作文件**；**任何前端代码中出现 secret**。
- 不得为六类内容手写六套重复表单——必须由 schema 驱动（偏离须记 ADR 说明）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

### 手动验收场景清单（逐条执行并记录结果）

1. **日记**：打开日记页 → 新增一条（含日期、正文、两个标签、位置）→ 列表出现 → 编辑改正文 → 保存后刷新仍在 → 删除（二次确认）→ 消失。后端数据文件相应变化（可查 `src/data/diary.ts`）。
2. **友链**：新增缺 `siteurl` → 表单阻止提交并提示必填（浏览器端 schema 校验）；填全后成功。
3. **时间线**：`type` 下拉恰含 `education/certificate/project/other` 四项。
4. **技能**：`level` 数字输入、`experience` 嵌套（years/months）正常往返。
5. **设备（grouped）**：切换分组展示不同条目；新增条目到指定分组；删除分组内最后一个条目后该分组从分组列表消失（空分组清理）。
6. **错误映射**：提交非法数据绕过前端校验（如直接改字段为空串提交）→ 后端 400 → 页面提示来自 `message/detail`。
7. **登录态**：手动使 accessToken 失效 → 操作时自动 refresh 无感完成。
8. **构建**：`pnpm --filter @mizuki/web build` 通过；根 `pnpm test`（服务端）回归全绿。

## 7. 交付报告要求

1. 文件清单：新建/修改的全部文件路径。
2. **渲染策略说明 + ADR**（zod → 表单的映射规则与选型）。
3. §6 手动场景逐条结果。
4. `packages/shared` 如有 `exports` 调整，说明理由。
5. `CHANGELOG.md` 追加 P10b 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
