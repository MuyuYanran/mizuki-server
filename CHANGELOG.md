# 变更日志

## P10b — 六类集合管理页（zod schema 驱动表单）

- `src/lib/schema-form/`（新建，核心）：`mapper.ts` 自写 zod→表单描述符映射器（ADR-007）——遍历 `ZodObject.shape`，按 `constructor.name` 分派到 string/boolean/number/array/object/enum/optional 八类分支，产出 `FieldDescriptor[]`（含 widget/required/options/children）；`SchemaForm.vue` 按描述符渲染 Element Plus 控件，提交前用**同一份 schema** 在浏览器端 `safeParse` 一次（错误按 `issue.path` 逐字段提示）；后端 400 的 `detail.issues` 同样按 path 映射到字段
- 映射规则：`ZodString` 长文本字段（content/description 白名单）→ textarea、URL 字段（含 url/site）→ 带占位提示、`ZodBoolean`→switch、`ZodNumber`→input-number、`ZodArray<ZodString>`→标签输入（回车追加/删尾）、`ZodEnum`→select、嵌套 `ZodObject`（skills.experience）→子字段组、`ZodOptional`→解包+非必填
- `src/views/collections/CollectionListPage.vue`（新建）：单组件按路由 `:type` 复用六类——array 形表格展示+新增/编辑/删除；grouped 形（devices）先选分组再展示、新增带 group、删除后重新拉取（空分组由后端清理）；表格列由 schema 顶层字段推导；长文本/数组截断展示
- `src/api/collections.ts`（新建）：collections 端点客户端——list/create/update/remove 四方法 + `isGrouped` 类型守卫 + `extractFieldIssues`（后端 `detail.issues`→字段错误映射）；复用 `src/api/http.ts` 的 401 自动 refresh
- 路由：`/collections/:type` 单动态路由接入主布局（替换 P10a 占位），`:type` 非法时 404 占位；`MainLayout.vue` 菜单六类指向真实路由
- 跨包：`packages/shared/package.json` 追加 `typescript` devDep（构建产物 tsc 需要）；`apps/web/package.json` 追加 `@mizuki/shared` workspace + `zod` 依赖；`apps/web/vite.config.ts` 加 `resolve.alias`（@mizuki/shared→src/index.ts，避开 CJS 产物 `__exportStar` 的 rollup 静态分析缺口）+ `optimizeDeps.include:['zod']`
- 渲染策略 ADR-007：自写映射器，不引入 `zod-to-json-schema`（字段类型面 ≤8 分支，零新依赖，zod v4 直连内省 API）
- 验收：根三连全绿（test 223/223、`pnpm -r build` 三项目、lint 0/0）；`pnpm --filter @mizuki/web build`（vue-tsc strict + vite build）通过；手动交互项（六类 CRUD/浏览器端 schema 校验/grouped 空分组清理/409 明细）列人工补验清单（SESSIONS）

## P10a — 管理面板外壳：工程、登录、向导、布局与请求层

- `apps/web` 完整 Vite + Vue 3 + TS(strict) 工程落地：`index.html`、`vite.config.ts`（dev 端口 20155，`/api` 代理 → `http://localhost:20154`）、`tsconfig.json`（strict + noUncheckedIndexedAccess，独立于根 base 的 CJS 配置）、`src/{main.ts, App.vue, env.d.ts}`
- `src/router/index.ts`：路由表 + 守卫——白名单 `/login`、`/init`（meta.public）；无 accessToken 一律回 `/login`（携带 redirect）；已登录访问 `/login` 重定向主页；主布局子路由 13 项（仪表盘 + 12 占位，P10b/c/d 替换）
- `src/views/`：`LoginView.vue`（表单 → login → 存 token → `me` → 主布局；401/423/429 分别提示；挂载时经 `GET /system/health` 的 `initialized` 判断未初始化并引导向导——P6 §3.2 定口径）、`InitWizardView.vue`（四步：欢迎 → 目录 + `detect` 逐项明细展示 + 包管理器探测 → 三模式说明选择 → 账号（含确认密码）→ `init`；409 → 提示并跳登录）、`DashboardPlaceholder.vue`、`PlaceholderView.vue`（单组件复用，标题取自路由 meta）
- `src/layouts/MainLayout.vue`：顶栏（项目名 + 管理员 + 登出）+ 侧边栏（仪表盘/文章/日记/友链/项目/时间线/技能/设备/相册/媒体库/备份/构建预览/设置 全 13 项，el-menu router 模式）+ 内容区
- `src/api/`：`http.ts` 统一请求层（**401 自动 refresh 并重放一次；并发 401 共享同一 refresh Promise 去重**；刷新失败清 token + 会话失效回调；适配 `{code,message,detail}` 异常格式抛 `ApiError`）、`auth.ts`、`system.ts`（路径常量集中，组件零裸 URL）
- `src/stores/auth.ts`：reactive store + localStorage 持久化（`mizuki.accessToken` / `mizuki.refreshToken`）；refreshToken 仅用于 refresh 调用（纪律）
- 依赖（已记 ADR-001）：vue 3.5.41 / vue-router 4.6.4 / element-plus 2.14.5（**完整引入**，取舍记报告）/ vite 7.3.6 / @vitejs/plugin-vue 6.0.8 / vue-tsc 3.3.11 / typescript 5.9.3；**未引入 axios/pinia**（fetch 封装 + reactive store，取舍记报告）
- 根 `eslint.config.mjs`：ignores 追加 `apps/web/**`（§4.2「显式排除」选项，不新增 lint 依赖）；`apps/web/README.md` 更新
- 验收：根三连全绿（test 223/223、`pnpm -r build` 三项目、lint 0/0）；`pnpm --filter @mizuki/web build` 成功（`dist/` 产物）；集成冒烟：后端 dist 全路由注册 + 前端产物经 `vite preview` 可服务；手动交互项（登录/守卫/401 刷新/向导走查）列人工补验清单（SESSIONS）

## P9 — 进程管理：白名单子进程与 SSE 日志

- `process/{process.module, process.controller, process-manager.service}.ts`：三 stub 转正——任务白名单硬编码 `install/dev/build/preview`（zod enum，注入串/未知任务 → 400）；参数映射逐字固定（`install`：yarn 无参、其余 `<PM> install`；`dev/build/preview`：`<PM> run <task>`），不接受用户附加参数；包管理器按工作目录 lockfile 探测（pnpm > yarn > npm，均无默认）
- spawn 安全规格（MASTER-PLAN §7 逐字）：cross-spawn `shell:false`；env 仅透传 `PATH/HOME/APPDATA`（`childEnv` 白名单）；POSIX `detached:true` 进程组（Windows 按平台行为，取舍记报告）；工作目录锁定 `mizukiRoot`（safeJoin）；停止统一 `tree-kill(pid)` 整组
- 日志：内存环形缓冲 2000 行（超丢最旧），stdout/stderr 合并按行切分（`[stderr] `/`[error] ` 标源，半残片保留）；`GET /admin/process/tasks/:id/logs`（@Sse）先回放缓冲再实时推送，终态发 `exit` 事件后 `complete`，连接断开清理订阅
- 生命周期：内存任务表（status running/exited/killed、pid、exitCode、startedAt/finishedAt）；`POST /admin/process/tasks`（201 返回 id/pid）；`GET tasks/:id`；`DELETE tasks/:id`（tree-kill → killed）；`GET ports/:port`（`net.createServer().listen` 探测法，取舍记报告）
- 优雅停机：`ProcessManagerService implements OnApplicationShutdown`——停全部 running → 等 5s → 超时 SIGKILL 强杀 → 关闭全部 SSE 观察者 → pino 停机摘要（停止数/强杀数）；停机后拒绝新任务；`main.ts` 追加 `app.enableShutdownHooks()`（§2 授权的唯一既有文件改动）
- 事件：`process.finished`（自然/异常/被 kill 均发射；被杀无实际退出码时记 `-1`，约定记报告），`ProcessFinishedPayload.parse` 后恰好一次
- 夹具：`test/fixtures/mini-project/`（§2 授权的最小子项目：零依赖，`dev/preview` 长驻心跳、`build` 同步写 2500 行后自然退出；不复用假 Mizuki 执行真实构建）
- 测试新增 2 文件 14 用例：安全单测 6（shell:false / env 白名单泄漏断言 / 白名单恰四项 / 注入拒绝 / 参数映射 / 探测优先级）+ e2e 8（含 4 条 slow：启停+SSE、优雅停机、白名单四项、事件断言）。全仓 223/223 绿

## P8 — 富文本文章、混合公开 API（路径定型）与 settings（关卡：公开 API 定型）

- `articles/{articles.module, articles.controller, articles.service}.ts`：三 stub 转正——富文本 CRUD（`POST/PATCH` 收 `docJson`：对象含 `type` 即合法，深层按信任源不过度约束，取舍记报告；服务端经转义渲染器 + sanitize 生成 `html_cache`；slug 显式指定冲突 409 / 未指定由 title 生成自动避碰；`status` 双态；DELETE 软删）；发布出口发射 `article.published`（`sourceType:'richtext'`，payload 先 parse）；`@OnEvent(post.changed)` 订阅者：删除→软删行，否则按 `file_hash` 幂等 upsert（哈希一致且未软删 → 零写入）；`@OnEvent(article.published)` → 公开列表首页缓存置空失效；公开列表（`status='published'` 且未软删，`pub_date` 降序 + `created_at` 次序，两源交错）；公开详情（markdown 读源文件 → marked + sanitize 渲染 + frontmatter；richtext 返回 `html_cache`）
- `articles.controller.ts` 双控制器：`ArticlesController`（admin）+ `PublicArticlesController`（@Public，`/public/articles` 与 `/public/articles/:slug`）；分页 `?page=&limit=`（默认 1/10，limit>50 → 400）
- `settings/{settings.module, settings.controller, settings.service}.ts`：三 stub 转正——`site_setting` key-value（GET 全量 / PUT `:key` upsert JSON 序列化 / DELETE，缺键 404；key 安全字符集校验）；写入成功发射 `content.changed`（scope='settings'，filePaths=[]）；**路径为规格补白**（MASTER-PLAN §5 未列，见交付报告疑问清单）
- `common/render/`（新建）：渲染统一安全出口——`renderMarkdownToSafeHtml`（marked → sanitize-html）、`renderTipTapDoc`（最小 TipTap JSON → HTML 渲染器：文本/属性值全转义、未知节点仅渲染子节点、marks 支持 bold/italic/code/strike/link）、`sanitizeHtmlFragment`；白名单 = 排版标签集 + `a/img` 受限属性 + scheme 仅 `http/https/mailto/tel`，`script`/`on*`/`javascript:` 全部剥离；附 `sanitize-html.d.ts` 最小环境声明（@types 不在依赖清单且禁新增）
- `articles/media-reference.ts`（新建）：第四个媒体引用贡献者（`article.cover` 非空未软删行 → `article-cover`），`ArticlesModule.onModuleInit` 注册——P7 注册表四方就位
- `collections/public-collections.controller.ts`（新建）：`GET /public/collections/:type`（@Public；`:type` 白名单同 P4 未知 400；`public: false` → 404；读取经 DataFileService value-cache）；`albums/public-albums.controller.ts`（新建）：`GET /public/albums`（@Public；元信息 + 图片文件名列表）；两模块 `controllers` 数组追加（§2 授权）
- **公开路径自此冻结**（MASTER-PLAN §9 守则 8）：`/public/articles`、`/public/articles/:slug`、`/public/collections/:type`、`/public/albums`；评论端点二期不实现（表已建，P0b）
- 测试新增 2 文件 22 用例：render 单测 8（双渲染路径 × 三类注入 + 结构输出 + iframe 剥离）+ e2e 14。全仓 209/209 绿

## P7 — 媒体上传管线、相册与引用检查注册表

- `media/{media.module, media.controller, media.service}.ts`：三 stub 转正——上传五件套顺序执行：① 扩展名白名单（`jpg/jpeg/png/webp/gif`）→ ② 魔数嗅探与扩展名比对（不符即拒）→ ③ 配置上限（默认 10MB，413）→ ④ 随机文件名 `<nanoid>.<ext>` 写 `public/images/uploads/`（safeJoin + 自动建目录）→ ⑤ sharp 按原格式重编码（`.rotate()` 应用 EXIF 方向后剥离全部元数据）并读宽高的确；`media_file` 索引入库（path/original_name/mime/size/width/height/sha256）；列表倒序；`DELETE /admin/media/:id`：注册表 `collectAll()` 聚合引用 → 命中 → **409 + `detail.references[{refType,targetLabel}]`**；无引用 → `preWriteBackup` → 删文件与行；成功出口发射 `media.changed`
- `albums/{albums.module, albums.controller, albums.service}.ts`：三 stub 转正——目录 `public/images/albums/<名>/` + `info.json`（REQUIREMENTS §6.9 字段逐字，zod 校验）；创建（重名 409）/ 修改（增量合并整体校验 + pre_write 备份）/ 删除（引用前缀检查 → 逐文件备份 → 删目录）；图片上传复用五件套校验 + **非 JPG 自动转 JPG**（文件名保持 `<原名>.jpg` 语义，同名冲突追加 `-${nanoid(6)}` 并记日志）；图片删除（引用检查后备份删除）；相册元数据写入发射 `content.changed`（scope='album'），图片保存/删除发射 `media.changed`
- `packages/shared/src/media-reference.ts`（新建）：`MediaReference` / `MediaReferenceContributor` 纯类型（P7 §3.4 签名逐字，字段名不可改）；`index.ts` 追加导出
- `common/registry/media-reference.registry.ts`（新建）：注册表宿主 + `@Global MediaReferenceRegistryModule`——`register`（重名拒绝告警）/ `names()` / `collectAll()`（单贡献者失败记日志不冒泡）；`app.module.ts` 注册
- 注册方检查器（新建）：`posts/media-reference.ts`（frontmatter `image` → `post-cover`；无前缀 `/` 的值按相对文章目录归一）、`collections/media-reference.ts`（diary `images[]`/projects `image`/devices grouped `image`，按注册表 `imageDir` 归一，DataFileService 只读）；`posts.module.ts` / `collections.module.ts` 以 `onModuleInit` 注册；`AlbumsService` 自身实现贡献者（info 无封面字段 → 空集占位，取舍记报告）。**articles 注册留 P8**
- `common/security/magic-sniff.ts`（新建）：最小魔数嗅探器纯函数（JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF…WEBP` / GIF `GIF87a|GIF89a`）+ 扩展名映射表——**人工定案不引入 `file-type`**（v16 停维、v17+ ESM-only 与 CJS 不兼容），已记 **ADR-006**
- 分层决策：上传文件结构接口 `UploadedFileLike` 在 media/albums 各自局部声明（与 posts 同构），避免 L2 互 import（boundaries error 拦截过一次，见交付报告）
- 测试新增 2 文件 20 用例：magic-sniff 单测 6（四格式 + 非图片 + 映射表）+ e2e 14（伪造拒绝、合法入库、413、EXIF 剥离、引用 409 + 明细、无引用删除、四模块注册 + 第 4 插槽、相册 CRUD + 转 JPG、路径防护、事件、边界）。全仓 187/187 绿

## P6 — 认证与初始化（关卡：安全边界定型）

- `auth/{auth.module, auth.controller, auth.service}.ts`：三 stub 转正——登录（argon2id 校验、用户不存在时哑元哈希恒定时间行为、失败计数 5 次 → `locked_until` 锁 15 分钟并清零计数、锁定期正确密码也拒 423）、jose HS256 双 Token（access 15m / refresh 7d；claims：sub/username/type/jti/iat/exp；`setExpirationTime` 相对时间串——jose v6 无 setExpirationIn）、`POST /admin/auth/refresh` 轮换签发新对（校验 type='refresh' + 用户仍存在）、无状态 `logout`、`GET /admin/auth/me`；JWT secret 三级解析（env `MIZUKI_JWT_SECRET` → config.jwtSecret → 兜底生成持久化，见 **ADR-005**）；`initialize`：已初始化 409 先行 → detector 四项检测（失败 400 附 checks 明细）→ argon2id 建管理员 → config.json 合并原子写（mizukiRoot/mode/jwtSecret）→ 刷新配置单例。登录路由级 `@Throttle` 5 次/分（独立于 P1 全局 60 次/分）
- `common/guards/jwt-auth.guard.ts`：全局守卫转正——经 `APP_GUARD` 注册（顺序在 ThrottlerGuard 之后：限流先于认证）；`@Public()` 豁免（`IS_PUBLIC_KEY` 元数据）；Bearer 提取 + `verifyAccessToken`（签名/时效/类型/用户存在四重校验）；拒绝日志不输出 token 内容。**跨层解耦**：守卫（L0）不 import auth 模块（L3），经 `ACCESS_TOKEN_VERIFIER` Symbol token 注入 `AccessTokenVerifier` 接口，AuthModule 以 `useExisting: AuthService` 提供（boundaries 合规）
- `common/decorators/public.decorator.ts`：`SetMetadata` 实现转正；豁免清单逐字：`/system/health`、`/admin/auth/login`、`/admin/auth/refresh`、`/system/detect`、`/system/init`（+ `/public/**` P8 落地）
- `common/interceptors/operation-log.interceptor.ts`：转正——`APP_INTERCEPTOR` 全局（DI 注入 drizzle；与 §4.3 `useGlobalInterceptors` 等效的取舍见交付报告）；审计 `/api/v1/admin/**` 的 POST/PATCH/DELETE；detail = body 递归脱敏（键名含 password/token/secret/authorization/credential → `***`）+ authorization 头掩码；异步写失败仅记 pino 不影响响应
- `modules/system/mizuki-detector.service.ts`：转正——MASTER-PLAN §4.3 四项检测（package.json 含 astro / astro.config.{mjs,ts,js} / src/data 含 diary|friends / src/content/posts）+ 包管理器 lockfile 探测（无 lockfile 默认 npm 并在 checks 注明）
- `modules/system/system.controller.ts`：扩展——`GET /system/health` 标 `@Public()` 且响应追加 `initialized`（admin_user 有无行）；`GET /system/status`（需认证：initialized/mode/version/uptime）；`POST /system/detect`（@Public）；`POST /system/init`（@Public，一次性）；**`GET /admin/system/logs`（规格补白：operation_log `?page=&limit=` created_at 倒序，MASTER-PLAN §5 未列，处理同 P8 settings 补白，见交付报告疑问清单）**；控制器改 `@Controller()` 显式全路径以容纳双前缀路由
- `modules/system/system.module.ts`：提供并导出 `MizukiDetectorService`；与 AuthModule 互为依赖（detector ← init 端点）双侧 `forwardRef` 破环（L3 互导合法）
- `app.module.ts`：providers 追加 `{APP_GUARD: JwtAuthGuard}`（ThrottlerGuard 之后）与 `{APP_INTERCEPTOR: OperationLogInterceptor}`
- `config/app-config.ts`：`AppConfigSchema` 追加可选 `jwtSecret`；`defaultConfigPath()` 支持 `MIZUKI_CONFIG_PATH` 覆盖（测试钩子，同 `MIZUKI_DB_PATH` 模式，见 ADR-005）
- 测试：新增 2 文件 24 用例（p6 e2e 17 + detector 单测 7）+ `test/helpers/admin-auth.ts`（initAndLogin + withAuth 代理）；既有 e2e 守卫适配（交付报告 §6.11）：p2/p4/p5 经 init+login 取 token 全请求附加、p1 测试控制器 `@Public()`、p2 补齐检测结构。全仓 167/167 绿
- 新增 ADR-005（JWT secret 管理与配置路径测试钩子）；零新增依赖（jose/argon2/@nestjs/throttler 均在 P0a 清单）

## P5 — Markdown 文章（Posts）读写与索引同步

- `common/markdown/frontmatter.ts`（新建）：gray-matter 包装提升至 L0 纯工具层（MASTER-PLAN §4 合法解耦通道，供 posts 与 P8 复用）——`parseMarkdown`/`stringifyMarkdown` 往返保真：未知字段原样保留、键序不变、已知字段类型不漂移；补偿 gray-matter stringify 追加换行行为，正文逐字节精确往返；空 frontmatter 不产生分隔符块
- `posts/posts.service.ts`：文章目录管理转正——列表（含 frontmatter 摘要与派生 status）/ 读单篇 / 创建（目录已存在 409）/ 修改（frontmatter 增量合并 + 正文可选）/ 删除（目录逐文件 `preWriteBackup` 后删目录，返回 backupIds 可经备份恢复；索引行软删对齐回收站语义）；封面上传（扩展名白名单 `jpg/jpeg/png/webp/gif` + sharp 可解码校验替代魔数嗅探 + 配置上限检查 → `sharp().rotate().jpeg()` 转 JPG 去 EXIF → 原子写 `cover.jpg` → frontmatter `image` 更新）；`syncIndex` 重建 `article` 表 `source_type='markdown'` 索引（磁盘有表无→insert；哈希变化或软删态→update；哈希一致→零写入；表有磁盘无→`deleted_at` 软删；幂等）；about 页读写（`src/content/spec/about.md`，pre_write 备份 + 原子写，覆盖不删除）。全部写入走统一管线：safeJoin 路径监狱（越界 403）→ zod → `preWriteBackup` → 同目录 `.tmp-<nanoid>` + rename 原子写；slug 白名单校验（禁分隔符与 `..`，纵深防御再过 safeJoin）；创建/修改成功出口 upsert 索引行（published 事件需行 id）
- `posts/posts.controller.ts`：REST 转正——`GET/POST /admin/posts`、`POST /admin/posts/sync`、`GET/PATCH/DELETE /admin/posts/:slug`、`POST /admin/posts/:slug/cover`（multipart `file`，FileInterceptor）、`GET/PUT /admin/about`（归入 posts 控制器）；全部输入参数级 `ZodValidationPipe`；状态推导 `draft===true || published===false → 'draft'`
- `posts/posts.module.ts`：controllers/providers 填充（DbModule/InfraBackupModule 为 @Global 无需 imports）
- 事件发射（写入成功出口恰好一次，payload 先过 zod parse）：`post.changed`（创建/修改/删除，删除场景 `deleted:true` 携带删除前 frontmatter 与哈希）、`article.published`（结果状态 published 时，`sourceType:'markdown'`，upsert 后以行 id 发射）、`content.changed`（scope='post' 与 about 写入的 scope='about'，后者落地 events.ts 的 'about' 枚举）
- 零新增依赖（gray-matter/sharp/nanoid/multer 均在既有清单，multer 经 @nestjs/platform-express 内置引入；上传文件以最小结构接口 `UploadedFileLike` 类型化，不依赖 @types/multer）
- 测试新增 2 文件 23 用例：frontmatter 单测 6（解析/往返保真 12+1 字段/键序/空 frontmatter/YAML 日期语义）+ e2e 17（CRUD 全循环、`../` 穿越三路径拒绝、frontmatter 往返、封面转 JPEG + 伪造扩展名拒绝、删除经 REST restore 恢复、sync 三篇入库 + sha256 断言 + 幂等零写入、事件四类场景断言、about 往返/备份/恢复、404/409、列表）。全仓 143/143 绿

## P4 — 注册表驱动六类集合 CRUD

- `packages/shared/src/collections/`：六个 zod schema 转正（`DiaryItemSchema` / `FriendsItemSchema` / `ProjectsItemSchema` / `TimelineItemSchema`（含 `TimelineTypeSchema`）/ `SkillsItemSchema` / `DeviceItemSchema` + `DeviceGroupedSchema`），字段逐字对齐 REQUIREMENTS §6.3–6.8；**放 shared 的动机：P10 管理面板将由这些 schema 驱动生成表单，前后端复用同一份字段规格**；`src/index.ts` 追加导出
- `collections/registry.ts`（新建）：`CollectionDef` 接口 + `REGISTRY` 六类配置（MASTER-PLAN §4.2 逐字：diary/friends/projects/timeline/skills 为 array+idField=id；devices 为 grouped+idField=name+imageDir=public/images/device；全部 public:true）——新增内容类型 = 加一个配置对象
- `collections.service.ts`：CRUD 编排，全部读写经 DataFileService（P3 引擎唯一通道）——POST 无 id（devices 无 name）自动 nanoid、id 冲突 409、PATCH/DELETE 不存在 404；grouped：POST body 含 `group`（flat 结构）、PATCH 跨分组定位（stripGroup）、DELETE 后空分组键自动清理；timeline POST 未给 icon/color 按 type 填默认映射（**ADR-004 暂定值**，待真实 Mizuki 主题源码核对）；每次写入成功出口恰好一次发射 `content.changed`（scope='collection'、type、filePaths，payload 先过 zod parse）
- `collections.controller.ts`：单一控制器 + `:type` 动态路由（GET/POST/PATCH/DELETE `/admin/collections/:type[/:id]`）；路由第一步注册表白名单校验，未知 type → 400 且零文件读写
- `collections.module.ts`：imports DataFilesModule，providers CollectionsService，controllers CollectionsController
- 微调：`data-file.service.ts` 的 schema 参数放宽为 `z.ZodType`（P4 传入的 array/record schema 输出类型不定，引擎只用 parse 校验）
- 未建任何数据库表（文件即数据库，MASTER-PLAN §2 决策 1）
- 测试新增 2 文件 19 用例：e2e 13（五类全循环、devices 分组+空分组清理、未知 type 四方法 400、事件 payload 断言、非法 body 400+文件未改、id 生成+409、timeline 默认映射、写后 6 文件 tsc --noEmit、404）+ schema 单测 6（fixture 全条目过 schema、必填/类型拒绝、未知字段剥离）。全仓 120/120 绿

## P3 — ts-morph 数据文件引擎（关卡：引擎定型）

- `modules/data-files/` 7 个 stub 全部转正：
  - `evaluator.ts`：AST → JS 值——节点分派表逐字实现（Array/Object 递归、字符串/无插值模板取字面值、数字/布尔/null、as const / satisfies / 括号解包、前缀负号取负；模板插值/标识符/属性访问/Shorthand/Spread/Getter 抛 `UnsupportedLiteralError` **含文件名+行号**）；每次操作新建一次性 Project，彻底规避陈旧 AST
  - `serializer.ts`：`valueToTsLiteral`（JSON 即合法 TS + 键去引号纯美化）
  - `syntax-check.ts`：`assertSyntaxValid`（ts.transpileModule reportDiagnostics，syntax error 必须为 0，错误含行号）
  - `file-lock.ts`：`Map<path, Promise>` 链——同一文件串行、不同文件并行
  - `value-cache.ts`：mtime+size 键读缓存；写管线第 8 步失效
  - `data-file.service.ts`：8 步写管线（顺序不可变）——读盘记哈希 → AST 求值 → 深拷贝变更（支持 async mutate）→ zod 整体校验（schema 由调用方传入，未传跳过）→ 序列化+语法校验 → 陈旧检测（整体重试 1 次，仍冲突 409）→ `BackupService.preWrite` 备份 → `.tmp-<nanoid>` + rename 原子写 → 缓存失效返回新值；所有路径过 safeJoin
  - `data-files.module.ts`：providers（FileLock/ValueCache/DataFileService）+ exports DataFileService（P4 注入）
- 初始化表达式替换采用 `initializer.replaceWithText()`（规格备选方案）：实测 `setInitializer` 对多行文本追加 10 空格缩进（合法但难看）；replaceWithText 精确替换节点区域，golden 字节断言前缀/后缀逐字节一致
- fixture：`test/fixtures/mizuki/` 假 Mizuki 项目定型（package.json 含 astro、astro.config.mjs、src/content/posts、src/types.ts 集中类型定义）；6 个数据文件覆盖块/行注释、单引号、尾随逗号、as const、satisfies、嵌套对象、字符串含引号换行、无插值模板、前缀负号、grouped 中文字符串键
- 修复：InfraBackupModule 补导出 `BACKUP_OPTIONS`（P3 新消费者 DataFileService 注入需要）
- 测试新增 2 文件 30 用例：golden 7（六文件往返 + 外部字节不变 + tsc --noEmit 可选集成）+ engine 23（5 类不支持节点含行号、支持语法不误伤、语法校验、陈旧 409×2、文件锁串行/并行、value-cache 命中/失效/写失效、pre_write 快照、原子写无残留、新文件首写、zod 失败不落盘、路径逃逸 403、getter 抛错）。全仓 101/101 绿

## P2 — 备份与恢复：唯一备份实现与 REST API

- `infra/backup/backup.service.ts`：全项目唯一备份实现转正——`preWriteBackup`（单文件前置快照，每文件保留最近 10 份自动清理）、`manualBackup`（full/data/content 集合备份，full = data ∪ content 见 ADR-003）、`dbBackup`（better-sqlite3 `.backup()` API）；manifest.json 记录每个文件原路径 + sha256 及元信息；`restore` 恢复前先做当前状态快照（可回滚）→ manifest 完整性逐文件 sha256 校验 → 文件原子回写（临时文件 + rename）/ db 用 `.backup()` 逆向写回；所有 Mizuki 根路径解析经 safeJoin（越界 403）；备份成功出口恰好一次发射 `backup.completed`
- `infra/backup/backup.module.ts`（新建）：`@Global() InfraBackupModule`，提供 `BACKUP_OPTIONS` 注入（mizukiRoot/backupDir/dbPath）并导出 BackupService 供后续阶段直接调用
- `modules/backup/backup.controller.ts` + `backup.module.ts`：REST 四路由转正——`POST /admin/backups`（scope ∈ full/data/content/db，文件类 scope → 记录层 manual；mizukiRoot 未配置 400）、`GET /admin/backups`（列表）、`POST /admin/backups/:id/restore`（必须 `confirm: true`，否则 400）、`DELETE /admin/backups/:id`（目录 + 记录同删）；body 一律过 ZodValidationPipe
- `app.module.ts`：imports 头部追加 InfraBackupModule（早于业务模块）
- db 恢复的记录重登记：db 文件整体回滚会丢失备份时刻之后写入的记录行（恢复前快照记录、被恢复备份自身记录），恢复完成后自动补录（磁盘产物未动）
- 测试新增 2 文件 27 用例：单测 14（备份→篡改→恢复→哈希一致 ×2、保留策略 11→10、manifest 完整性 ×2、db 备份恢复 + 快照可查、事件、路径逃逸 ×2、mizukiRoot 未配置、0 文件空备份、删除）+ e2e 13（四 scope 创建、列表、restore 400/200/404、DELETE、事件订阅者、未配置 400）。全仓 71/71 绿
- 新增 ADR-003（full scope 备份集合 = src/data/*.ts + src/content/**）

## P1 — 安全基建：路径监狱、zod 管道与全局防护

- `common/security/safe-join.ts`：路径监狱转正——`safeJoin`（resolve + 前缀校验，越界抛 `ForbiddenPathError`；空字节入口直接拒绝，URL 编码与 Windows 风格反斜杠做防御性复查）；`safeRealJoin` 在其上对已存在祖先链做 realpath 校验，防止 root 内符号链接把路径引到 root 之外（内部互指 symlink 放行）。全项目唯一合法路径入口（MASTER-PLAN §9 守则 4）
- `common/pipes/zod-validation.pipe.ts`：`ZodValidationPipe(schema)` 转正——`safeParse` 失败抛 `BadRequestException`，经统一过滤器输出 `{ code, message, detail }`，detail 携带 zod issues（字段路径 + 错误信息）；用法为路由级 `@UsePipes` 显式声明
- `app.setup.ts`：追加 helmet 默认安全头、CORS 白名单（默认仅 `http://localhost:20154`，端口沿用 `MIZUKI_SERVER_PORT` 环境变量逻辑；AppConfig 若声明 `corsOrigins` 字段将自动并入——当前 schema 无该字段，见 SESSIONS P1 偏差说明）、全局 zod 管道挂载点注释
- `app.module.ts`：`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])` + `APP_GUARD` 全局 `ThrottlerGuard`（60 次/分钟/IP；登录 5 次/分独立限流留待 P6）
- 测试新增 2 文件 27 用例：safe-join 攻击 9 条（`../`、绝对路径、多层穿越、`..\`、`%2e%2e%2f`、`..%5C`、混合编码、空字节×2）+ 正常 4 条 + realpath 防护 6 条；e2e 8 条（zod pipe 合法/非法、helmet 头、CORS 白名单/非白名单/预检、61 次限流 429）。全仓 44/44 绿
- 无新增依赖（helmet 8.3.0、@nestjs/throttler 6.5.0、zod 4.4.3 均在 P0a 清单内）

## P0b — 配置加载、数据库 11 表与统一异常

- `config/app-config.ts`：`data/config.json` zod 校验加载（非法即启动失败、错误含字段路径；缺省返回默认值），进程内单例 + pino 日志
- `infra/db/schema.ts`：Drizzle 定义全部 11 张表（逐字对齐 MASTER-PLAN §3）；`drizzle/0000_*.sql` 首个迁移由 drizzle-kit 生成
- `infra/db/migrate.ts` + `db.module.ts`：`runMigrations()` 幂等迁移（migrator 记账表处理见 ADR-002）；`@Global` DbModule 提供 better-sqlite3 / drizzle 双实例，启动自动迁移
- `common/filters/all-exceptions.filter.ts`：全局统一异常格式 `{ code, message, detail }`，未知异常对外固定「内部服务器错误」，堆栈仅入日志
- `packages/shared/src/events.ts`：事件目录骨架——6 个事件常量 + 各 payload zod schema（MASTER-PLAN §4.4 逐字）
- `common/logger.ts`：pino 共享日志实例（`MIZUKI_LOG_LEVEL` 控制级别）
- 根 `eslint.config.mjs`：eslint-plugin-boundaries 四层依赖规则（L0/L1/L2/L3），L2 互导禁止、L3 互通允许，error 级；配 `eslint-import-resolver-typescript` 解析 TS import
- 接线：`app.setup.ts` 挂全局过滤器；`app.module.ts` 注册 `EventEmitterModule.forRoot()` 与 DbModule
- 新增依赖：`@nestjs/event-emitter` 3.1.0、`pino` 10.3.1、`@types/better-sqlite3` 9.6.0、`eslint-plugin-boundaries` 7.2.0、`eslint-import-resolver-typescript` 4.4.5、shared 声明 `zod`（见 ADR-001 追加记录、ADR-002）
- 测试：5 个文件 17 用例全绿（迁移建表/幂等、config 三态、过滤器双单测、事件目录、health 回归 + 启动迁移断言）；分层拦截人工验证两轮（违规 import → lint error → 移除 → 恢复绿）

## P0a — 仓库骨架与可启动 NestJS 服务

- 初始化 pnpm monorepo（apps/server、apps/web、packages/shared）
- 建立 NestJS 服务端骨架，默认端口 `20154`，全局 API 前缀 `/api/v1`
- 实现 health 健康检查端点（`GET /api/v1/system/health`）
- 建立 stub 文件体系，按阶段 P0a–P11 标注（见各文件头注释）
- 文档占位：MASTER-PLAN / STRUCTURE / ADR / prompts 归档目录
