# 部署 Checklist（Phase3-C5 收口产物）

| 字段 | 内容 |
|---|---|
| 状态 | 已收口（C5） |
| 日期 | 2026-08-29 |
| 载体由来 | C6（cpolar 通道批）于执行前撤销，其「部署 checklist 残项」并入 C5；原定载体未及产出，本文件为 C5 收口产物（盘点基线 = REQUIREMENTS-PHASE3 §2 C5 行 + §1.5 撤销记录） |

## 一、C6 残项收口（cpolar 通道）

- **撤销口径**：cpolar 通道已于 2026-08-28 关闭，安全事件闭环（REQUIREMENTS-PHASE3 §1.5）。
- **残留盘点结论**：全仓跟踪文件 grep（cpolar / 内网穿透 / 通道）仅命中撤销记录本身与未跟踪的
  `docs/HANDOFF-ARCHITECT.md` 历史注记（107/111 行）——**无部署文档条目残留，无删除动作**。
- **历史建议作废**：「再暴露公网用 https + cpolar HttpAuth 双层」（HANDOFF-ARCHITECT L111）随通道
  撤销作废；公网暴露口径改为「https + 反向代理 + 生产 Swagger 置 false」，见下表第 4/10 项。

## 二、Checklist 逐项盘点

| # | 项 | 状态 | 依据/说明 |
|---|---|---|---|
| 1 | 单命令生产启动（`pnpm install && pnpm build` + `node apps/server/bin/mizuki-server`） | 已具备 | README「快速上手·生产形态」 |
| 2 | 初始化向导（Mizuki 目录检测 + 管理员账号，仅一次） | 已具备 | P0b |
| 3 | 生产 Swagger 关闭（config.json `"swagger": false`） | 已具备 | README 公网部署建议（本地默认开启） |
| 4 | JWT 密钥生产注入（`MIZUKI_JWT_SECRET` 优先；否则 init 生成强随机密钥持久化 config.json） | 已具备 | ADR-005 |
| 5 | 数据备份集（DB + Mizuki 目录 + config，备份/恢复模块） | 已具备 | ADR-003、备份模块 |
| 6 | 端口规划（主服务缺省 20154；preview 缺省 4173，占用 → 启动报错含换端口指引） | 已具备 | main.ts / ADR-019 参数终值表 |
| 7 | /preview 通道部署形态（暴露面 = 管理端同域 JWT；localhost http 无 Secure cookie 系已知限制） | 已具备（部署注记级） | ADR-019；**【F 终裁 2026-08-29】缺省绑定维持镜像主服务 host 语义（ADR-019 既有裁决），收紧通道 = `MIZUKI_PREVIEW_HOST` 覆盖（第三节 env 行在册）——C4 疑问 2 候选就此关闭** |
| 8 | 无 hash 静态资产缓存策略 | 已具备 | **【F 修订 2026-08-29，ADR-019 追加节】**三档分派：HTML 入口 no-cache / `_astro/` 内容指纹资产 immutable / 其余 public 直拷 no-cache（正确性优先）——原「`_astro/` 外走默认头」描述作废；C4 疑问 1 候选就此关闭（e2e：p9d ⑦⑧⑨） |
| 9 | 内容分离部署（`CONTENT_REPO_URL` 等 env） | 不适用 | feature-surface D 档：主题侧能力，Server 不承接 |
| 10 | 自动构建 / 自动部署（GitHub Repository Dispatch） | 不适用 | feature-surface D 档排除（需 token，超 Server 职责） |
| 11 | https + 反向代理（替代已撤销的 cpolar 方案） | 待具备（运维侧） | 非 Server 代码项；公网暴露前置条件 |
| 12 | 数据目录落位（`apps/server/data/`，gitignored；**勿以测试覆盖**——C5 起测试数据全部隔离至 mkdtemp 临时域） | 已具备 | db.module / app-config 缺省路径；隔离见 CHANGELOG Phase3-C5 |
| 13 | **主题仓非 git 备份建议**（F T5.4 增补，运维侧）：主题仓（mizukiRoot）非 git 仓库，config.ts 会被站点配置面板**物化改写**——建议部署备份集将 `<mizukiRoot>/src/config.ts` 物化态与 `apps/server/data/config-override.json` 侧车（跟踪树外）随 data/ 一并纳管（还原链：清空侧车 siteConfig 键 + config.ts 恢复，ADR-020 originals 留档可还原）；迁移时两者同迁 | 建议（运维侧自管） | C7 ADR-020「备份迁移归部署 checklist 条目」注记闭环；备份模块备份集（ADR-003）覆盖 mizuki 目录整体，本条为部署形态下的显式提醒 |

**【Phase4 重构追记（2026-09-11）】** config.json 的 `corsOrigins`（string[]，缺省 `[]`）此前
**未纳入 AppConfigSchema**，而 zod 对象默认剥离未声明键 → 该键恒被丢弃，`app.setup.ts` 的 CORS
扩展白名单是「注释承诺存在、实现永不生效」的死代码。现已纳入 schema 并真实生效（形态非法回落空数组，
不阻塞启动）。**部署形态补充**：前后端分离、反向代理或自定义域名访问时须在此键登记前端 origin，
否则浏览器侧因缺少 `Access-Control-Allow-Origin` 头而拒绝跨源请求。详见
`docs/audits/phase4-refactor-implementation.md` §2（B3）。

## 三、环境变量清单（全量盘点，ADR-019 参数终值表为 C4 项唯一事实源）

| 变量 | 缺省 | 说明 | 引入 |
|---|---|---|---|
| `MIZUKI_SERVER_PORT` | `20154` | 主服务端口 | P0b（main.ts） |
| `MIZUKI_WEB_DIST` | `apps/web/dist` | 面板静态托管目录（不存在则跳过托管仅 API） | P11 |
| `MIZUKI_CONFIG_PATH` | `apps/server/data/config.json` | 配置文件路径覆盖 | P0b |
| `MIZUKI_DB_PATH` | `apps/server/data/mizuki.db` | SQLite 路径覆盖 | P0b |
| `MIZUKI_JWT_SECRET` | 无（init 生成持久化） | JWT 密钥部署注入通道（优先于 config.json） | P2 / ADR-005 |
| `MIZUKI_LOG_LEVEL` | `info` | pino 日志级别 | P0a |
| `MIZUKI_PM_<NAME>_PATH` | 无 | 包管理器显式路径；`NAME` ∈ pnpm/npm/yarn（bun 经显式配置可达）；resolve 期活读 | C3 / ADR-011 |
| `MIZUKI_PREVIEW_PORT` | `4173`（占用 → 启动报错） | /preview 预览通道端口；端口 0 → 临时端口 | C4 / ADR-019 |
| `MIZUKI_PREVIEW_HOST` | 镜像主服务 host（实为全接口） | /preview 绑定 host | C4 / ADR-019 |
| `MIZUKI_PREVIEW_DIST_PATH` | `<mizukiRoot>/dist` | /preview dist 根（请求期活读，P11 坑 5 纪律） | C4 / ADR-019 |
| `MIZUKI_CONFIG_OVERRIDE_PATH` | `apps/server/data/config-override.json` | 站点配置 override 侧车路径覆盖（跟踪树外；备份迁移归部署 checklist 条目） | C7 / ADR-020 |

**盘点结论**：README 部署节原仅列举 `MIZUKI_SERVER_PORT` / `MIZUKI_WEB_DIST` 两个变量，其余 8 个
散落于各 ADR/快照——本清单补入全量（C5 T2.3）。命名域亦含非配置消费 `PATH`（pm-resolver 层③
定位器，ADR-011），属运行环境依赖非部署配置。【Phase3-C7 注记】新增 `MIZUKI_CONFIG_OVERRIDE_PATH`
（ADR-020），全量 10 → 11 个；其缺省载体目录 apps/server/data/ 已 gitignore（跟踪树外硬约束），侧车
备份与迁移列入部署 checklist 条目（运维侧自管）。

## 四、收口结论注记（T6.3）

本文件即 C5「部署 checklist 收口」产物：C6 残项闭环（第一节）、逐项盘点落判（第二节）、env 全量
补齐（第三节）。遗留候选（第 7/8 项两处「待收官裁」）不阻塞部署，移交收官批裁决。

**【Phase3-F 追记（2026-08-29）】** 第 7/8 项两处「待收官裁」已由收官批终裁关闭（第 7 行
维持镜像语义、第 8 行三档缓存分派，见 ADR-019 追加节）；第 13 行主题仓非 git 备份建议条目
增补（C7 侧车迁移注记闭环）。本清单全表无「待裁决」残项，三期收官终态成立。

**【Phase4-D3 追记（2026-09-02）】** build 三连**未触发**宿主 safe-delete shim 绕行
（`pnpm build` 直通，vite 清 dist 正常——显式汇总，禁与 D2 期绕行混淆）；nav 受控子集
（#8）复用既有 `MIZUKI_CONFIG_OVERRIDE_PATH` 侧车载体，**无新增环境变量**（11 → 11）；
侧车 `config-override.json` 新增 `nav` 键字段面，留档键 `originals.navBarConfig` 随既有
留档机制，备份迁移条目不变。

**【Phase4-E3a 追记（2026-09-02）】** theme-lock 机制（ADR-024）部署语义：

- **新增环境变量 `MIZUKI_THEME_BASELINE_PATH`**（缺省
  `apps/server/data/theme-baseline/baseline.json`，gitignored 运行时产物）——env 全量
  11 → 12；基线随 data/ 目录一并备份迁移（与第 13 条侧车同批注记）。
- **部署期首次 capture 注记**：重克隆/新部署无基线文件 → `GET /admin/theme/status`
  呈现无基线态（drift = no-baseline，非错误）→ 首次 `POST /admin/theme/capture`
  建立基线后进入诊断态。基线非部署必需品（探针轴/门禁不依赖基线），仅漂移诊断需要。
- **主题升级流程三步语义**（改主题声明结构 → 物化写入器 409 拦截后）：
  ① 重新捕获基线（`POST /admin/theme/capture`——仅重置漂移轴/诊断，探针轴不受影响）；
  ② 核对并修订 Tier 1 档案（`packages/shared/src/theme-profile.ts` 与
  `docs/profiles/mizuki-tier1.md` 派生件同步，`profileVersion` 递增）；
  ③ 评估物化适配性（site-config 受控子集写入器与新主题结构兼容性）——三者齐备后
  门禁放行，物化恢复。
