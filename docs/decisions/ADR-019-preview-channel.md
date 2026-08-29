# ADR-019: /preview 站点预览通道与上传缩略图变体（Phase3-C4）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-29 |
| 阶段 | Phase3-C4（批次内 ADR，REQUIREMENTS-PHASE3 §1.4） |

## 背景

决议 4（REQUIREMENTS-PHASE3 §1.4）：/preview 通道（Astro dist，GET-only + JWT cookie +
ADR-012 同构四边界）+ 上传缩略图变体（同目录 `-thumb.webp`）。**架构澄清（人工，C4 批次
提示词）**：/preview = Server 自有静态通道直接服务 Astro dist，不托管 `astro preview`
进程；dist 生产 = P9 console build 任务（C3 起经确定性解析链）。控制台「站点预览」入口
改走 preview-ticket（白名单 `preview` 任务本体未动，API 语义不变）。

## 决策

**preview 模块**（`modules/preview/`：service = 独立 http 监听 + 守卫链；controller = 票据
签发）。随主服务生命周期同启停（onApplicationBootstrap/Shutdown）；端口占用 → 启动报错含
指引（`MIZUKI_PREVIEW_PORT` 换端口或停占用进程）。

### 参数终值表

| 参数 | 终值 | 说明 |
|---|---|---|
| 绑定 host | `MIZUKI_PREVIEW_HOST`，缺省**镜像主服务 host**（主服务 `app.listen(port)` 未传 host，实为全接口） | e2e 注入 127.0.0.1 |
| 端口 | `MIZUKI_PREVIEW_PORT`，缺省 4173 | 占用 → 启动报错；端口 0 → 临时端口 |
| dist 根 | `MIZUKI_PREVIEW_DIST_PATH` 活读，缺省 `<mizukiRoot>/dist` | P11 坑 5 纪律，请求期活取 |
| cookie 名 | `mizuki_preview_jwt` | 与管理会话 cookie 命名空间隔离；只读本名，外来 cookie 零行为差异 |
| cookie 值 | 调用方 access token（同一 verifier/secret） | 同 JWT 保护级 |
| cookie 参数 | HttpOnly；SameSite=Lax（localhost 跨端口同 site）；Path=/；**无 Port 属性**（RFC 6265 host-wide，跨端口共享正是所需；6265bis Port 属性不用）；无 Secure（localhost http，已知限制） | |
| cookie TTL | Max-Age=900（与 ACCESS_TTL 同步，≤24h） | 过期后重取票据 |
| 缓存头 | `index.html`/html → no-cache；`_astro/**`（hash 资产）→ `public, max-age=31536000, immutable` | |
| 404 口径 | 非白名单扩展名、隐藏文件、穿越、缺失统一 404（存在性隐藏，JSON 错误体） | 同 /site-assets |
| 405 口径 | 非 GET → 405，先于认证（从严；不泄露内容面） | |
| 目录归一 | 目录请求自动补 `index.html`；尾斜杠归一；禁目录列举/隐藏文件（`.` 开头段拒绝） | |

### ADR-012 同构四边界映射

| ADR-012 边界 | /preview 对应 |
|---|---|
| 1 认证先于内容 | 401 先于 dist 存在性判断与引导页；仅认 `mizuki_preview_jwt`；同 ACCESS_TOKEN_VERIFIER |
| 2 禁目录列表 + safeRealJoin 路径监狱 | 逐段 decodeURIComponent 走私拒绝 + safeRealJoin（符号链接逃逸防护）+ isFile 收口 |
| 3 MIME/扩展名白名单 | dist 资产超集：html/htm/css/js/mjs/json/map/txt/xml/webmanifest/ico/svg/png/jpg/jpeg/gif/webp/avif/woff/woff2/ttf/otf/eot |
| 4 公开 API 冻结 | 全新命名空间（独立监听），零既有路由触碰 |

**对照缺口（边界 3）**：ADR-012 白名单为图片类；dist 资产需 html/css/js/字体/json 等超集
——性质差异（静态站点产物 vs 站点图片），非边界弱化，认证与路径边界逐条同构。

### 缩略图变体（相册面管线）

- 管线：`sharp(<原图>).rotate()`（无参 = EXIF auto-orient，竖拍不横躺）→ **短边 ≤480**
  等比缩放（竖/方图限宽、横图限高；`withoutEnlargement` 不放大）→ webp → 同目录
  `<去扩展名>-thumb.webp`（temp+rename 原子化）；原图落盘后**同步**生成（延迟记影响）。
- 格式面：bmp 跳过（ADR-017 双口径延伸：sharp 0.35 无法解码 bmp）；tiff/png/gif/jpg/
  jpeg/webp/avif 生成；**gif 变体 = 首帧静态 webp**（sharp 默认行为）。tiff 变体限相册面，
  媒体库面零触碰。
- fail-open 范围：**仅限变体**——任何 sharp 异常仅记日志，原图照常返回（上传响应形状
  零变化）；probe（metadata）失败仍在上传放行层拒绝，纪律不变。
- 删除耦合：原图删除路径同步删除同名变体（在则删，孤儿幂等容忍）；相册删除递归随目录。
  相册面上传同名冲突即随机后缀改名（无覆盖替换路径），变体随新文件名再生。
- 消费面：变体经既有 `/site-assets` 公开路径直达（webp 已在 ADR-012 白名单，零新路径）；
  `AlbumView.images` 排除 `-thumb.webp` 派生产物（形状不变，内容面偏差：公开/管理列表
  不再含手工放置的同名变体）；面板网格优先变体（缺失 onerror 回退原图），灯箱用原图。
  存量图片不回填（网格回退原图）。

## 理由

- 自有静态通道复用 ADR-012 已验证的守卫链组件（verifier/safeRealJoin/白名单/404 口径），
  不引入 astro preview 进程（多一个子进程生命周期与解析链复杂度，且 dev 形态无 astro 依赖）。
- 票据端点复用调用方 access token：最小新面（不铸造新长时 token），TTL 与会话同步。
- 短边 ≤480：masonry/网格列宽消费语义（竖图限宽不超高）；首帧 webp 为 sharp 原生行为，
  零额外依赖满足「gif 必须有变体」。

## 影响

- localhost http 下 cookie 无 Secure（已知限制，仅本机形态）；preview 暴露面 = 管理端
  暴露面（同 JWT 保护级），URL 不可外发分享。
- 变体同步生成占用上传延迟（数百 ms 量级，480px webp 编码）；缓存头按上表。
- 测试环境 vitest setup 缺省 `MIZUKI_PREVIEW_PORT=0`（并行 worker 不抢 4173）。
  证据链：`test/p9d-preview.e2e-spec.ts`（8 例）+ `test/p7d-thumbnails.e2e-spec.ts`（5 例）。
