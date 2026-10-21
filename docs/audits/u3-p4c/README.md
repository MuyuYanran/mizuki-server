# U3-P4c 交付与验收报告 — Markdown 通用导入 + 特效三档纳管

> [批次] U3-P4c（`docs/prompts-ui/U3-P4c-md-import-effects.md`）
> [PM 裁定] 2026-10-21：A-GAP-13 **仅 ★ Markdown 系**（★★★ CMS 明示不做）；A-GAP-04 **仅非敏感开关**（`meting_api` 排除）
> [提交] `7ab8b9d`　[前置] HEAD `b356fb1`
> [架构师验收] 2026-10-22 —— 通过（含一次中途失败的重派与复核，见 §6）

## 1. 交付面

### 1.1 导入器（A-GAP-13 ★）

| 项 | 实现 |
|---|---|
| 解析层 | **服务端**，复用 `common/markdown/frontmatter.ts`（gray-matter 包装）——**零新依赖**；前端不做 YAML 切分 |
| 端点 | **仅新增只读 `POST /admin/posts/import/preview`**（multipart 字段 `files`；≤30 文件、单文件 ≤65536 B、仅 `.md/.markdown`；零落盘零缓存） |
| 提交 | **逐条复用既有 `POST /admin/posts`**（`createPost`），**未新增批量写端点** —— 保住「写盘单源」与 409 语义 |
| 映射最小面 | `pubDate`/`date` → 产出 `published` 后**删原键**；`cover` → `image` 并删 `cover`；`title` 缺取文件名 stem；`published` 三源全缺取导入当日（裸日期口径，与 `BARE_DATE_KEYS` 一致）；`description` 缺**不派生**（主题 `optional().default("")`） |
| 冲突四格 | `slug-taken`（目录式/`<slug>.md`）/ `slug-taken-richtext`（富文本占用）/ `duplicate-in-batch` / `ok` |
| 部分失败 | **逐条结果、不整体回滚**（createPost 即最小事务单元；回滚会污染 pre_write 额、软删索引、误发 deleted 事件） |
| 条目级校验 | 走 `safeParseIssues`（**一个坏文件不得毁整批**）；坏 YAML 也已捕获（不 500） |
| 面板 | `PostListPage.vue` 三步弹窗：选文件（共享常量前端先自检，三条中文错误文案）→ 预览表（status/code/映射徽标/issues/slug 可编辑/映射后 frontmatter + 正文前 200 字）→ 顺序逐条提交（不并发，避 60/min 与 SQLite 写锁）+ 进度 + 汇总 + 刷新 |

### 1.2 特效档（A-GAP-04，非敏感部分）

| 项 | 实现 |
|---|---|
| 落点 | **`config.ts` 三个顶层声明** `musicPlayerConfig`(:402) / `sakuraConfig`(:556) / `pioConfig`(:584) 的**逐属性置换**；`widgetConfigs` 成员（`:623/625/627`）是标识符引用，**零触碰** |
| 域与路由 | `SITE_EFFECTS_KEYS` + carrier `siteEffects` + `PUT /admin/config/effects` + `getConfig().effects/baselineEffects` |
| 敏感键 | **`meting_api` 机械排除**：不在任何 schema 内 → `.strict()` 对含它的请求恒 400（不靠人审） |
| 嵌套值 | `sakura.size/opacity/speed`、`pio.dialog` 视为**一个值**整体置换，不递归（避免 `originals` 还原粒度与提交形状脱节） |
| 清除语义 | 域键缺省 = 该域受管键**还原留档原文**（`PUT {}` = 三域全还原）；域键存在 = 仅置换提交的键，其余零触碰 |
| 三声明事务性 | 同一读-改-写内完成；任一域 404 → 尚未 `persistConfigTs`，整批零物化 |
| 面板 | 站点配置页「特效」折叠区（默认收起）；一次 `PUT` 提交三域（服务端整档重写 `siteEffects` override，只交一域会丢其它两域记录）；本地先 `SiteEffectsSchema.safeParse`；`meting_api` 不出现在表单 |

## 2. 与台账口径的三处订正（实读主题源码得到，已回写 §8.1）

1. **主题无 `AnimeConfig/BangumiConfig/BilibiliConfig` 命名类型**：三键是 `SiteConfig` 的**匿名内联成员**、**全字段可选**；`anime.mode` 枚举 = `bangumi|local|bilibili`；审计表**漏列 `bangumi.fetchOnDev`**（已纳入）。
2. **特效键名口径**：`musicPlayer/pio/sakura` 是 `widgetConfigs` **成员名**，实体是三个**顶层声明**（名称见 §1.2）—— 申报「特效在 `siteConfig` 内」是错的。
3. **主题文章 schema**：`description` 非必填（`optional().default("")`）、`image` 同为可选；且**无 `date`、无 `pubDate`**（grep 计数 0）⇒ 导入器把它们当**非契约别名**处理。

## 3. 测试落点与实测

- 新建 `p5g-posts-import.e2e-spec.ts`（**9 例**）：无 frontmatter 派生+1 warn / 三漂移名齐上（键集恰为 `image,published,tags,title`）/ `published` 优先 / 非法 frontmatter 与坏 YAML 不断批 / 空文件·`.txt`·非法日期三码 / slug 冲突 + **只读性自证**（预览前后文件清单与 config.ts 字节零变化）/ 批内重复 / 提交链 201 + **裸日期正则** + 索引 upsert / 31 文件 **400**（multer `LIMIT_UNEXPECTED_FILE`）+ 单文件超限 **413**
- 新建 `p7m-site-effects.e2e-spec.ts`（**11 例**）：无 override 取基线（响应体不含 `meting_api`）/ 部分键物化且其余声明与注释逐字节不变 / 含 `meting_api` → 400 且零物化 / `originals` 首次留档 / 二次 PUT 不改 originals / 嵌套值整值置换 + 未提交键保留 / 三道值域越界 400 / 基线缺声明 → 404 且 GET 该域 null / `widgetConfigs` 逐字不变 / `PUT site-info` 与 `PUT anime` 回归零影响 / `PUT {}` 还原 + 侧车清除
- **架构师独立复跑**：`p5g` + `p7m` = **20/20**；`tsc` 零输出；全量 **596/596（68 文件）**；`build` 0；`lint` 0:0

## 4. 不变量核对

| 不变量 | 结果 |
|---|---|
| I1 零新依赖 | ✅（gray-matter 为既有依赖） |
| I2 写盘单源 | ✅ 导入提交全部经 `createPost`；preview 零落盘 |
| I3 `/public/**` 零 diff | ✅ |
| I4 管理 API additive | ✅ 仅新增 `import/preview` 与 `PUT effects`；`site-info`/`anime` 两域契约零变化 |
| I5 富文本零参与 | ✅ `modules/articles` 零改动 |
| I6 不 push / 不删文件 / 不碰 `.git` | ✅ |
| I7 数账 | ✅ 净增 **+20**（p5g 9 + p7m 11） |

## 5. 执行方申报的偏差（架构师裁定）

| # | 偏差 | 裁定 |
|---|---|---|
| 1 | 错误 #4 真凶是 `readEffectsBaseline`（不是 `mergeEffectsDomain`）；改用**泛型 schema 收窄**，零 `as` | **采信**：以实读为准优于照抄架构师描述；复验 grep 无生产代码强转 |
| 2 | K12 表写 `pio.width 0..4000` 与 §4 例 7「`width:0`→400」矛盾 | **采信**：保留 `min(1)`（更严的一方），以例 7 为准 |
| 3 | `grep meting_api` 有 13 处命中，**全是注释**；机械证据改为「schema 无键 + 400 实录 + 响应体 grep」 | **采信**：机械保证比 grep 断言强 |
| 4 | 导入 `conflict` 条目**不能就地改 slug**（服务端从文件名派生，重预览必打回） | **采信**：slug 编辑仅对 `ok` 生效；冲突解除 = 改文件名重导 / 处理同名文章；权威判定仍是 `createPost` 409 |
| 5 | 前端不拦 0 字节文件（交服务端 `empty-file` 逐条报） | **采信**：条目级可预期错误，不属上限拦截 |
| 6 | 语义 400 落在 `detail.code`（顶层 `code` 由全局过滤器固定为异常类名） | **采信**：改全局过滤器属全局面，不为本批动 |

## 6. 过程记录：一次中途失败（不隐去）

P4c 首个执行代理在约 60% 进度时**中途终止且无收尾消息**，留下 `tsc` 6 条错误的半成品（漏导入 `safeParseIssues`、`spliceSiteEffects` 未实现、`readEffectsBaseline` 返回类型过宽）。
架构师处置：**不回滚重写**，先定位缺口，再派两个**文件不重叠**的代理并行收口（后端补实现+spec；前端做弹窗/分区 + taskEnv `keep` 语义）。
复核结论：半成品的 shared schema（`posts-import.ts` / `SiteEffectsSchema`）质量可用，现存量约 60% 被保留。

## 7. 已知缺口

1. **`effects` 无探针轴保护**（K16 明示不扩）：主题结构升级只能靠 splice 的形态检查兜住。
2. 导入不处理图片等附件（只搬 Markdown 文本与 frontmatter）；★★ / ★★★ 方言与 CMS 系按 PM 裁定**明示不做**。
3. `meting_api` 维持手改 `src/config.ts`（含凭据，不纳入面板）。

## §commit

`feat(U3-P4c): Markdown 通用导入（只读 preview + 逐条复用 createPost）与特效三档纳管（meting_api 机械排除）` → `7ab8b9d`
