# 任务：六类集合 CRUD — 注册表驱动的通用集合引擎（阶段 P4）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P4**，前置依赖阶段：**P3（数据文件引擎）**。

本会话范围一句话：**实现 collections 模块——六类内容注册表、动态控制器、六个 zod schema（放 shared 包），打通 admin CRUD 路由并发射 `content.changed` 事件**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。**特别注意：禁止为六类内容建数据库表**（文件即数据库，MASTER-PLAN §2 决策 1）。

> 跨阶段一致性说明：P4/P5 的 admin 路由在 P6 之前无认证守卫属预期设计；P6 将统一挂守卫并验收。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：**§4.2**（通用集合引擎：CollectionDef 结构与注册表，逐字依据）、§2 决策 1（文件即数据库）、§5「集合」路由清单、§4.4 事件表 `content.changed` 行（发射方：data-files(集合/settings)）、§4 分层（collections 属 L2）
2. `docs/REQUIREMENTS.md`：**§6.3–6.8**（diary/friends/projects/timeline/skills/devices 字段，逐字依据）、§6.0 通用约定
3. `CHANGELOG.md`：P3 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/modules/collections/collections.module.ts`
   - `apps/server/src/modules/collections/collections.controller.ts`
   - `apps/server/src/modules/collections/collections.service.ts`
7. 已实现的前置件：`modules/data-files/data-file.service.ts`（readCollection/mutateCollection）、`infra/backup`（pre_write）、`packages/shared/src/events.ts`（EVENTS.ContentChanged + ContentChangedPayload）

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/modules/collections/collections.module.ts`（[P4]）
- `apps/server/src/modules/collections/collections.controller.ts`（[P4]）
- `apps/server/src/modules/collections/collections.service.ts`（[P4]）

**本阶段允许新建的文件（仅限以下）**：

- `packages/shared/src/collections/` — **六个 zod schema**（每类一个文件 + 汇总导出）。**放 shared 的动机：P10 管理面板将由这些 schema 驱动生成表单，前后端复用同一份字段规格**（本动机须在交付报告中复述确认）
- `packages/shared/src/index.ts` 追加导出 collections schemas
- `apps/server/test/` 下本阶段测试文件

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`common/guards/jwt-auth.guard.ts`（P6）、`common/decorators/public.decorator.ts`（P6）、`common/interceptors/operation-log.interceptor.ts`（P6）、`infra/backup/backup.service.ts`（已实现，本阶段只调用）、`modules/system/mizuki-detector.service.ts`（P6）、`modules/auth/*`（P6）、`modules/posts/*`（P5）、`modules/articles/*`（P8）、`modules/albums/*`（P7）、`modules/media/*`（P7）、`modules/process/*`（P9）、`modules/backup/*`（P2，已实现）、`modules/settings/*`（P8）。

## 3. 详细规格

### 3.1 CollectionDef 结构（逐字搬自 MASTER-PLAN §4.2）

```ts
// modules/collections/registry.ts
export interface CollectionDef {
  type: string;                 // 'diary'
  file: string;                 // 'src/data/diary.ts'（相对 Mizuki 根）
  varName: string;              // 'diaryData'
  shape: 'array' | 'grouped';   // devices 是 grouped（分类→数组 的对象）
  itemSchema: z.ZodTypeAny;     // 与 Mizuki interface 对齐的 zod schema
  idField: string;              // 'id'
  imageDir?: string;            // 'public/images/diary'
  public: boolean;              // 是否暴露公开 API
}
export const REGISTRY: CollectionDef[] = [
  { type: 'diary', file: 'src/data/diary.ts', varName: 'diaryData',
    shape: 'array', idField: 'id', imageDir: 'public/images/diary',
    public: true, itemSchema: DiaryItemSchema },
  // friends / projects / timeline / skills 同构……
  { type: 'devices', file: 'src/data/devices.ts', varName: 'devicesData',
    shape: 'grouped', idField: 'name', imageDir: 'public/images/device',
    public: true, itemSchema: DeviceItemSchema },
];
```

> registry 为本模块内新建文件（非 stub，允许新建）：`apps/server/src/modules/collections/registry.ts`。

### 3.2 六类配置（逐字）与字段（逐字搬自 REQUIREMENTS §6.3–6.8）

| type | file | varName | shape | idField | imageDir |
|---|---|---|---|---|---|
| diary | `src/data/diary.ts` | `diaryData` | array | id | `public/images/diary` |
| friends | `src/data/friends.ts` | `friendsData` | array | id | — |
| projects | `src/data/projects.ts` | `projectsData` | array | id | — |
| timeline | `src/data/timeline.ts` | `timelineData` | array | id | — |
| skills | `src/data/skills.ts` | `skillsData` | array | id | — |
| devices | `src/data/devices.ts` | `devicesData` | **grouped** | **name** | `public/images/device` |

六类全部 `public: true`。

**diary**（§6.3）：`id` string 必填；`content` string 必填（正文）；`date` string 必填（ISO 8601）；`images` string[] 可选（目录内文件名）；`location` string 可选；`mood` string 可选；`tags` string[] 可选。

**friends**（§6.4）：`id` string 必填；`title` string 必填（站点名）；`imgurl` string 必填（头像 URL）；`desc` string 可选；`siteurl` string 必填；`tags` string[] 可选。

**projects**（§6.5）：`id` string 必填；`title` string 必填；`description` 可选；`image` 可选（封面）；`category` 可选；`techStack` string[] 可选；`status` 可选；`liveDemo` 可选；`sourceCode` 可选；`startDate`/`endDate` 可选；`featured` boolean 可选；`tags` string[] 可选；`visitUrl` 可选。

**timeline**（§6.6）：`id` string 必填；`title` string 必填；`description` 可选；`type` 必填（`'education' | 'certificate' | 'project' | 'other'`）；`icon`/`color` 可选；`startDate` string 必填；`location`/`organization` 可选；`skills` string[] 可选；`featured` boolean 可选。**按 type 自动设置默认 icon/color**：POST 新增时未提供 `icon`/`color` 则按 type 填充默认值（默认映射表实现时从 Mizuki 主题源码确认并记 ADR）。

**skills**（§6.7）：`id` string 必填；`name` string 必填；`description` 可选；`icon` 可选；`category` 可选；`level` number 可选（熟练度，刻度以 Mizuki interface 为准）；`experience` `{ years: number, months: number }` 可选；`color` 可选。

**devices**（§6.8，grouped）：结构 `{ [分类名: string]: Device[] }`；Device 字段——`name` string 必填（分组内唯一）；`image` 可选；`specs` string 可选（结构以 Mizuki interface 为准）；`description` 可选；`link` 可选。

> ⚠ 通用约定（§6.0）：`id` 新建时未提供由服务端自动生成（nanoid）；日期 ISO 8601；字段类型以 Mizuki 项目内真实 interface 为准，实现前与真实源码核对，偏差记 ADR，**不得静默修改字段名**。

### 3.3 REST API（MASTER-PLAN §5 逐字，全部需认证——P6 前无守卫属预期）

`:type` 必须先对注册表白名单校验（防路径注入，未知 type → 404/400 拒绝）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/collections/:type` | 全量列表（含分组结构） |
| POST | `/admin/collections/:type` | 新增（grouped 时 body 含 `group` 字段） |
| PATCH | `/admin/collections/:type/:id` | 修改 |
| DELETE | `/admin/collections/:type/:id` | 删除（grouped 时自动清理空分组） |

行为规则：

- 所有读写经 `DataFileService`（L2→L1 合法），不得绕过引擎直接读写文件。
- POST 新增：无 `id`（devices 无 `name`）时自动生成 nanoid；`id` 冲突 → 409。
- PATCH/DELETE 目标不存在 → 404。
- grouped（devices）：POST body 含 `group`；DELETE 后该分组数组为空则**移除空分组键**（与 P3 引擎的空分组清理对齐）。
- 全部输入过 zod（itemSchema；grouped 用 `z.record(z.string(), itemSchema.array())` 整体校验）。

### 3.4 事件（发射方，MASTER-PLAN §4.4 逐字）

**每次写入（POST/PATCH/DELETE 成功）发射**：

- 事件：`EVENTS.ContentChanged`（`'content.changed'`）
- payload：`ContentChangedPayload` = `{ scope, type?, filePaths[] }`，其中 `scope: z.enum(['collection','post','album','about','settings'])`；集合场景 `scope: 'collection'`、`type` 为集合 type（如 `'diary'`）、`filePaths` 为被写文件的相对路径数组
- 发射点位于写管线成功出口，恰好一次、失败不发；发射前 `ContentChangedPayload.parse(payload)`
- 禁止字符串字面量 emit/on

订阅方（value-cache 失效由引擎写管线第 8 步直接处理；仪表盘统计在 P10d）；本阶段用**测试订阅者**断言事件收到。

### 3.5 公开 API 预留

注册表 `public: true` 供 P8 的公开集合路由使用；本阶段不实现公开端点。

## 4. 接线说明

1. `collections.module.ts`：controllers `CollectionsController`，providers `CollectionsService`；imports `DataFilesModule`（注入 `DataFileService`）。`CollectionsModule` 已在 `app.module.ts` 注册（P0a 占位），本阶段填充。
2. 控制器使用单一动态路由 `@Controller('admin/collections')` + `:type` 参数，路由处理器第一步做白名单校验。
3. 依赖注入：`DataFileService`、`EventEmitter2`、`AppConfig`（mizukiRoot）。
4. 分层自检：collections（L2）只依赖 data-files（L1）与 L0，禁止 import posts/media 等其他 L2 模块。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = §2 之外的 stub 不得接线；第 4 条 = 本阶段零新增依赖（nanoid/zod 已在清单）。

**本阶段专属禁止**：

- **禁止为六类内容建数据库表**（六类不入库，文件即数据库——为它们建表属已废弃的旧规划，见 REQUIREMENTS 附录 A.3，发现此类倾向必须停下报告）。
- 不得实现公开集合端点（P8）、认证守卫（P6）、媒体上传（P7）。
- shared 包只放类型和常量（六个 zod schema），禁止业务逻辑。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行，e2e 用 supertest，数据源为 P3 的假 Mizuki 项目临时副本）：

1. **六类 CRUD**：对 diary/friends/projects/timeline/skills 各走一遍「POST 新增 → GET 断言含新条目 → PATCH 修改 → GET 断言变更 → DELETE → GET 断言移除」。
2. **grouped（devices）**：POST（含 `group` 字段）新增设备 → GET 返回分组结构 → 修改 → 删除该分组最后一个设备 → 断言**空分组键被自动清理**。
3. **未知 type 拒绝**：`GET /admin/collections/unknown` 返回 4xx（404/400），且不产生任何文件读写。
4. **写后文件可编译**：每次写操作后对副本数据文件执行 `tsc --noEmit`（或对全部 6 文件最终执行一次），断言通过。
5. **事件断言**：测试订阅者断言——每次写入后收到 `content.changed`，payload 通过 `ContentChangedPayload.parse` 且 `scope === 'collection'`、`type` 与 `filePaths` 正确。
6. **校验拒绝**：非法 body（缺必填字段，如 friends 缺 `siteurl`）返回 400 且文件未被修改（写前校验）。
7. **id 生成**：POST 不带 `id` → 响应与文件中出现新生成的 nanoid id；`id` 重复 → 409。
8. **timeline 自动默认**：POST timeline 条目仅给 `type: 'education'`（不给 icon/color）→ 响应条目 `icon`/`color` 被按默认映射填充（非空）。
9. **回归**：P0a–P3 既有用例全绿。
10. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（六类 + grouped + 事件 + 校验合计 ≥15 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径（含 `packages/shared/src/collections/` 六个 schema 文件）。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 偏差清单：理想为空；与真实 Mizuki interface 的字段核对结果（§6.0 第 5 条）若有偏差记 ADR。
4. 确认声明：六个 schema 放 shared 供 P10 表单复用（动机复述）。
5. `CHANGELOG.md` 追加 P4 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
