# ADR-012: /site-assets 站点资产通道（Mizuki public/ 认证托管）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-27 |
| 阶段 | Phase2-B1.5（第三次规格补白，人工裁决） |

## 背景

R2-8 相册灯箱与媒体库缩略图都需要 `<img>` 标签直接消费 Mizuki 站点 `public/` 下的本地图（`/images/albums/**`、`/images/uploads/**`）。但后端从未托管站点产物（ADR-009 明确面板 dist ≠ 站点 public），B1 曾以 vite dev-only `publicDir` 临时指到 Mizuki `public/` 让 dev 形态可看——生产形态无解，且与「面板不托管站点产物」边界含混。灯箱/缩略图/文档内嵌图均为 `<img>` 同源请求，无法逐个附加 `Authorization` 头。

**人工裁决（2026-08-27，Phase2-B1.5 会话，原文存档于批次提示词）**：main.ts `setupStaticPanel` 旁追加 `setupSiteAssets`——mizukiRoot 已配置且 `<root>/public` 真实存在时，把 `express.static(<root>/public)` 挂载于前缀 `/site-assets`；全部前端图片消费点统一换源 `/site-assets/<相对路径>`（工具函数一处封装），外链 URL 不经通道；安全边界四条不可破（见下）。

## 决策

### 守卫链（`setupSiteAssets`，main.ts）

`app.use('/site-assets', handler)` 恒挂载，handler 内按序：

1. **配置活取值**：`getAppConfig().mizukiRoot` 为空或 `<root>/public` 不存在 → 一次性 pino warn（latch 防刷屏）+ 404「站点资产不可用」。
   *落地偏差说明*：裁决原文写「无则跳过挂载」；实现取「恒挂载 + 请求期活取」，因 init 向导运行期才写入 mizukiRoot（P11 坑 5：启动快照会导致初始化后必须重启），「跳过」语义落为「不落 express.static、走 404 守卫」，对外行为等价。
2. **认证**：`Authorization: Bearer` 头优先，`mizuki_asset_token` cookie 兜底，经 `ACCESS_TOKEN_VERIFIER` 校验，无效 401。**无 query token 形态**（禁明文入 URL/日志）。
3. **路径解析**：`(req.baseUrl ?? '') + req.path` 还原完整路径（Express 5 挂载已剥前缀），按 `/site-assets/` 切出 rawRel 后**逐段** `decodeURIComponent`，任一段为空/`.`/`..`/含 `/`/含 `\`/含 `\0` → 404（拒绝编码走私）。
4. **扩展名白名单**：末段小写后仅放行 `jpg/jpeg/png/webp/gif/svg/avif`，其余 404。
5. **路径监狱**：`safeRealJoin(publicDir, segments.join('/'))`（resolve + 前缀 + realpath 符号链接逃逸防护），`ForbiddenPathError` → 404；`statSync` 复查须为常规文件。
6. **静态服务**：`express.static(publicDir, { index: false, fallthrough: false, dotfiles: 'ignore' })`（实例按 publicDir 缓存复用）——禁目录列表、禁点文件、错误收敛为 404。

### token 送达二选一：cookie 注入（裁决授权候选之一，取「更少改动」）

- 前端 `stores/auth.ts` 的 `syncAssetCookie()` 把 access token 写入 `Path=/site-assets; SameSite=Lax` 的非 HttpOnly cookie（登录/刷新/登出/模块加载四时机同步）。
- 安全论证：token 本已存 localStorage（JS 可达），非 HttpOnly 无新增暴露面；Path 收紧后 API 请求不携带；SameSite=Lax + 仅 GET 只读，CSRF 不适用。
- 选型理由：`<img>`/viewerjs 灯箱/TipTap 文档内嵌图是浏览器自主发起的同源请求，fetch+blob 方案需改造全部消费点且灯箱 URL 串无法覆盖；cookie 一次注入全场景生效。
- Bearer 头通道保留（e2e 与程序化调用便利）；`/site-assets` 不进 Swagger（非 API 面）。

### 安全边界四条（裁决）与证据（`test/p12-site-assets.e2e-spec.ts`，10 用例）

| # | 边界 | 证据 |
|---|---|---|
| 1 | 全部挂认证之后；`/site-assets/*` 需有效 JWT；无 token 401 | 无凭据 401 / 伪造 token 401 / header 与 cookie 双通道 200 且字节相等 |
| 2 | 禁目录列表，仅服务 public 子树，safeJoin 路径监狱 | `..%2f`、`%2e%2e/`、双段穿越三种变体 404 且响应不含目录内容；尾部斜杠 404；`index:false`/`fallthrough:false` |
| 3 | 仅图片扩展名（jpg/jpeg/png/webp/gif/svg/avif），其余 404 | note.txt 404 |
| 4 | 公开 API 冻结路径零变化 | 控制器路由装饰器 before(70e44f1)/after diff 为空；docs-json 52 端点清单与 P11 三分组一致（清单落盘 `.test-tmp/b15-shot/api-freeze/`，SESSIONS 引用） |

### 前端联动

- 新建 `apps/web/src/lib/image-src.ts`：`imageSrc(relOrUrl)` 一处封装——http(s) 外链原样返回；`public/` 前缀剥离；段级 `encodeURIComponent` 后拼 `/site-assets/`。消费点：媒体库表格缩略图与灯箱（`MediaLibraryPage`）、相册网格与灯箱（`AlbumDetailPage`）。P10d 疑问 1（媒体库缩略图暂缺）就此收口。
- 回收 B1 临时方案：`vite.config.ts` 删除 dev-only `publicDir` 指向逻辑，改 dev 代理 `'/site-assets' → localhost:20154`（dev/prod 同一套通道语义）。
- TipTap「插入图片」对话框按用户输入原文插入（外链语义，裁决「外链 URL 不经通道」）；`ImageUploader` 仅上传回填路径无 `<img>` 渲染，均不涉及换源。

### 依赖

- `express` `^5.2.1` 由传递依赖显式化为 `apps/server` 直接依赖（NestJS Express adapter 底层既有，非新引入第三方能力；pnpm 严格布局下 main.ts 直接 import 须显式声明）——记 ADR-001 台账。裁决「零新增依赖」在此意义上成立，偏离点已显式化。
- `@codemirror/theme-one-dark` `^6.1.3`（编辑器暗色，§3.1a 追加规格）记 ADR-001。

## 备选方案

- fetch+blob 送达（未采纳）：每一处 `<img>` 改为 JS 取 blob URL，灯箱库与文档内嵌图无法覆盖，改动面远超 cookie 注入。
- 独立静态服务器/反代托管 public（未采纳）：多一个部署组件，违背 bin 单命令同源形态（同 ADR-009 论证）。
- 保持 B1 vite publicDir 方案（未采纳）：生产形态无效，且面板构建产物与站点产物边界含混。

## 后果

- 生产形态本地图片闭环：`<root>/public` 下的图片经 `/site-assets/**` 认证后可在面板任意 `<img>` 场景渲染；未配置 mizukiRoot（init 前）时通道整体 404，不影响其他路由。
- `/site-assets` 为**认证面**而非公开面：URL 不可外发分享（与 Mizuki 博客前端自身的公开静态托管互不相干）。
- B1 的 vite publicDir 方案移除，dev/prod 图片加载路径统一走通道；vite 代理仅转发请求不做任何路径改写。

> C4 同构应用（2026-08-29）：/preview 预览通道按本 ADR 四边界逐条同构实现（认证/路径监狱/白名单/冻结），dist 资产扩展名为图片白名单的超集，见 ADR-019 对照缺口注记。
