# 任务：ts-morph 数据文件引擎（阶段 P3）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P3**，前置依赖阶段：**P2（备份）**。

本会话范围一句话：**实现全项目地基——ts-morph 数据文件引擎（AST 求值、序列化、语法校验、文件锁、读缓存、8 步写管线），并用仓库内置假 Mizuki 项目做 golden-file 测试**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。本阶段是人工关卡（数据文件引擎定型），完成后等待人工确认。

> 背景（务必理解）：旧 Python 管理器 app.py 用“括号平衡 + JSON5”做文本 hack，可靠性差。本引擎用 AST 从根本上解决——注释、单引号、尾随逗号在 AST 求值下天然兼容（REQUIREMENTS 附录 A.7 已废弃文本方案）。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：**§6 全部**（6.1 模块组成、6.2 读取规格、6.3 写入规格、6.4 写管线 8 步、6.5 golden-file 测试——逐字依据）、§2 决策 1/3、§4 分层（data-files 属 L1 引擎）、§4.4 事件表 `content.changed` 行（发射方在 P4，本阶段只提供引擎出口）、§9 守则 3/9
2. `docs/REQUIREMENTS.md`：§6.0 通用约定、§6.2 TS 数据文件通用规格、附录 A.4/A.7
3. `CHANGELOG.md`：P2 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释（`modules/data-files/` 全部 7 个）：
   - `data-files.module.ts`、`data-file.service.ts`、`evaluator.ts`、`serializer.ts`、`syntax-check.ts`、`file-lock.ts`、`value-cache.ts`
7. 已实现的前置件：`infra/backup/backup.service.ts`（preWrite）、`common/security/safe-join.ts`、`config/app-config.ts`、`packages/shared/src/events.ts`

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致，共 7 个）**：

- `apps/server/src/modules/data-files/data-files.module.ts`（[P3]）
- `apps/server/src/modules/data-files/data-file.service.ts`（[P3]）
- `apps/server/src/modules/data-files/evaluator.ts`（[P3]）
- `apps/server/src/modules/data-files/serializer.ts`（[P3]）
- `apps/server/src/modules/data-files/syntax-check.ts`（[P3]）
- `apps/server/src/modules/data-files/file-lock.ts`（[P3]）
- `apps/server/src/modules/data-files/value-cache.ts`（[P3]）

**本阶段允许新建的文件（仅限以下）**：

- `apps/server/test/fixtures/mizuki/` — **假 Mizuki 项目**（转正 P0a 的占位目录）：包含全部 **6 个数据文件**（`src/data/{diary,friends,projects,timeline,skills,devices}.ts`）+ `package.json` + `astro.config.mjs` + `src/content/posts/` 目录 + 其他检测所需最小结构（满足 MASTER-PLAN §4.3 四项检测规则），刻意覆盖：块注释/行注释、单引号、尾随逗号、`as const`、`satisfies`、嵌套对象、字符串含引号和换行
- `apps/server/test/` 下本阶段测试文件（含 golden-file 断言）

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`common/guards/jwt-auth.guard.ts`（P6）、`common/decorators/public.decorator.ts`（P6）、`common/interceptors/operation-log.interceptor.ts`（P6）、`modules/system/mizuki-detector.service.ts`（P6）、`modules/auth/*`（P6）、`modules/collections/*`（P4）、`modules/posts/*`（P5）、`modules/articles/*`（P8）、`modules/albums/*`（P7）、`modules/media/*`（P7）、`modules/process/*`（P9）、`modules/backup/*`（P2）、`modules/settings/*`（P8）。

## 3. 详细规格（逐字搬自 MASTER-PLAN §6）

### 3.1 模块组成（§6.1）

```
data-files/
├── data-file.service.ts   # 对外门面：readCollection / mutateCollection
├── evaluator.ts           # AST → JS 值
├── serializer.ts          # JS 值 → TS 字面量文本
├── syntax-check.ts        # 写前语法校验
├── file-lock.ts           # 每文件异步互斥
└── value-cache.ts         # mtime+size 键的读缓存（公开 API 用）
```

### 3.2 读取：AST 求值器（§6.2 完整规格）

**每次操作从磁盘重读文件、新建一次性 `Project`**（文件小、解析成本可忽略，彻底规避陈旧 AST）：

```ts
import { Project } from 'ts-morph';
function loadSource(absPath: string) {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  return project.createSourceFile(absPath, fs.readFileSync(absPath, 'utf8'), { overwrite: true });
}
const decl = sf.getVariableDeclaration(varName)
  ?? throw new NotFoundError(`未找到导出 ${varName}`);
const value = astToValue(decl.getInitializer()!);
```

`astToValue` 递归求值，只接受**自包含字面量**，遇到无法静态求值的节点抛 `UnsupportedLiteralError`（**含文件名+行号**）。节点分派表（逐字）：

| AST 节点 | 行为 |
|---|---|
| ArrayLiteralExpression | 递归 elements |
| ObjectLiteralExpression | 遍历 PropertyAssignment（key 支持标识符/字符串）；Shorthand/Spread/Getter → **抛错** |
| StringLiteral / NoSubstitutionTemplateLiteral | `getLiteralText()`（自动处理单引号、转义） |
| NumericLiteral | `Number(...)` |
| True/False/Null | 对应值 |
| AsExpression / SatisfiesExpression / Parenthesized | 解包后递归（兼容 `as const`、`satisfies Xxx`） |
| PrefixUnary `-'42'` | 取负 |
| TemplateExpression（含 `${}`）/ Identifier / PropertyAccess | **抛错**（数据文件必须自包含） |

注释天然被 AST 跳过；单引号、尾随逗号在求值时天然兼容——app.py 的三大难题消失。

### 3.3 写入：值 → TS 文本（§6.3）

JSON 即合法 TS 字面量，直接：

```ts
export function valueToTsLiteral(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  return json.replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:'); // 纯美化：去键引号
}
```

回写只替换初始化表达式区域，**interface、type、import、文件尾代码、数据块外的注释一字不动**：

```ts
decl.setInitializer(valueToTsLiteral(next));
const text = sf.getFullText();
```

> 若 `setInitializer` 对多行文本缩进处理不符合预期（以 golden 测试为准），备选方案：`initializer.replaceWithText(...)` 并按声明语句所在列手动补缩进。无论采用哪种，以 §6.5 的“外部字节不变”断言为准。

### 3.4 完整写入管线（§6.4，顺序不可变）

```ts
async mutateCollection(relFile, varName, mutate: (v) => v, schema?: z.ZodTypeAny) {
  return this.lock.withLock(absFile, async () => {
    // 1. 读盘 + 记录原文哈希
    const { sourceFile, originalHash } = this.loadWithHash(absFile);
    // 2. AST 求值 → 深拷贝 → 用户变更
    const next = mutate(structuredClone(astToValue(getInitializer(sourceFile, varName))));
    // 3. zod 整体校验（schema 由调用方传入：array 传 itemSchema.array()，grouped 传 record schema；未传则跳过本步）
    schema?.parse(next);
    // 4. 生成新文本 + 语法校验（ts.transpileModule reportDiagnostics，syntax error 必须为 0）
    decl.setInitializer(valueToTsLiteral(next));
    const text = sourceFile.getFullText();
    assertSyntaxValid(text);
    // 5. 陈旧检测：重读磁盘哈希 ≠ originalHash → 整体重试 1 次，仍冲突返回 409
    // 6. 备份原文件（BackupService.preWrite，type='pre_write'）
    // 7. 原子写入：写同目录临时文件 `.tmp-<nanoid>` → fs.rename 覆盖
    // 8. 失效 value-cache，返回新值
  });
}
```

要点：

- **校验 schema 由调用方传入**：`mutateCollection` 的 zod 校验 schema 由调用方作为参数传入（签名即 `mutateCollection(relFile, varName, mutate, schema?)`）；P4 从注册表传入 `itemSchema.array()` 或 grouped 的 record schema；**未传时跳过第 3 步校验**。
- **并发控制**：`file-lock.ts` 维护 `Map<path, Promise>` 链，同一文件串行；不同文件并行。
- **device（grouped）**：求值结果是 `{分类: item[]}` 对象，mutate 时对目标分组数组增删改，写回整体对象；删除后数组为空的分组键直接移除（空分组清理）。
- **value-cache**：以 `mtime+size` 为键的读缓存；写管线第 8 步失效对应条目；公开 API（P4 起）读取优先走缓存。
- 所有路径经 `safeJoin(mizukiRoot, relFile)`；写管线第 6 步调用 P2 的 `BackupService.preWrite`（直接调用 infra/backup，属共享底层而非模块耦合，MASTER-PLAN §2 决策 6）。

### 3.5 golden-file 测试（§6.5，本模块验收核心）

仓库内置假 Mizuki 项目 `test/fixtures/mizuki/`（含全部 6 个数据文件，刻意覆盖：块注释/行注释、单引号、尾随逗号、`as const`、`satisfies`、嵌套对象、字符串含引号和换行）。测试断言：

1. 读 → 改 → 写 → 再读，值正确；
2. **写后文件中，初始化表达式以外的所有字节与原文件完全一致**（用文本 diff 断言）；
3. 所有“不支持节点”用例抛出带行号的明确错误；
4. （可选集成测试）写后对 fixture 执行 `tsc --noEmit` 通过。

> 测试对 fixture 的写操作必须作用于**临时副本**（先把 fixture 复制到临时目录再写），严禁直接改写仓库内的原始 fixture 文件。

### 3.6 日志

pino 记录关键写入步骤：每次 `mutateCollection` 的目标文件、校验结果、备份快照、原子写完成；冲突重试与 409 也要记录。

## 4. 接线说明

1. `data-files.module.ts`：providers 全部 6 个实现 + `exports: [DataFileService]`（L2 集合模块将注入它）。`DataFilesModule` 已在 `app.module.ts` 注册（P0a 占位），本阶段填充即可，不改注册顺序。
2. 依赖注入：`BackupService`（infra/backup，@Global 导出）、`AppConfig`（mizukiRoot）。
3. **事件发射不在本阶段**：`content.changed` 的发射方是 collections（P4）。本阶段的 `mutateCollection` 成功出口应提供发射挂点（如 mutate 完成回调/返回值），供 P4 接入，但本阶段代码不得 emit（引擎保持纯粹，事件由调用方负责）。
4. 分层自检：data-files 属 L1，只可依赖 L0（common/infra/config/shared），禁止 import 任何 L2/L3 模块。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = §2 之外的 stub 不得接线；第 4 条 = 本阶段零新增依赖（ts-morph/nanoid/zod 已在清单）。

**本阶段专属禁止**：

- **禁止引入 JSON5**；**禁止正则/括号计数等文本 hack 解析或回写数据文件**（这正是弃用 app.py 方案的原因，REQUIREMENTS 附录 A.7）。
- 禁止写业务路由/控制器（collections 是 P4 的活）。
- 严禁改写仓库内原始 fixture 文件（写测试一律用临时副本）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行）：

1. **golden 断言 ①（往返）**：对 6 个 fixture 数据文件各至少一条用例——读 → 改（增一条/改一个字段/删一条）→ 写 → 再读，断言新值与预期深相等。
2. **golden 断言 ②（外部字节不变）**：写后文件与原文本对比，**初始化表达式以外的字节逐字节一致**（文本 diff：将初始化表达式区域替换后整体比对，或用起止偏移切分断言前后缀字节相同）。6 个文件各至少一条。
3. **golden 断言 ③（不支持节点）**：构造含 `${}` 模板、标识符引用、属性访问、Shorthand、Spread 的用例，断言抛出错误且错误消息**含文件名与行号**。
4. **语法校验**：构造会导致语法错误的序列化输入（或直接在 `assertSyntaxValid` 单测中注入坏文本），断言 `ts.transpileModule` diagnostics 非零时抛错。
5. **陈旧检测**：单测模拟“读盘后、写盘前文件被外部修改”（篡改磁盘文件哈希），断言重试 1 次后返回 409。
6. **文件锁**：并发对同一文件发起 ≥2 个 `mutateCollection`，断言串行执行（最终值一致、无损坏）；不同文件并行不互锁。
7. **value-cache**：读后缓存命中；文件外部修改（mtime/size 变化）后缓存失效重读；写后缓存被失效。
8. **写管线备份与原子性**：写后 `data/backups/`（临时副本目录）出现该文件的 pre_write 快照；写入通过 `.tmp-*` + rename 完成（可断言写入过程中目标文件不出现半截内容：写入前读快照 + 写入后内容完整）。
9. **回归**：P0a–P2 既有用例全绿。
10. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（上述合计 ≥18 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径（含假项目 6 个数据文件清单）。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 偏差清单：理想为空；`setInitializer` 与 `replaceWithText` 的选择、fixture 文件的覆盖点清单（哪些“坑”被哪个文件覆盖）须显式列出；任何与 §6 规格的出入记 ADR。
4. `CHANGELOG.md` 追加 P3 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
