# 「主题重新拉取」决策材料 —— 上游事实、漂移量化、四条路

- 日期：2026-10-28
- 触发：dj 四项裁决之 ④「主题重新拉取」；①「博客是纯静态，无 server」②「重建」③「site 体系另立项」
- 状态：**未执行**（拉取/替换属不可逆操作，需 dj 在下面四条里点一条）
- 上游探针：`git clone --depth 1` 到 `.test-tmp/upstream-Mizuki-20261028`（142M，HEAD `c06f000`）

---

## 0. 🔴 先说最要紧的一条：**你指的那个仓库已经废弃了**

上游 `LyraVoid/Mizuki` 的 README 顶部挂着停止维护通知（原文）：

> ### ⚠️ 项目停止更新与迁移通知
> **本项目（Mizuki）即将停止更新与维护。**
> 全新全面重构版本 **Shirone** 现已发布 …… 🔗 **[https://github.com/lyraVoid/shirone](https://github.com/lyraVoid/shirone)**

它的 **HEAD 提交信息本身就是**：`docs(readme): add project deprecation notice and link to new project Shirone`。

⇒ 「重新拉取 `LyraVoid/Mizuki`」= 拉一个**已冻结**的代码库。

**继任者 `LyraVoid/Shirone` 是活跃项目**（已核实存在）：Astro 7 / Svelte 5 / Tailwind 4 / Stylus，Material 3 Expressive，
MIT 许可，Node ≥22.12 + pnpm 11.x，且**可作为 npm 包安装**（`npx shirones init`，主题更新走 `pnpm add shirones@latest`），
内容可外置到 `Shirone-Content` 仓。

---

## 1. 版本与工具链差距

| 项 | 上游 `LyraVoid/Mizuki` | 本地 `BlogFiles/Mizuki` |
|---|---|---|
| version | 9.0 | 9.0 |
| **astro** | **7.1.3** | **6.1.2** |
| packageManager | pnpm@11.5.3 | pnpm@10.22.0 |
| TypeScript（badge） | 6.0.3 | — |
| 构建状态 | 未实测 | ✅ 2026-10-28 重建成功（29 页 + pagefind） |

⇒ majors 差一个（Astro 6→7）+ pnpm 差一个大版本。拉上游 = 连带工具链与依赖升级，不是纯文件替换。

---

## 2. 漂移量化（`diff -rq`，排除 `node_modules`/`dist*`/`.snapshot-*`/`.astro`/`content`）

| 类别 | 条数 |
|---|---|
| **合计差异** | **493** |
| 仅上游有（本地缺失） | 71 |
| 仅本地有（上游没有） | 129 |
| 两边都有但内容不同 | 364（其中 `src/` 下 **307**） |

### 2.1 结论：本地不是「打了补丁的上游」，是**重度分叉**

**仅本地有（129）里两类混在一起**：

**(a) mizuki-java-server 注入层**（已确认死掉的那层）
`src/server/`、`src/components/server/`、`src/components/controls/`、`src/adapters/`、`src/config.ts`、
`src/pages/articles/`、`src/pages/admin/`、`src/pages/login.astro`、`src/pages/register.astro`、`src/pages/profile.astro`、
`src/pages/wordpress/`、`src/types/crypto-js.d.ts`、`public/assets/js/crypto-js.min.js`、
`.github/workflows/{CI,build}.yml`

**(b) dj 自有的东西 —— 拉上游会丢，必须先保出来**
`.env`、`data/`、`images/`、`README.zh.md`、`.prettierrc`、`.prettierignore`、`eslint.config.js`、`tailwind.config.cjs`、
`performance-baseline.json`、`scripts/{compress-fonts.js,performance-*}.js`、`public/assets/font`、
`src/assets/images/{desktop-banner,home,mobile-banner}`、`src/components/atoms/PinnedIcon`、
自定义相册图片（`public/images/albums/{AcgExample,ExternalExample,HiddenExample,'just some pictures',abc}`、
`public/images/diary/*.png`）、`public/pio/models/pio`、`public/pio/static/*`

### 2.2 ⚠️ 那 364 项「内容不同」**不能都算 java-server 改的**

本地 ≈ 从「上游 Astro 6.1.2 时代的某个提交」分叉，而上游此后推进到 7.1.3。
两边都动过的文件（如 `src/components/atoms/**`、`src/components/control/**`）会被算进 364，**其中大部分是上游自身的演进**。
要把「java-server 的改动」单独剥出来，需要拿到**分叉点那个上游提交**做三方对比 —— 当前 `--depth 1` 克隆做不到，需补一次更完整的克隆（下一步可选）。

⇒ 这直接影响「清理 java-server 层」的可行性与工作量估计，所以**不建议在没做三方对比前动主题源码**。

---

## 3. 为什么「博客纯静态无 server」让这件事变得简单

- 实测 `api.blog.muyuyanran.com` → **DNS ENOTFOUND**（域名不存在）
- ⇒ java-server 注入层（含我为它做的 U5-THEME-A1 修复）**当前零功能**：站点不调用任何服务端
- 本次重建已把整层**静默**（见 §5）：首页动态加载器不渲染，全站仅 1 个孤儿页提到服务端 API

所以「这层留着」既不报错也不发请求，**不构成紧急问题**；清它是可选的整洁工作。

---

## 4. 四条路（请 dj 点一条）

| 路 | 做什么 | 代价 | 风险 |
|---|---|---|---|
| **A. 换到继任者 Shirone** | 以 `LyraVoid/Shirone`（Astro 7 / M3E）为新主题；内容迁到 `Shirone-Content` 或 `config/*.yaml` | **大**：站点外观、配置体系、组件体系全换；内容 + 数据 + 图片 + 自定义页面都要迁 | 高（现在的站点是好的） |
| **B. 拉 `LyraVoid/Mizuki` 上游** | 用已冻结的上游 9.0（Astro 7）覆盖主题代码 | **大**：内容迁移（上游新 schema 的 `_publishedDateOnly` / `_updatedDateOnly` 是**必填**）+ 129 项本地自有资产的取舍 + 重新决定 java-server 层 | 高，且终点是一个**停更**的主题 |
| **C. 不拉，维持现状** | 保留当前分叉；java-server 层标记「休眠」 | **零** | 低；但永远跟不上下游（已停更，其实也无所谓） |
| **D. 先纳管，再谈迁移** | 本地目录 `git init` + 以 `LyraVoid/Mizuki` 为远端、把 493 项差异落成可追溯提交；补一次完整克隆以定位分叉点 | **小**（半天内） | 极低 |

### 我的建议：**D → C，把 A/B 立成独立批次再评估**

理由：
1. 站点**现在是好的**（已重建、纯静态、零服务端依赖），A/B 都是「为了追上而承担下线风险」，收益不明确；
2. **D 是 A/B 的前置**：没有版本控制，任何主题操作都不可回滚、不可审阅 —— 这个风险是所有路里唯一的真风险；
3. 上游已停更 ⇒ 「跟上游」这件事本身价值很低；真要往前走，**A（Shirone）比 B 更合理**，但那是换主题级别的项目。

---

## 5. 本次已执行：②「重建」的结果

| 项 | 结果 |
|---|---|
| 旧产物 | 改名为 `dist.pre-u5-20261028-104816`（83M，**可回退**） |
| 新产物 | 全量重建成 `dist`：`astro build` → 29 页 → `pagefind` 索引 → `compress-fonts`（后者报「无字体配置」，属正常） |
| 顶层结构 | 与旧产物**逐项一致**（35 项） |
| 首页动态加载器 | `mizuki-dynamic-articles` 出现 **0** 次（`PUBLIC_MIZUKI_ENABLE_HOME_MERGE=false` 生效 ⇒ 纯静态） |
| 富文本壳页 | `dist/articles/` 只剩 `_server`（生产库 0 篇已发布富文本） |
| 全站服务端取数脚本 | 仅 **1** 个文件命中：孤儿页 `dist/articles/_server/index.html`（无入口链接可达） |
| `dist/posts/` | 7 条 markdown 正典路径齐全 |

> 说明：本次构建**跳过了** `node scripts/update-anime.mjs`（会联网写 `src/data/anime.ts`）—— 为避免动 dj 的数据文件，anime 数据沿用现有快照。若要完全对齐 `pnpm build`，需单独确认。

---

## 6. 待 dj 决定

1. **第 4 条点哪条路？**（A 换 Shirone / B 拉已停更的 Mizuki 上游 / C 维持现状 / D 先纳管 —— 建议 **D**）
2. 若走 D：是否允许我在 `BlogFiles/Mizuki` 执行 `git init` + 首次全量提交（**只建本地仓，不推任何远端**）？
3. 是否允许补一次更完整的上游克隆（`--filter=blob:none` 或全量，约 150–300M）以定位**分叉点**、把 java-server 的改动从「上游自身演进」里剥出来？
4. 本次已重建的 `dist` 要不要按你的方式上线？（我不清楚它现在怎么部署 —— 这点也请告知）

---

## 附：顺手发现

上游仓里带 **`CLAUDE.md`**（面向 AI 编码助手的通用行为准则）。克隆进工作区后，这类文件会被本会话的宿主当作项目指令自动加载 —— 本次它已被加载。
内容本身无害（「先想再写 / 保持简单 / 只改必要处」之类），但值得记一条：**克隆第三方仓库可能带入会自动生效的 agent 指令**。要彻底避免，克隆到工作区**之外**的目录。
