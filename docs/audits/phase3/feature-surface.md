# Phase3 官方功能面清单与批次映射

- 取证：架构师 2026-08-28（11 页 + 侧边栏全目录）；快照见本目录及 C0 三件。
- 用途：供 C1/C2/C7 提示词引用；规划级快照落地前须升级为裁决级。

## A 档：Server 已覆盖

- 六类集合（数字 ID）
- 相册（本地 + 外链双模式）
- about
- posts CRUD（含 description 必填）
- 日记页数据

## B 档：字段补齐（→ C1）

| 字段 | 说明 |
| --- | --- |
| `permalink` | 固定链接，v7.2+ 新字段，**C1 必须纳入**（见 `permalink.md`） |
| `comment` | 文章级评论开关 |
| `encrypted` + `password` | 客户端加密，含**公开 API 双泄漏点修复**：泄漏点 A=详情接口 html 明文正文、泄漏点 B=frontmatter 明文密码；修复方案=encrypted 文章详情返回剥离 password 的 frontmatter + `html:''` |

注：公开 API 冻结优先级最高的安全例外（泄漏点为存量缺陷非新面），已记入 REQUIREMENTS-PHASE3 §1 裁决 2。

## C 档：config.ts 对象管理（→ C7）

**对象矩阵**：

- 纯字面量 9 个先行：`siteConfig`、`banner`、`footerConfig`、`sidebarLayoutConfig`、`commentConfig`、`musicPlayerConfig`、`sakuraConfig`、toc+share+license/article-extras、misc（font/auto-res/umami/pio 等）
- `navBarConfig` 含 `LinkPreset` 标识符引用（P3 引擎 `UnsupportedLiteralError` 雷点）→ **缓行**

**C7 待裁决四项**：

1. 首批对象范围（纯字面量 9 个的取舍与顺序）；
2. 标识符引用处理：保守拒绝 vs 白名单透传；
3. 每对象独立 schema vs 单一大 schema；
4. 保存后「提示构建」与 console build 串联 UX。

## D 档：排除项

- 7 篇部署指南（部署文档，非 Server 功能面）；
- 自动构建（GitHub Repository Dispatch 需 token，超 Server 职责）；
- Bangumi / Meting / PicFlow API（主题侧 Serverless，Server 不承接）;
- 视频嵌入语法（用户写作侧能力）。

## 关键发现 5 条

1. **B4 i2（anime 无规格）被 v4 文档推翻** → C2 追加「anime 第七集合（local 模式）」候选，待人工确认（见 `anime.md`）；
2. **B4 b1/b2/b3 相册字段获官方证实** → C2 证据链就绪；
3. **裁决 2（原格式落盘）消除 bmp 转码死入口前提** → C2 重开 T4-3 小项「bmp 准入与否」，待人工确认；
4. **内容分离**（ENABLE_CONTENT_SYNC / CONTENT_REPO_URL）与 Server 互补无工作；
5. **permalink 为 v7.2+ 新字段** → C1 必须纳入。

## 工程债补充（→ C5）

- golden / p4 慢用例超时统一处置（全量并行时 worker 争抢 CPU 的环境 flakiness）；
- `data.bak` 于 C2 隔离落地后删除。

## 待人工确认三项（均待定，不阻塞本批）

1. C0.1 单独成批；
2. anime 进 C2；
3. C7 起步范围。
