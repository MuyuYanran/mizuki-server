# 二期需求附录（PHASE-2）

本文档为一期 MVP（P0a–P11）之上的增量规格。字段与数值锚点按一期惯例逐字核对。
二期待办中以下各项在此正式立项；编号沿用用户反馈原始顺序。

## R2-1 视觉主题：二次元可爱风格 + 夜间模式（必须）
- 引入明暗双主题。暗色使用 Element Plus 官方 dark 模式（html.dark 切换，
  CSS 变量全套生效）；亮色为基础主题；
- 定制调色板向 Mizuki 博客主题风格靠拢：柔和渐变、大圆角卡片、柔化投影、
  主色系明亮可爱（具体色值实施时确定，记报告）；
- 主色统一走 --el-color-primary 系列变量，禁止散落硬编码颜色
  （lint 或代码审查抽查）；
- 顶栏右侧提供明暗切换按钮，选择持久化 localStorage（键 mizuki.theme）；
- 验收：dark 类切换后页面全部可见区域无文字不可读项；刷新保持选择。
- 主题系统覆盖全部页面含控制台页（ConsolePage 与 LogTerminal）：终端背景/前景色、滚动条、SSE 日志各等级行着色均走 CSS 变量，暗色模式下终端观感单独校验。

## R2-2 向导目录点选器（必须）
- 后端新增需认证端点 GET /admin/system/browse-dirs?path=<绝对路径>：
  - 无 path 参数：返回根列表（Windows 枚举存在的盘符；POSIX 返回 /）；
  - 有 path：返回该目录下子目录数组 [{name, isMizuki}] + parent 路径；
    仅目录不返回文件；跳过隐藏目录与符号链接目录（防循环防越界）；
    单次上限 200 条，超出截断并附 truncated 标志；
  - isMizuki 复用 MizukiDetectorService 的轻量判据（存在 package.json 或
    astro.config.mjs 即候选 ✓，完整检测仍走既有 detect 端点）；
  - 全程 safeJoin 校验；404 当目录不存在；限流随全局；
- 向导「选择目录」步骤替换文本输入为主入口：树形逐级点选钻取，
  选中后回填只读展示完整路径，保留手动微调输入框（高级模式折叠）；
- 浏览器无法获取本地绝对路径属安全设计，此端点即官方替代方案；
- 验收：e2e 断言根列表非空、子目录枚举正确、../注入拒绝、无 Token 401。

## R2-3 向导步骤条文字换行修复（必须）
步骤条内所有步骤标签 white-space: nowrap，必要时缩小字号保证不折行。

## R2-4 运行模式选项对齐修复（必须）
三选项垂直排列、同一左缩进基准，禁用混合 tab 缩进导致的参差感。

## R2-5 运行模式驱动菜单过滤（必须）
- 登录后拉取系统状态读取 mode 字段（若现状缺失则本附录授权在 status 响应
  补充 mode 只读字段，记补白）；
- mode 为 minimal（仅管理）时：隐藏富文本文章与六类集合相关菜单入口；
  直接访问对应路由重定向到仪表盘；
- mode 未知时 fail-open 显示全部（避免误伤）。

## R2-6 图片裁切上传（必须）
- 新增依赖 vue-cropper；封装通用 CropperUploader 组件（预设比例可传参，
  友链头像用圆形 1:1）；
- 友链 headimg/avatar 字段接入该组件：选择→裁切→输出→走既有上传链路；
- 组件预留媒体库、日记图片复用接口。

## R2-7 上传管线保留原格式（WebP 等）（必须）
- 变更 P7 管线语义：JPEG/PNG/WebP/GIF 上传产物保留原格式（仅剥离元数据），
  其余格式转 JPG 兜底；相册与文章封面统一适用；
- info.json 中记录的文件名以实际产物后缀为准；
- 记 ADR-010（一期转 JPG 的原决策及废止理由）；
- 验收：上传 webp 后断言产物 format==='webp' 且 metadata 无 exif；
  兼容回归：原有 jpg/png 上传产物格式不变。

## R2-8 相册图片预览灯箱（必须）
- 新增依赖 v-viewer（viewerjs 封装）；AlbumDetailPage 图片网格点击打开
  灯箱：大图、缩放、旋转、左右切换；
- 外部相册的 URL 项同样可预览（直接开图片 URL）；
- 本地图片 src 统一经 `/site-assets` 站点资产通道（媒体库缩略图/灯箱/
  相册网格同源同规）——**Phase2-B1.5 人工裁决补白**，安全边界与 token
  送达见 **docs/decisions/ADR-012-site-assets.md**（B1 的 vite publicDir
  dev-only 临时方案同步回收）。

## R2-9 日期字段日期选择器（必须）
- SchemaForm mapper 对日期类字段挂 el-date-picker（YYYY-MM-DD），
  默认值取当前系统时间；
- 时间线等集合的日期字段全部生效；保存往返保真（存库/文件格式不变）。

## R2-10 控制台增强：历史持久化 + 任务模板配置（必须）
本条为纯增量改造：既有 SSE 实时日志、启停交互、环形缓冲、端口检测功能一行不动，只新增历史持久化与模板配置。

- 边界铁律：REST 白名单四任务不变、shell:false 等安全条款不动摇；
  控制台永远只是「编辑 + 构建」，不是万能终端；
- 新增 task_run 表迁移：id(PK)、task、command_snapshot、started_at、
  finished_at、exit_code、log_text（尾部截断保留 ≤256KB）；
- 进程启动写入行，退出事件更新 finished_at/exit_code/log_text；
- 新增 REST（全部需认证）：GET /admin/process/runs 分页列表
  （created_at 倒序）、GET /admin/process/runs/:id（含 log_text）、
  DELETE /admin/process/runs/:id；
- 控制台页新增「历史记录」区：分页列表、点开查看完整日志、单条删除；
  实时日志走既有 SSE 不变；
- 任务命令模板进 data/config.json（如 tasks.{dev,build,...}.{cmd,args,
  shell}），按平台可配 pwsh/cmd/bash；仅改配置文件生效，重启读取；
  config schema 相应扩展并过 zod 校验；
- 验收：跑一次 build → runs 列表出现且 log_text 非空；删除后 404；
  篡改模板 shell:'powershell 任意' → 启动校验拒绝非法键。

## R2-11 Markdown 编辑器升级 Vditor + 引擎切换（必须）
- 新增依赖 vditor；
- 新建 VditorEditor.vue：支持 wysiwyg / ir / sv 三模式切换，暗色跟随
  html.dark，缓存关闭（disableCache），高度自适应；
- PostEditPage 与 AboutEditPage 提供「引擎切换」下拉：vditor（默认）/
  codemirror（源码模式），选择持久化 localStorage（mizuki.editor.engine）；
- TipTap 富文本编辑器不动；
- 保存链路不变：提交仍是 frontmatter+正文串，正文从当前引擎 getValue()；
- 验收：vditor 写作→保存→重读逐字节一致；切 codemirror 后内容无缝衔接；
  暗色模式下编辑器配色正常。

## R2-12 图片字段填写引导（必须）
- shared 各 schema 的图片类字段附 description 元数据：「本地图片填媒体库
  回传的相对路径（public/images/uploads/…），外链直接粘贴 URL」；
- SchemaForm 渲染 description 为字段下方帮助文案。

## R2-13 必填项悬停解释（必须）
SchemaForm 对必填字段渲染问号图标 el-tooltip，悬停显示解释、移开消失；
解释文案来自 schema description（未配则显示通用必填提示）。

## R2-14 相册功能对齐原版（必须）【B2 已完成 · 需求重定义】
> 重定义依据：B4 审计（SPEC-ALIGNMENT-B4）证实旧形状 source:"external"+urls[] 与官方不符；
> B2 终版提示词规格基线 1 定案，以官方 `mode:"external"` 形状为准，旧形状作废。
- info.json 外链模式（终版形状）：`{ mode:"external", cover:<url>, photos:[{src(必填),
  thumbnail, alt, width, height, camera, lens, settings}] }`，photos 除 src 外全可选；
  本地模式保持现状（mode:"local" 或缺省）；
- 模式切换精确规则：切 external 要求该相册本地照片目录与记录为空，否则 409
  （错误信息含现存本地照片数）；切 local 要求 photos 数组为空，否则 409；
- 外链照片 CRUD 与外链相册管理（增删/改 info.json）路由齐备；
- 列表端点输出统一 items 数组：[{type:'file',name}|{type:'url',url}]，
  本地与外部合并有序；
- SSRF 红线：服务端绝不代理抓取外部 URL，仅存储与透传；
- 大相册前端分页（每页 60 张，前端实现即可）；
- 与 R2-7/R2-8 组合成完整对齐：webp ✓ 灯箱 ✓ 外部相册 ✓ 加密标记 ✓ 分页 ✓。

## R2-16 包管理器解析健壮性（必须）
- 现状缺陷（用户实测）：Windows 下 spawn('pnpm') 命中 .cmd 垫片，且垫片可能
  指向已被 pnpm 按 dlxCacheMaxAge 清理掉的缓存路径，表现为
  `is not recognized as an internal or external command`；同时系统存在多个
  pnpm 来源时解析到不稳定版本；
- 规格要求 ProcessManagerService 增加「确定性解析」步骤（在 spawn 前）：
  1) 依 lockfile 类型确定候选命令名（pnpm/npm/yarn）；
  2) 解析真实可执行体：优先读目标项目 node_modules/.bin/ 下对应 CMD 垫片，
     其次 where/which 全局查找；若解析结果以 .cmd/.bat 结尾，则读取垫片
     内容提取其指向的实际 .cjs/.js 入口文件路径，最终命令改写为
     process.execPath（Node 自身）+ 该入口 js + 原参数——全程维持
     shell:false 不变，不引入 cmd 中转；
  3) 无法提取 js 入口时的兜底与失败报错文案（含诊断建议：全局安装该
     包管理器）记入报告；
- 上述策略与解析产物（实际执行的最终命令数组）记
  **docs/decisions/ADR-011-package-manager-deterministic-resolution.md**；每次任务
  启动的 command_snapshot 存的是改写后的最终命令（task_run 表字段沿用）；
- 验收见 B2 修订。
- 注：ADR 编号顺延使用，010 已用于 WebP 决策。
- 【状态（B2 终版批注）】设计基线 ADR-011 已先行落盘，实现未随二期 B 线任一批次落地
  （原旧版 B2 批次范围被 B1.5/B3/B3.6/B4 及终版 B2 重排取代）；本项遗留转三期输入
  （仅记录不展开，见 SESSIONS Phase2-B2 报告「三期输入增量」）。

## R2-17 规格对齐审计（B4，已完成）
- 以官方文档快照（`docs/refs/mizuki-docs/`）为唯一依据，对 Server 数据规格与测试资产做系统性对齐审计（`docs/SPEC-ALIGNMENT-B4.md`，摘录证据 `docs/audits/b4-doc-excerpts.md`，基线原则记 ADR-013）；
- 本批完成项（无风险对齐落地）：friends 必填面对齐官方（desc 必填、tags≥1）、上传白名单补 tiff 双端序魔数嗅探与重编码（bmp/svg/avif 处置转裁决 T4-3）、fixture 官方化（friends 数据、官方外链模式相册样例、文件夹方案相对路径图片文章样例）、ADR-004 timeline education 映射按官方示例修订并勾销遗留义务；
- 八项裁决（相对路径图片预览通道、非 JPG 强转 JPG 去留、上传白名单终集与 svg 处置、运行期 mode 端点、改密端点、生产 Swagger 开关、manage 模式隐藏范围、posts description 必填策略）+ 审计追加裁决项（六类 id 类型）已呈报待人工裁决，未实施。
- 【状态（B2.1 补齐批注）】裁决 8（posts description：server 端创建/修改强制必填，审计条目 e2/T4-8）
  于 B2 判卷确认为静默漏项，已在 B2.1 补齐批次落地：创建入口 `PostFrontmatterWriteSchema`
  必填（trim 后非空）+ PATCH 出现即校验（增量语义，存量防误伤）+ 面板字段级校验 +
  e2e `p5b-description-required`；读取/列表/sync/盘上存量不校验。其余八项裁决 B2 已落地。
- 【状态（三期 C0 批注）】**R2-16 由三期 C3 认领**（包管理器确定性解析，四层解析链方案
  见 REQUIREMENTS-PHASE3 §1 决议 3；C3 批先核对 ADR-011 原文，冲突以 ADR-011 为准）。

## R2-18 评论功能（三期 C0 关闭）
- 原规划：`GET/POST /public/comments/...`（comment 表 P0b 已建，P8 冻结表 ⏳）。
- 【状态：**三期 C0 关闭，见 ADR-016**】人工裁决（2026-08-28）：采用主题自带
  Twikoo/Giscus，Server 零自建；comment 表休眠；`/public/comments` 永久冻结不实现；
  commentConfig 面板化管理归三期 C7。官方评论链路快照见 `docs/audits/phase3/`。


## 二期依赖总账（入 ADR-001）

vue-cropper、v-viewer(viewerjs)、vditor —— 均为前端；后端零新增依赖。

## 与一期的冲突调和规则
- P7 转 JPG 决策由 R2-7 显式废止（ADR-010）；
- PUBLIC API 已冻结路径不得变更（公开端点输出形状的扩展须向后兼容）；
- 全部改动遵守一期九节提示词纪律：验收可机械执行、偏差显式化、补白走正门。
