# SECURITY-REVIEW — 安全复查报告（P11 §3.4）

| 字段 | 内容 |
|---|---|
| 阶段 | P11（收尾） |
| 日期 | 2026-08-27 |
| 复查依据 | MASTER-PLAN §7（9 条安全要点）+ REQUIREMENTS §15（16 条硬性约束）；交叉参照 REQUIREMENTS §9 |
| 复查方法 | 逐条对照实现源码与测试用例（路径精确到 `文件:行号`，基于 P11 时点工作区）；`grep` 审查（SQL 拼接 / `as any` / `@ts-ignore` / 出站 HTTP / `fs.writeFile` 分布）；全量回归 `pnpm test && pnpm build && pnpm lint` |
| 结论 | **9 条安全条款全部 ✅；16 条硬性约束全部 ✅；无 ❌；⚠️ 0 条**（备注级观察 4 条，见疑问清单） |

> 路径均相对 `apps/server/`；测试合计 240 用例（P11 时点：单元 113 + e2e 127，含 P11 新增静态面板 12 + 全新链路 5）。

---

## 一、MASTER-PLAN §7 安全条款逐项（P11 §3.4 九条）

### 1. 路径监狱（safeJoin + realpath，攻击用例单测） — ✅

- **落实**：`src/common/security/safe-join.ts` — `safeJoin` L42-73（空字节入口拒绝 L43-45 → `resolve` + 前缀主防线 L25-31 → URL 解码复查 L56-65 → 反斜杠变体复查 L66-68）；符号链接逃逸由 `safeRealJoin` L84-106 防御（对最深层已存在祖先 `realpathSync` 校验 L90-101）。
- **证据**：`test/common/safe-join.spec.ts` 19 用例——攻击面 9 例：`../` 穿越、注入外部绝对路径、多层穿越 `a/b/../../../../evil`、Windows 反斜杠 `..\..\evil.txt`、URL 编码 `%2e%2e%2f`、URL 编码反斜杠 `..%5C`、混合穿越、空字节两种形态；realpath 防护 6 例（symlink 逃逸拒绝、root 内互指放行等）。全项目文件路径唯一入口（MASTER-PLAN §9.4），业务模块（posts/albums/media/collections）调用点经 zod 白名单二次约束（如 `PostSlugSchema` 正则）。
- **状态**：✅

### 2. 上传管线五件套（白名单/魔数/10MB/随机名/sharp 重编码） — ✅

- **落实**：`src/modules/media/media.service.ts` `upload()` L97-170——① 扩展名白名单 `EXTENSION_FORMAT`（jpg/jpeg/png/webp/gif，`src/common/security/magic-sniff.ts` L14-20，自研魔数嗅探见 ADR-006）② 魔数一致性校验（伪造扩展名 → 400，L105-108）③ 大小上限 `uploadLimitMb` 默认 10MB → 413（L110-113，`src/config/app-config.ts` L23）④ 随机文件名 `${nanoid()}.${ext}`（L136-137）⑤ sharp 重编码（`.rotate()` 应用 EXIF 方向后剥离元数据，L114-133；按原格式重编码 L223-234）。
- **相册侧**：`src/modules/albums/albums.service.ts` `uploadImage()` L191-234 复用同一套校验（白名单+魔数+上限）后统一转 JPG（L215，重编码去 EXIF）。媒体与相册为同规则平行实现（相册产物规格不同：恒 JPG）。
- **证据**：`test/p7-media-albums.e2e-spec.ts`——`伪造扩展名：文本文件改名 .png → 400`、`大小上限：超限 → 413`、`重编码去元数据：含 EXIF 的 JPEG 上传后产物无 EXIF`；`test/common/security/magic-sniff.spec.ts` 6 用例。
- **状态**：✅

### 3. 进程安全（白名单、shell:false、env 透传限制、tree-kill） — ✅

- **落实**：`src/modules/process/process-manager.service.ts`——任务白名单硬编码 `['install','dev','build','preview']`（L36），body 经 `z.enum` 校验（L40-42）且参数逐字固定映射（L376-381，不接受附加参数）；`cross-spawn` 且 `shell: false`（L402，命令注入根防线）；env 仅透传 `PATH/HOME/APPDATA`（childEnv() L384-394）；POSIX `detached` 进程组（L401）+ `tree-kill` 整组停止（L407-415，优雅停机超时 SIGKILL L218-256）；cwd 经 safeJoin 锁定（L334-347）。
- **证据**：`test/modules/process/process-manager.spec.ts`——`shell 恒为 false`、`env 白名单：仅透传 PATH/HOME/APPDATA`、`任务白名单恰为四项`、`白名单拒绝：注入串与任意未知任务 → 400 语义`；`test/p9-process.e2e-spec.ts` 8 用例（含 `app.close() 后子进程全部退出、无孤儿`）。
- **状态**：✅

### 4. XSS（TipTap JSON 信任源 + sanitize-html，markdown 同过滤） — ✅

- **落实**：sanitize-html 调用集中单点 `src/common/render/render.ts`——`renderMarkdownToSafeHtml`（marked → sanitizeHtml，L45-48）、`sanitizeHtmlFragment`（L51-53）、`renderTipTapDoc`（自研转义渲染器 + sanitize 纵深防御，L60-62）；白名单 `SANITIZE_OPTIONS` L20-42（allowedSchemes 仅 http/https/mailto/tel，`disallowedTagsMode: 'discard'`）。富文本以 TipTap JSON 存 `article_content.doc_json`（`src/infra/db/schema.ts` L58-67），公开输出仅两途：markdown 渲染（`articles.service.ts` L355）或存储的 `html_cache`（create L152 / update L200，均经 render 管线）；前端不执行后端 HTML（P10c §5 禁 v-html）。
- **证据**：`test/common/render/render.spec.ts` 8 用例（`<script>` 清除、`javascript:` 协议剥离、内联事件剥离、TipTap 转义、iframe 剥离）；`test/p8-articles-public.e2e-spec.ts`——`<script> 注入被清除：html_cache 与公开详情均无 script/事件属性/javascript:`、`markdown 渲染同样过 sanitize`。
- **状态**：✅

### 5. SQL（Drizzle 全参数化——抽查无字符串拼接） — ✅

- **落实**：`src/infra/db/db.module.ts` L41（`drizzle(sqlite, { schema })`）；src 下全部数据访问为 query builder（select/insert/update/delete + eq/and/desc/limit/offset，27 处，分布于 auth/articles/posts/media/settings/backup/system/operation-log）。
- **抽查**：字符串拼接 SQL 零命中（grep 无 `db.run` / `db.all` / `db.exec` / `sql.raw` / `prepare(` / SQL 字符串字面量）。`sql` 模板仅 2 处且为静态无插值：`auth.service.ts:86` 与 `system.controller.ts:101`，均为 `sql<number>\`count(*)\``（聚合计数，不含用户输入；分页 limit/offset 经 `clampInt` 整数收敛后由 builder 传参）。
- **状态**：✅

### 6. 认证（argon2id、JWT 双 Token、守卫全覆盖、登录限流与锁定） — ✅

- **落实**：argon2id 哈希（`src/modules/auth/auth.service.ts` L116 `argon2.hash(pw, { type: argon2.argon2id })`，verify L144；哑元哈希恒定时间缓解 L134-137/L305-309）；JWT 双 Token（jose，HS256，`ACCESS_TTL='15m'`/`REFRESH_TTL='7d'` L64-65，jti=nanoid L218-227，refresh 轮换 L172-180，type claim 校验 L230-245）；全局守卫 `src/app.module.ts` L64-67（APP_GUARD：ThrottlerGuard 先于 JwtAuthGuard）+ `@Public` 豁免机制（`public.decorator.ts` / `jwt-auth.guard.ts` L53-60）；登录路由级限流 5 次/分（`auth.controller.ts` L33）；失败锁定：5 次失败锁 15 分钟（L67-69，第 5 次 → 423 L139-160，成功清零 L163-166）；密码最短 8 位（InitBodySchema L58）。
- **证据**：`test/p6-auth.e2e-spec.ts` 17 用例——init 前无 token 矩阵（status 401 / health、detect 200）、既有模块（collections/posts/backup）无 token 一律 401、伪造签名/过期 token 401、refresh 轮换、无效 refresh 401、连续 5 次失败后正确密码 423、锁定跨实例持续、登录限流第 6 次 429。
- **状态**：✅（备注 A-1：argon2 未显式设定成本参数，取库默认值，见疑问清单）

### 7. 备份与回滚（pre_write 保留 10 份、restore confirm、恢复前备份） — ✅

- **落实**：`src/infra/backup/backup.service.ts`——`PRE_WRITE_KEEP = 10`（L70）+ 保留清理 `enforcePreWriteRetention` L359-385；restore 必须显式确认（`backup.controller.ts` `z.literal(true)` L35 + 运行时双保险 L67-70）；恢复前安全备份（db → `.backup()` 快照 L150-153；文件 → 现存文件快照 L154-161）；manifest sha256 完整性校验（L164-174）+ 原子回写（L204-213）。
- **证据**：`test/p2-backup.e2e-spec.ts` 13 用例（`不带 confirm → 400`、`confirm:false → 400`、`{confirm:true} → 200 且源文件恢复原始内容`）；`test/infra/backup.service.spec.ts` 14 用例（`连续 11 份 pre_write 仅剩最近 10 份`、`db 备份恢复前自动快照`、`manifest 篯改 ../ 路径 → 恢复被拒`、`preWriteBackup 目标逃逸 → 403`）。
- **状态**：✅

### 8. CORS 白名单 + 全局限流 — ✅

- **落实**：`src/app.setup.ts`——CORS 白名单默认仅 `http://localhost:${port}`（20154，L19-30 + L46）；helmet 安全头（L44）。限流：全局 60 次/分（`src/app.module.ts` L30 `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])` + L64 APP_GUARD），登录独立 5 次/分（见第 6 条）。
- **证据**：`test/p1-security.e2e-spec.ts`——helmet 头断言、`localhost origin 响应携带 Access-Control-Allow-Origin`、`非白名单 origin 不携带`、`非白名单预检不被允许`、`同 IP 第 61 次 → 429`；登录 429 见 p6-auth。
- **状态**：✅

### 9. 操作日志脱敏（无密码/token） — ✅

- **落实**：`src/common/interceptors/operation-log.interceptor.ts`（APP_INTERCEPTOR 注册于 app.module.ts L69）——审计范围：POST/PATCH/DELETE 且 `/api/v1/admin/` 前缀（L21-22/L47）；记录字段固定白名单（id/userId/method/path/action/target/detail/ip/createdAt，L60-72）；脱敏：`SENSITIVE_KEY_HINTS = ['password','token','secret','authorization','credential']` 递归掩码为 `***`（L25-26/L89-106），authorization 头固定掩码（L82-84），其余请求头不入库；异步写失败仅记日志不冒泡（L52-56）。
- **证据**：`test/p6-auth.e2e-spec.ts` `操作日志：登录有记录，detail 密码掩码且不含明文密码/Token`（断言 detail 含 `"password":"***"` 且不含明文密码/accessToken/refreshToken）；登出同样被记录。
- **状态**：✅

---

## 二、REQUIREMENTS §15 硬性约束 16 条逐项

| # | 约束 | 落实位置与证据 | 状态 |
|---|---|---|---|
| 1 | 默认地址 localhost:20154，全局前缀 /api/v1 | `app.setup.ts` `setGlobalPrefix('api/v1')` L42；`main.ts` 端口默认 20154；e2e 全部以 `/api/v1/...` 断言 | ✅ |
| 2 | 管理/公开接口分离：前者强认证、后者限流 | 全局 JwtAuthGuard + `@Public` 豁免；公开路由同样过全局限流（p1/p8 e2e：公开 401-free + 429） | ✅ |
| 3 | 技术栈锁定 Node/TS，无第二运行时 | monorepo 仅 Node 侧（apps/server NestJS + apps/web Vite 前端）；无 Python/Java/Go 产物 | ✅ |
| 4 | app.py 能力以 ts-morph AST 复刻，禁止文本 hack | `data-file.service.ts` ts-morph 初始化器改写；golden 测试断言「外部字节不变」（`test/modules/data-files/golden.spec.ts` 7 用例，前后缀逐字节相等断言） | ✅ |
| 5 | 保留 Mizuki 静态文章能力（markdown 静态加载、富文本走库） | posts 模块 markdown 文件读写（P5）；article 表 `source_type` 区分，混合列表聚合两源（P8） | ✅ |
| 6 | 文章类型在数据库明确标识 | `schema.ts` L33 `sourceType text('source_type').notNull()` + L53 索引 | ✅ |
| 7 | 六类集合内容不建数据库表 | 11 张表清单（`app.e2e-spec.ts` L29-58 断言）无集合表；集合数据文件即数据库（P3/P4） | ✅ |
| 8 | 覆盖/删除必须：确认+备份+可回滚+日志 | restore `confirm:true`；pre_write 备份 + 恢复前快照；operation_log 审计写操作（p2/p6 e2e） | ✅ |
| 9 | JWT 权限体系，密码 argon2 哈希 | 见安全条款 6 | ✅ |
| 10 | 删除操作优先备份/回收站 | posts 删除先备份（P5 e2e `删除文章（先备份，可经备份恢复）`）；相册/媒体删除经引用检查与备份路径（P7） | ✅ |
| 11 | 高安全基线（防注入/越权/穿越/XSS/命令注入） | 见第一部分全部 9 条 | ✅ |
| 12 | 网页内可启动/构建/预览/停止 Mizuki | process 模块五端点 + P10d 控制台页（SSE 日志 + 启停按钮）；p9-process e2e 8 用例 | ✅ |
| 13 | 先 MVP，AI 功能后置 | MVP 不做项（评论/统计/搜索/AI/多主题/插件/自动部署）均未实现——全部模块对照 REQUIREMENTS §13 无越界实现 | ✅ |
| 14 | 公开 API 路径 P8 定型后不再变更 | P8 冻结清单（`/public/articles`、`/public/collections/:type`、`/public/albums`）；P9–P11 零路径变更，P11 仅加 Swagger 装饰器（不改行为） | ✅ |
| 15 | 领域模块禁止互 import（lint 强制） | 根 `eslint.config.mjs` eslint-plugin-boundaries L0-L3 分层；P0b 验收「故意跨模块 import 被 lint 报 error」；P11 回归 lint 绿 | ✅ |
| 16 | 事件发射点位于写入管线成功出口恰好一次；订阅者幂等不冒泡 | 事件全部定义于 `packages/shared/events.ts`（禁字面量 emit/on）；发射点在写管线成功出口（P4 collections/P5 posts/P8 articles/P9 process）；订阅者幂等 + 异常内部捕获（P8 索引增量更新等） | ✅ |

---

## 三、补充核查（REQUIREMENTS §9 非九条清单项）

- **SSRF（§9.7）**：✅ — src 内出站 HTTP 零命中（grep `fetch(`/`axios`/`got(`/`http.request` 均 0）；服务端不主动请求用户提供的 URL，符合 MVP 边界。
- **依赖锁定（§9.10）**：✅ — `pnpm-lock.yaml` 提交仓库；版本基线记 ADR-001。定期 `pnpm audit` 属运维惯例，建议列入后续运维清单（非代码项）。
- **编码守则 §9.3（fs.writeFile 域限制）**：✅（含两处已裁决例外）— 命中 7 处：backup（manifest）、media（产物原子写）、data-files（数据文件原子写）三域内 5 处；域外 2 处均为「同目录 `.tmp-<nanoid>` + rename」原子写模式的组成部分——`posts.service.ts:464`（P5 交付报告疑问表第 6 条已裁决：临时文件属统一写管线而非裸写）；`auth.service.ts:296`（config.json 合并持久化，ADR-005 JWT secret 持久化决策的组成部分，仅 init 一次性触发）。
- **类型纪律**：✅ — src 内 `as any` / `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` 零命中；strict TS 全绿（build）。

---

## 四、疑问清单（⚠️/❌ 条目与备注）

**无 ❌ 条目，无 ⚠️ 条目。** 以下为备注级观察（不阻塞交付，供后续阶段参考）：

1. **A-1（备注）argon2 成本参数取库默认值**：`argon2.hash` 显式指定 `argon2id` 但未自定义 timeCost/memoryCost（node-argon2 默认 t=3, m=4096KiB, p=1）。规格仅要求「argon2 哈希」（已满足）；如需对齐 OWASP 2024 推荐档位（m=19MiB）可后续调整，属加固项非缺陷。
2. **A-2（备注）相册上传为同规则平行实现**：albums 未复用 MediaService（产物规格不同：恒 JPG），白名单/魔数/上限/sharp 重编码规则一致。若未来调整规则需同步两处；可在二期抽公共上传校验模块。
3. **A-3（备注）Swagger 描述深度**：全部端点已具备方法/路径/中文摘要与 Bearer 声明，上传端点标注 multipart binary；DTO 字段级 schema 未逐一展开（P11 §3.1 允许的合理水平）。完整结构见 `/api/v1/docs-json`。
4. **A-4（备注）MVP 范围确认**：未实现任何 §13 明确不做项；comment 表已建但二期启用（建表属 P0b 数据库定型的既定内容，非越界实现）。

## 五、结论

9 条安全条款与 16 条硬性约束全部落实且各有代码与测试证据；240 个测试用例 + 全量构建 + lint 于 P11 回归全绿；§6.1 全新环境链路冒烟（install → build → bin 启动 → init → 登录 → 面板可用）实测通过，过程中发现并修复的 3 处缺陷（bin bootstrap 守卫、SPA 回退点目录 404、BACKUP_OPTIONS 启动快照）均已补 e2e 回归（见 P11 交付报告）。安全态势满足 MVP 要求，可交付。
