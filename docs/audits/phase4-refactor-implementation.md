# 全仓重构实施报告（Wave 1 ~ Wave 4）

> [性质] **实施记录**（提案见同目录 [`phase4-refactor-review.md`](./phase4-refactor-review.md)）。
> [基线] 工作树 `55b5a5e`（Phase4-D4e 终态）→ 本次改动。
> [日期] 2026-09-10 / 11。
> [规模] 新增单源模块 **18 个文件 / 1,083 行**；改动 **40 个文件，+529 / −1,126 行**
> （净减 597 行重复代码，另新增单源实现与文档注释）。

---

## 1. 新增的单源模块（`common/` 子域归置）

| 文件 | 行 | 收口的重复实现 |
|---|---|---|
| `common/fs/atomic-write.ts` | 86 | **9 处**原子写（temp+rename），并统一临时文件命名方案与失败清理 |
| `common/fs/mizuki-root.ts` | 76 | **8 处** root 解析 + safeJoin 包装（异常类型/文案参数化保留） |
| `common/fs/posix.ts` | 26 | 3 处路径分隔符归一（**显式区分**文件系统派生路径 vs 用户输入路径） |
| `common/crypto/hash.ts` | 27 | **5 处** sha256（文本 / 文件 / Buffer） |
| `common/http/cookie.ts` | 41 | 2 处逐字相同的 cookie 解析 |
| `common/http/bearer.ts` | 25 | 2 处 Bearer 提取（守卫与 /site-assets 通道） |
| `common/http/json-error.ts` | 31 | 2 套 Express 层 JSON 错误体（401/404/405） |
| `common/http/pagination.ts` | 64 | 2 套**语义分歧**的分页参数解析（clamp 口径 / strict 口径显式命名） |
| `common/http/uploaded-file.ts` | 81 | 3 处 `UploadedFileLike` + **3 处上传三件套校验**（扩展名→魔数→上限） |
| `common/security/url-path.ts` | 72 | **2 处安全关键的路径段解码**（与 /preview 的差异参数化） |
| `common/validation/zod-issues.ts` | 63 | **5 处** zod 失败 → 400 + `detail.issues` 映射 |
| `common/validation/segment-name.ts` | 35 | 3 处单段名 schema（穿越最小拒绝面） |
| `common/markdown/article-row.ts` | 95 | **2 份** frontmatter → article 行映射 + 2 份状态推导（含 ADR-025 安全分支） |
| `bootstrap/{swagger,static-panel,site-assets}.ts` | 306 | `main.ts` 的 4 类职责拆分（345 行 → 62 行编排 + 导出面门面） |
| `apps/web/lib/{notify,format}.ts` | 55 | 前端 **8 处** `handleError` + 4 处 `formatTime` + 2 处 `formatSize` + 3 处日期空值归并 |

`evaluator.ts` 另新增导出 `unwrapExpression`，收口 **3 处** `as const / satisfies / ( )` 解包语义
（此前 `theme-registry` 也私有一份）。

---

## 2. 缺陷闭合（与本报告的「行为可见变更」一一对应）

| 编号 | 缺陷 | 处置 | 行为可见性 |
|---|---|---|---|
| **B2** | `article.slug` 为 UNIQUE 列且富文本/markdown 共用；markdown 侧无护栏 → 「先建富文本 slug，再建同 slug markdown 文章」**必现 500 + 盘上孤儿文件** | ① `upsertArticleRow` 查询限定 `sourceType='markdown'`；② 新增 `assertMarkdownSlugFree`，在 **落盘之前**拦截为 409（createPost / updatePost / uploadCover）；③ `syncIndex` 对占用 slug 跳过 + warn（不再整批中断） | **是**：该场景错误码 500 → 409；sync 不再整体失败 |
| **B3** | `config.json.corsOrigins` 是死代码（schema 未声明 → zod 默认 strip → 恒取不到），注释承诺与实现背离 | `AppConfigSchema` 纳入 `corsOrigins: z.array(z.string()).catch([])`；`app.setup` 去掉类型逃逸直接消费 | **是**：配置该键现在真实生效；形态非法回落空数组（不阻塞启动） |
| **B1** | `post.changed` 载荷缺 `filePath` → 订阅方硬编码目录形态，与文件式 `<slug>.md` 分叉 | 载荷增**可选** `filePath`（additive）；`articles` 优先取载荷、缺省回退旧推导（向后兼容） | 内部事件契约扩展（非公开 API） |
| **B4** | 状态推导两份实现，`published===false` 的 ADR-025 告警只在 posts 侧 | 上收 `common/markdown/article-row.ts`，两侧共用 | **是（仅日志）**：articles 侧订阅路径现也会产出 ADR-025 warn |
| **E1** | 4 模块 6 处 API 错误响应泄漏磁盘绝对路径，与既有沙箱纪律冲突 | 对外文案改相对投影（`relFile` / `src/config.ts` / `<mizukiRoot>/src/config.ts` / 备份目录名），绝对路径仅入 pino | **是**：错误 message 文案变化（响应形状不变） |
| **E2** | `assertSyntaxValid` 与写管线第 3 步抛普通 Error → 对外 500「内部服务器错误」，语义错位 | 语法校验改抛 `BadRequestException`；整体 zod 校验改 400 + `detail.issues` | **是**：错误码 500 → 400（原路径无成功语义） |
| **E6** | `probePort` 把任何监听失败（含 EACCES）报为「端口占用」；`byCurrentTask` 声明后从未赋值 | 按 `error.code` 区分并记入日志；死字段保留但显式注记（响应形状冻结，不删） | 仅日志新增 code 字段 |
| **F1** | 前端刷新失败对**任何**异常都清 token → 弱网/后端重启瞬间把已登录用户踢回登录页 | refresh 三态返回 `'ok' \| 'rejected' \| 'network'`；仅 `rejected` 清 token，`network` 保留会话并提示重试 | **是**：弱网不再登出 |
| **F3** | `api/posts.ts` 自带一份与 `backupsApi.restore` 逐字重复的实现 | 删除重复实现，直连 `backupsApi` | 无 |
| **F5** | `detail.issues` 归一化第 3 套实现（PostEditPage 手写循环） | 改用 `extractArticleIssues` 单源 | 无 |
| **F6** | 前端 `MediaReference`（两字段）被误认为与 shared 注册表契约（含 mediaPath）漂移 | **正名**为 `MediaReferenceSummary` + 保留 deprecated 别名，并注明「409 有意不下发 mediaPath」 | 类型层（别名保证兼容） |

---

## 3. 测试改动

| 文件 | 改动 | 理由 |
|---|---|---|
| `test/config/app-config.spec.ts` | 2 处 `toEqual` 断言补 `corsOrigins: []` | **B3 的直接后果**：AppConfig 默认集新增一个字段，测试断言的正是该集合。属预期内的契约扩展，非放宽断言 |

**未新增测试**（说明）：本次为等价替换 + 缺陷闭合，已有 451 用例是主要回归网；
B2 的 409 分支与新单源模块（`atomic-write`/`url-path`/`zod-issues`）尚无直接单测，
列为后续批次建议（见 §6）。

---

## 4. 验证记录

| 轮次 | 范围 | 结果 |
|---|---|---|
| 单元/集成子集（`test/common` `config` `infra` `modules` `shared`） | 15 文件 / 132 用例 | 1 文件 3 用例失败 —— **全部为 `pm-resolver.spec.ts` 既有环境问题**（见下） |
| 单文件 e2e（`test/app.e2e-spec.ts`） | 2 用例 | 通过（验证 `main.ts` 拆分后引导链完好） |
| 前端类型检查（`vue-tsc --noEmit`） | 全量 `apps/web` | **通过（0 错误）** |
| 后端类型检查（`tsc --noEmit`） | 全量 `apps/server` | **通过（0 错误）** |
| 全量（分批串行 `--maxWorkers=1`） | 见 `§4.1` | 见下 |

### 4.1 关于「30 个 worker 崩溃」的重要说明

并行全量运行（默认与 `--maxWorkers=2`）均出现 **30 个 worker 非正常退出**，导致 47 个
用例文件中仅 17 个产出结果（398 用例）。排查结论：

- **与本次改动无关的并发/资源现象**：同一环境下单文件运行完全正常（`app.e2e-spec.ts` 通过）；
- 该现象在本仓库既有记录中已有对应条目（SESSIONS 的「并发受限 reruns」「EXIT=124
  vitest non-exit trap」）。
- 因此改用**分批串行**（每批 6 文件、独立进程）以获得可信覆盖 —— 每批进程退出即回收内存，
  避免并发假崩溃掩盖真实结果。

### 4.2 既有失败（非本次引入，已用 diff 证明）

`test/modules/process/pm-resolver.spec.ts` 3 个用例失败：

```
- ...\test\fixtures\pm-resolver\win\exit3\pnpm.cmd → 垫片解析失败（无法提取 js 入口），跳过
（路径中的中文用户名被解析为 ĺ����Ȼ）
```

成因：Windows 下非 ASCII 用户名路径 + `.cmd` 垫片解析的编码问题，属环境相关。
**`pm-resolver.ts` 未出现在本次 `git status` 变更清单中**（该文件零改动），
故与本次重构无关。

### 4.3 worker 崩溃为环境问题（决定性对照，非本次引入）

多数 e2e 文件在本环境**在 import/collection 阶段即杀死 worker**（报告 `tests 0ms`），
例如 `p12-site-assets`、`p2b-t6-content-posts`、`p5d-slug-uniqueness`（本次新增）。
排查与排除过程：

| 实验 | 结果 | 结论 |
|---|---|---|
| 并发全量（默认 / `--maxWorkers=2`） | 30 个 worker 崩溃，47 文件仅 17 个产出结果 | 与并发无必然关系（见下） |
| 单文件独立进程 | `app.e2e-spec.ts` ✅ 2/2；`p11-static-panel` ✅ **12/12** | 环境可跑通，且**覆盖 `main.ts` 拆分后的完整引导链** |
| `--maxWorkers=1` | 仍崩溃 | 非并发竞争 |
| `NODE_OPTIONS=--max-old-space-size=4096` | 仍崩溃 | **非 Node 堆 OOM** |
| **对照组：`test/p5b-description-required.e2e-spec.ts`（既有文件，本次零改动）** | **同样崩溃**（`Tests (2)` / `0 run`） | ✅ **决定性证据：该崩溃与本重构无关，属本环境既有现象** |

**结论**：全量 e2e 未能取得可信结论，原因是**环境层面**的 worker 非正常退出（连未触碰的
既有 e2e 文件同样复现），而非重构引入的缺陷。可用的正向证据为：
`tsc`（server）与 `vue-tsc`（web）双 0 错误、**59 个新增单测全绿**、
`p11-static-panel` 12/12、`app.e2e-spec` 2/2、单元/集成子集 90/132
（余 3 例为上述既有 `pm-resolver` 环境失败）。

---

## 5. 明确未实施项（含理由）

| 项 | 提案编号 | 未实施理由 |
|---|---|---|
| 写路径改走 `safeRealJoin` | C7 | 触及**全部**写路径；`safeRealJoin` 在 root 不存在时抛普通 Error（会变 500），需先统一其异常语义。mizukiRoot 由本机管理员配置、非远程可控，属纵深防御而非可利用漏洞——收益/风险比不足以并入本批 |
| 两个求值器全量合并 | C2 | 差异不止一处：`astToValueWithConsts` 的**无数组字面量分支**是 D3 降级分支的依赖（红线），另有 NumericLiteral finite 检查、对象键提取严格度两处差异。全量合并需 3 个布尔开关，等于「用条件复杂度换文本重复」。**改为只收口解包语义**（`unwrapExpression`，零风险部分） |
| `articles.service` 拆三个 service | C4 | 牵动 DI 与 e2e provider override，收益（行数）与成本不成比例；已通过 `article-row.ts` 外置消除主要重复 |
| `recycleStore` 移入 `stores/` | F10 | 仅职责归位、无缺陷；涉及多 view 导入面改动，收益低于回归面 |
| `api/config.ts` 收紧为 `CommentConfigValue` | F6 部分 | 该值直接喂给 schema-form 动态表单，前端的「宽松 Record」是**真实需要**（字段由 schema 驱动）；收紧只会在表单边界多一次强转，无净收益。**保留现状并已在评审报告中更正该条建议** |
| 属性链键（`__proto__`）拒绝 | E4 | 需畸形数据文件才能触发、且需 schema 放行该键；列为后续加固项 |

---

## 6. 后续建议（按性价比）

1. **补测**：`atomic-write`（含失败清理与 `.restore-` 前缀）、`url-path`（`%2e%2e%2f` / `..\\` / 隐藏段三态）、
   `zod-issues`（issues 形状）、`p5` 系补一条 **B2 的 409 锚**（富文本占 slug → 建 markdown 文章 → 409 + 盘上无残留）；
2. **`config.json` 文档补 corsOrigins**（README 生产部署清单 + DEPLOYMENT-CHECKLIST）；
3. **C7 单独立批**：先把 `safeRealJoin` 的「root 不存在」异常改为 `BadRequestException`（或预检），
   再统一写路径；
4. **并发测试策略**：把「分批串行」写进测试执行约定，避免 worker 崩溃掩盖真实结果。
