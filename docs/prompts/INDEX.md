# Mizuki-Server 阶段提示词索引（INDEX）

> 本文件是 `docs/prompts/` 的阶段顺序表。执行方式：逐阶段注入对应提示词（单阶段用「提示词 B」开场，连续执行用「提示词 C」）。
> 事实来源：表结构 / API 路径 / 阶段划分以 `docs/MASTER-PLAN.md` 为准；数据字段 / 功能行为以 `docs/REQUIREMENTS.md` 为准。
> P0a 勘误（继承自交付报告）：`@types/tree-kill` 已移除（tree-kill 自带类型），全部提示词不得引用。

## 阶段顺序表

| 阶段 | 文件名 | 前置依赖 | 一句话范围 | 验收摘要 |
|---|---|---|---|---|
| P0a | `P0a-scaffold.md` | — | 仓库骨架：monorepo、Nest 启动、health、stub 体系 | `pnpm dev` 起服务，`/system/health` 200；`pnpm test` 冒烟（health 200）（已完成） |
| P0b | `P0b-config-db-exception.md` | P0a | config.json zod 校验、Drizzle 11 表 + 启动迁移、统一异常过滤器；铺事件总线依赖、boundaries 分层、events.ts 骨架、pino 日志 | `pnpm test && pnpm build && pnpm lint`；sqlite_master 断言 11 表；config 非法报错；过滤器双单测；跨模块 import 被 lint 拒绝 |
| P1 | `P1-security-foundation.md` | P0b | safeJoin 路径监狱（含符号链接逃逸防护）、zod 校验管道、helmet / CORS 白名单（默认仅 localhost）/ 全局 throttler 60 次/分 | 路径穿越 / 非法输入测试全绿；safe-join ≥8 攻击用例（`../`、绝对路径、`..\`、URL 编码、空字节、symlink 逃逸）；429 限流断言 |
| P2 | `P2-backup.md` | P1 | BackupService：`data/backups/<时间戳-nanoid>/` + manifest（原路径 + sha256）、pre_write 保留 10 份、db `.backup()`、restore 需 `confirm: true` 且恢复前先备份；REST 四路由；发射 `backup.completed` | 备份→篡改→恢复→哈希一致；保留策略清理；manifest 完整性；事件发射断言 |
| P3 | `P3-data-files-engine.md` | P2 | ts-morph 引擎 7 文件：一次性 Project、astToValue 节点分派、valueToTsLiteral、8 步写管线（顺序不可变）、file-lock、mtime+size 读缓存；假项目 6 数据文件 | golden 三断言：往返值正确；**写后初始化表达式以外字节逐字节一致**；不支持节点报错含行号；陈旧冲突 409；禁文本 hack |
| P4 | `P4-collections.md` | P3 | 注册表驱动集合引擎：六类配置（devices grouped、idField=name、空分组清理）、六个 zod schema 放 shared（供 P10 表单）、`/admin/collections/:type` 白名单校验；每次写入发射 `content.changed` | supertest e2e 六类 CRUD + grouped + 未知 type 拒绝；写后 `tsc --noEmit` 通过；事件断言；**禁止为六类建表** |
| P5 | `P5-posts.md` | P4 | Markdown 文章：gray-matter 往返保真、pre_write 备份 + 原子写、封面转 JPG、`sync` 重建索引（sha256、幂等）；about 页（§6.11 补白）；发射 `post.changed` / `article.published` / `content.changed` | 创建/修改/删除/恢复 e2e；frontmatter 往返断言；sync 幂等；事件发射断言；禁止实现富文本 |
| P6 | `P6-auth-init.md` | P5 | argon2id + jose HS256 双 Token、全局守卫 + @Public 豁免、登录 5 次/分 + 失败锁定、操作日志脱敏、Mizuki 四项检测、init 一次性 | 每个模块至少一条 admin 路由无 Token 401；错误密码计数与锁定；init 二次 409；detector 正反用例；secret 不落日志 |
| P7 | `P7-media-albums.md` | P6 | 上传五件套（白名单 + 魔数 + 10MB + 随机名 + sharp 重编码去 EXIF）、media_file 索引、相册目录 + info.json 转 JPG；`MediaReferenceContributor` 注册表（posts/collections/albums 注册，articles 在 P8）；发射 `media.changed` / `content.changed`(album) | 伪造扩展名被拒；被引用图片删除 409 + 引用明细；相册 CRUD 往返；四模块注册断言 |
| P8 | `P8-articles-public-api.md` | P7 | 富文本（TipTap JSON 信任源 + sanitize html_cache）、订阅 `post.changed` 增量更新索引、混合分页公开 API（pub_date 降序）、公开缓存订阅 `article.published`、settings key-value、articles 注册媒体引用；**公开路径定型** | 两源交错分页正确；`<script>` 注入被清除；未发布不出现在公开 API；两条订阅断言；公开输出无未过滤 HTML |
| P9 | `P9-process.md` | P8 | 任务白名单硬编码（install/dev/build/preview）、lockfile 探测包管理器、cross-spawn `shell:false`、env 仅 PATH/HOME/APPDATA、tree-kill 停组、环形缓冲 2000 行 + SSE、端口检测；发射 `process.finished` | fixture 项目启停 `npm run dev` + SSE 收日志（标 slow）；`install;rm -rf /` 被白名单拒绝；事件发射断言；禁 `shell:true` 与命令拼接 |
| P10a | `P10a-web-shell.md` | P9 | Vite + Vue 3 + Element Plus 工程、登录页、初始化向导、主布局侧边栏、路由守卫、请求封装（401 自动 refresh） | 手动场景清单走通；构建与类型检查通过；401 自动 refresh 无感 |
| P10b | `P10b-web-collections.md` | P10a | 六类集合管理页——由 `@mizuki/shared` zod schema 驱动生成表单（渲染策略记 ADR） | 手动场景清单：六类 CRUD、浏览器端 schema 校验、grouped 空分组清理、409 明细展示 |
| P10c | `P10c-web-editor.md` | P10b | 文章列表（草稿箱/回收站）、Markdown 编辑（CodeMirror 6 + frontmatter 表单）、富文本（TipTap）、about 编辑 | 手动场景清单：frontmatter 往返（自定义键保留）、doc_json 往返、禁 `v-html` 渲染后端 HTML |
| P10d | `P10d-web-console.md` | P10c | 媒体库、相册、备份恢复 UI、构建预览控制台（SSE 日志终端）、仪表盘、设置页、六类图片上传打通；可选 `GET /admin/events` SSE（记 ADR） | 手动场景清单；端到端：登录→建日记（传图）→传图到媒体库→建文章→备份→构建→预览看日志 |
| P11 | `P11-finalize.md` | P10d | Swagger 按公开/管理/系统分组、根 README、`bin/mizuki-server`、对照 MASTER-PLAN §7 安全复查报告、全量回归 | 全新 clone 后 `pnpm install` 到面板可用全程无人工改码；安全复查 9 条 + §15 16 条逐项落位 |

## 人工关卡

P0b（数据库定型）、P3（数据文件引擎）、P6（安全边界）、P8（公开 API 定型，此后路径不再变更）完成后必须暂停，等待人工确认（见提示词 C 硬停止条件 3）。

## 事件交互矩阵速查（发射 → 订阅）

| 事件 | 发射方阶段 | 订阅方阶段（验收项） |
|---|---|---|
| `content.changed` | P4（collections）、P5（post/about）、P7（album）、P8（settings） | value-cache 失效由 P3 写管线第 8 步直接处理；仪表盘统计 → P10d（可选 SSE） |
| `post.changed` | P5 | P8 articles 索引增量 upsert/移除（P8 §6.4） |
| `article.published` | P5（markdown）、P8（richtext） | P8 公开列表缓存失效（P8 §6.5） |
| `media.changed` | P7（media、albums） | 媒体索引由 P7 写入路径直接落库；统计 → P10d |
| `backup.completed` | P2（infra/backup） | 仪表盘备份状态 → P10d |
| `process.finished` | P9 | 仪表盘 → P10d |

注册表：`MediaReferenceContributor` —— 注册方 posts/collections/albums（P7）+ articles（P8），消费方 media（P7，删除前聚合检查，有引用 → 409 + 明细）。

## 覆盖说明

- 全部 45 个 P0a stub 恰好在一份提示词的 §2 转正（P0b×5 含 drizzle.config.ts、P1×2、P2×3、P3×7、P4×3、P5×3、P6×7、P7×6、P8×6、P9×3）；
- 本目录另有 `提示词A.md`（本索引的生成器）、`提示词B.md`（单阶段执行开场）、`提示词C.md`（连续自主执行）与 `README.md`（存档说明），均非阶段提示词。
