# ADR-020：主题 config.ts 受控子集管理（override 批）

- 状态：ACCEPTED（2026-08-29，Phase3-C7）
- 关联：决议 1（commentConfig 面板化归 C7）、决议 7（i18n 收口 siteConfig.lang）、ADR-013（对齐框架）、ADR-016（评论走主题）

## 背景

决议 1 将 commentConfig 面板化管理归 C7（override 批）；架构师 2026-08-29 裁决 siteConfig.lang
（i18n Server 侧收官面）并入同批。预公告 v2 以两条硬约束取代 v1「物理禁写 config.ts」：
① config.ts 在跟踪树零 diff（物理形态不限）；② 非受控字段值与主题基线一致（值不变语义）。
侦查实证：主题仓（mizukiRoot）非 git 仓库——「git 策略」维度在当前部署形态为空集；
config.ts 为构建期静态导入（astro.config.mjs + 组件直连），无 env/alias 钩子，值烘进 dist。

## 决策

1. **载体形态**：侧车 JSON（override 状态 + 被置换原文本留档）+ ts-morph **声明级定点置换**
   `<mizukiRoot>/src/config.ts` 受控声明（siteConfig.lang / commentConfig）的初始化器；
   其余声明零触碰——非受控值不变语义由构造保证。侧车路径 `MIZUKI_CONFIG_OVERRIDE_PATH`
   ?? `apps/server/data/config-override.json`（跟踪树外，gitignored；备份迁移归部署 checklist 条目）。
2. **合并点与生效链**：保存即物化（config.ts 写入 = pre_write 备份 + 原子写）；站点生效
   经 console build 任务（process 白名单，C3 解析链仅调用），不新增旁路构建路径；
   运行时 sidecar 形态被 C4 纯静态直出裁决排除。侧车不参与启动（活取值纪律，P11 坑 5 同型）。
3. **admin 端点族**（§0 写死）：`GET /admin/config`（整体读，override 优先 + 基线对照，
   基线经「简单常量代入」求值——`lang: SITE_LANG` 类标识符代入 `const NAME = 字面量`；
   物化态下 siteConfig.lang 真基线从留档原文本探针求值）；`PUT /admin/config/lang`；
   `PUT /admin/config/comments`（全量覆盖）。受控子集 schema 全 `.strict()`（越界键 400 禁静默剥除），
   驻 shared 供前后端共用。
4. **lang 口径**：复用 C5 posts lang 裁决（引用不重写）——shared `langCodeSchema()` 共享终行
   供 posts frontmatter 与 siteConfig.lang 两处引用（共享抽取记偏差，字段面零变化）。
   commentConfig 内 twikoo.lang/giscus.lang 为普通字符串（主题约定形如 'zh_CN' 下划线形），
   不套用 BCP-47 口径。
5. **commentConfig 承载**：schema-form 直接表单化（enable→switch、system→select、
   twikoo/giscus→group 递归；无数组嵌对象形态——债堆④不触发，mapper 仅新增可选
   labels 参数供页面级中文标签，默认行为零变化）。字段面对齐主题类型定义零删减零改名
   （TwikooConfig 含官方文档快照没有的 `region?`——以主题类型定义为准入面）。
6. **敏感键**：T1.1 盘点 commentConfig 无真 secret 性质键（值烘进公开 dist：giscus 键
   公开性质、envId 公开服务地址，Twikoo 管理凭据在其自建数据库）→ **脱敏义务不触发**，
   GET 不做掩码；e2e ④⑧条件例以判定注记替代（用例以额外实测试补至下限 369）。
   commentConfig override 无显式清除路径（覆盖写入即管理权转移）。
7. **四格语义表（PUT /admin/config/lang，body `{ lang }`）**：
   | 输入 | 行为 |
   |---|---|
   | 键缺失 | 归一缺省：清除 override（config.ts 还原留档原文本），侧车不落键，200 |
   | 空串 `''` | 同上（C5 口径：空串归一为未设置 = 站点默认） |
   | 非法（内嵌空白 / 超 16 / 越界键） | 400（issues：`lang` / Unrecognized key） |
   | 合法（`en` / `zh-Hant` 等 BCP-47 简码） | 物化 config.ts + 侧车记录，200 回读 override 态 |
   **PUT /admin/config/comments（body = commentConfig 对象）**：缺必填键 / 非法值 / 越界键 →
   400（零物化零落键）；合法 → 全量覆盖物化。可选键空串由面板归一为不落键（必填键空串
   视为用户显式输入原样写入）。

## 理由（四候选对照，T1.5）

| 候选 | 硬约束① | 硬约束② | 结论 |
|---|---|---|---|
| ① 直写 + git 策略 | ✓（config.ts 在主题仓，非 Server 跟踪树；主题仓无 git） | ✓（定点置换） | **可行（选定①，融合④的「基线为源」语义：留档原文本即键级基线）** |
| ② env 注入构建 | ✓ | ✓ | 否：需改 astro.config.mjs/import 链，侵入主题构建配置，超受控子集 |
| ③ 运行时 sidecar | — | — | 预公告 d 排除（C4 纯静态直出），对照保留 |
| ④ 生成物重生成 | ✓ | ✓ 但脆弱 | 否：整文件重生成需 Server 持有全文件模板，主题升级漂移风险大；其语义经声明级置换等价达成 |

## 影响

- **受控子集边界**：仅 siteConfig.lang + commentConfig；其余 config 字段物理写入不算触碰、
  值漂移才算（预公告 a②），面板不呈现不受控字段（禁蔓延由 `.strict()` 兜底）。
- **commentConfig 公开性质**：值随构建烘入站点前端访客可读，面板不承载任何机密。
- **已知限制**：config.ts 被手改后侧车与文件可能漂移（重新保存即再物化）；config.ts 缺
  siteConfig/commentConfig 声明或受控键形态不符 → 404 显式报错；基线含未支持字面量节点
  （模板插值/函数调用等）→ 基线不可得，GET 相应键返回 null，面板空表单起步；变更不发射
  content.changed（scope 枚举为内容同步契约，站点生效经 build 任务通道表达）；置换片段以
  2 空格 JSON 美化序列化（valueToTsLiteral），与主题缩进风格差异不影响构建。
- **债堆④处置结果**：commentConfig 无数组嵌对象形态 → 本批不触发、不扩 mapper（JSON 文本域
  兜底能力保留给既有数组场景）。

## 追加（Phase3-F，2026-08-29）：siteConfig.lang 口径拆分

C7 疑问① 收官落地：语言代码口径拆分双 schema——`langCodeSchema`（posts 域，
BCP-47 连字符口径冻结）与 `siteLangSchema`（config 域，分隔符 `[-_]` 双兼容，
主题约定 `SITE_LANG = "zh_CN"` 下划线形；纯数字段与大小写并存属有意宽松）。
`PUT /admin/config/lang` 请求体与 override 载体 `siteConfig.lang` 切至
`siteLangSchema`，站点配置页本地预检同步切换；posts 引用零变化。**仅校验口径
切换**——载体形态 / 合并 / 持久化机制冻结；本 ADR 其余裁决（侧车 + 声明级定点
置换、敏感键无、留档还原语义）不变。四格语义表见 SESSIONS 收官报告。
