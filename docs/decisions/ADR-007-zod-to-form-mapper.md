# ADR-007: zod→表单映射自实现，不引入 zod-to-json-schema

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-26 |
| 阶段 | P10b（六类集合管理页） |

## 背景

P10b 要求六类集合管理页的表单「由 zod schema 驱动生成」——字段、类型、必填性、枚举选项全部从 `@mizuki/shared` 的六个 itemSchema 推导，不为每类内容手写重复表单结构（P4 将 schema 放 shared 的动机在此兑现）。

渲染策略有两个候选：
1. **自写映射器**：直接对 zod 的运行时对象做内省（`.shape` / `.unwrap()` / `.options` / `.element`），产出 FieldDescriptor 列表，再由 Vue 组件按描述符渲染 Element Plus 控件。
2. **zod-to-json-schema 中间层**：先把 zod schema 转 JSON Schema，再由 JSON Schema 驱动的表单库（如 `@formkit/zod` 或自写 JSON Schema 解析器）渲染。

## 决策

**采用自写映射器**（`apps/web/src/lib/schema-form/mapper.ts`）。理由：

- **字段类型面有限**：六类 schema 只用到 `string / boolean / number / array(string) / object / enum / optional`。自写映射器分支 ≤ 8 个，代码量小，无抽象缝隙。
- **零新依赖**：不引入 `zod-to-json-schema` 或 `@formkit/zod`，依赖面不扩张（与 ADR-001「更少的依赖面」一脉相承）。
- **zod v4 直连**：直接用 zod v4 的运行时内省 API（`constructor.name` 区分类型、`.unwrap()` 解 optional、`.options` 取枚举、`.element` 取数组元素），无中间层语义损耗。
- **校验复用同一份 schema**：提交前在浏览器端 `schema.safeParse(value)` 跑一次，错误按 `issue.path` 映射到字段；后端 400 的 `detail.issues` 也按 path 映射，前后端校验逻辑同源（P4 schema 即权威）。

## 映射规则（mapper.ts）

| zod 类型 | 控件 | 备注 |
|---|---|---|
| `ZodString`（字段名命中 content/description/desc/specs） | `el-input type="textarea"` | 长文本白名单 |
| `ZodString`（字段名含 url/site 或 =link/liveDemo 等） | `el-input` + placeholder `https://...` | URL 提示 |
| `ZodString`（其余） | `el-input` | |
| `ZodBoolean` | `el-switch` | |
| `ZodNumber` | `el-input-number` | skills.level / experience.years·months |
| `ZodArray<ZodString>` | 标签输入（`el-tag` + 回车追加 + 删尾） | tags / techStack / skills / images |
| `ZodEnum` | `el-select`（options 来自 `.options`） | timeline.type 四项 |
| `ZodObject`（嵌套） | 子字段组（`el-divider` + 递归子字段） | skills.experience |
| `ZodOptional` | 解包内层 + 非必填标记 | |
| `ZodDefault` | 解包内层 + 非必填（有默认值） | 六类未使用，兜底支持 |

字段中文标签由 `LABEL_OVERRIDES` 白名单覆盖（id/title/content/date/...），未命中取原字段名。

## 备选方案

- **zod-to-json-schema + JSON Schema 表单库**：引入两层抽象（zod→JSON Schema→表单），六类字段类型简单，抽象收益不抵依赖与缝隙成本 → 否决。
- **每类手写表单**：违背 P10b §3.2「schema 驱动」硬性规格与 §5 专属禁止「不得为六类内容手写六套重复表单」→ 否决。

## 后果

- 六类表单共用一个 `SchemaForm.vue` + 一个 `mapper.ts`，新增一类内容只需在 shared 加 schema + 在 CollectionListPage 配置表加一行（type→schema），表单代码零改动；
- 字段标签与长文本/URL 判定由 `LABEL_OVERRIDES` / `LONG_TEXT_FIELDS` / `isUrlField` 三处白名单控制，后续语义调整改白名单即可；
- 图片字段（diary.images / projects.image / devices.image）本阶段用文本输入，预留 P10d 媒体库打通后增强为上传组件的插槽（§3.3 明确）。
