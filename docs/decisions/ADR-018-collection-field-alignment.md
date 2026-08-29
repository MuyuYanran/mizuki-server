# ADR-018: 集合字段面对齐官方与 id 类型修正（C2b）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-29 |
| 阶段 | Phase3-C2b（B4 审计 h3~h6 + g2 + anime 第七集合） |

## 背景

官方五页 verbatim 供料（架构师 2026-08-29 抓取，`docs/audits/b4-doc-excerpts.md` 对应节交叉印证）证实：B2 裁决 9 对 projects/skills/timeline 的 number id 属**过度覆盖**——官方三集合 id 均为字符串名称串、AnimeItem 无 id 字段；type/status/level 等枚举与必填面亦与 B2 实现有出入（SPEC-ALIGNMENT-B4 h3~h6/g2）。

## 决策

**迁移与定位总表（载入触发的死规则，全部幂等、原始值层、防死锁，ADR-014 机器扩展）**：

| 集合 | id 类型（官方） | 迁移规则（载入触发） | 定位器 |
|---|---|---|---|
| diary | number | 无（B2 已对齐） | number，max+1 |
| friends | number | 无 | number，max+1 |
| projects | **string** | id: number→String(n)；status: 'active'→'in-progress'、'done'→'completed'（其他非法值→不迁移，交由校验拒绝，禁自创映射） | string |
| skills | **string** | id: number→String(n)；level: 1→'beginner'、2→'intermediate'、3→'advanced'、≥4→'expert'（非 number 不迁移）；**skills.projects[] 各项同步 String 化**（与 projects id 迁移同批一致） | string |
| timeline | **string** | id: number→String(n)；type: 'certificate'→'work'、'other'→'achievement' | string |
| devices | 无 id（grouped，name 为键） | 无（字段面收敛恰 5 必填） | name |
| anime | **无 id 字段** | 新集合无存量 | **title**（idField:'title'，numericId:false，禁止向条目注入任何 id 字段——幽灵字段禁令） |

- **迁移触发点**：沿用 ADR-014 载入触发原始值层点位（zod parse 之前），实现于 `CollectionsService.migrateLegacyValues`（list/create/update/remove 四入口先于任何读写）；不传 schema（防死锁）；文件锁 + temp+rename + pre_write 备份原子写回；磁盘字节仅变迁移目标；幂等（官方值直通）。
- **字段面**：projects/skills/timeline/devices 四 schema 按官方逐字收紧（必填面、枚举、YYYY-MM-DD 日期），`.strict()` 未知字段拒绝；devices 恰 5 必填字段；diary/friends 不动。
- **anime canonical 文件形状**（fixture 与 Server 新建文件均按此）：

```ts
// src/data/anime.ts —— Server canonical 形状
export const localAnimeList: AnimeItem[] = [ /* 引擎管理的 initializer */ ];
export const getAnimeList = () => localAnimeList;
```

getAnimeList 必须位于 localAnimeList **之后**（引擎 golden 字节保持的后缀区，改数组不动函数）。真实主题文件若 localAnimeList 未导出 → 引擎 ExportNotFoundError 404，属已知限制（用户一次性补 export 关键字或由 Server 新建文件）。anime.mode/bangumi/bilibili 配置属 config.ts 域 → C7。

- **slug 规则**：projects/skills/timeline POST id 留空 → slugify（小写、空白/下划线转连字符、剔除 [a-z0-9-] 外字符；结果空 → `item-<nanoid(6)>`，来源字段 title/name，registry `slugSource`）；冲突 409（既有语义）。编辑时定位键只读（改 id/title = 换定位器，禁止 → 400；diary/friends number id 与 devices name 分支语义不变）。
- **:id 校验 registry 化**：diary/friends 维持数字校验（非数字 400）；projects/skills/timeline/anime 接受字符串（URL 解码后按 idField 定位）。

## 理由

主题按官方字段面/类型消费数据文件，编译兼容优先；枚举/必填面错位会导致主题构建期渲染失败或类型报错。迁移取「一次性收敛 + 官方值直通幂等」，与 ADR-014 的自动迁移语义同构（用户无感、不留兼容层）。

## 影响

- p4b 语义修订：number id 自动换新仅余 diary/friends 两类；p4b ③ 幂等载体 timeline→projects（timeline id 已官方 string 化）；
- :id 校验 registry 化后，字符串 id 集合不存在 → 404（非 400）；
- anime 第七集合入 registry → `/public/collections/:type` 白名单自动含 anime（路径与形状不变，公开 API 冻结遵守）；
- C7 config.ts 域边界：anime.mode/bangumi/bilibili 配置管理归 C7，本批不碰；
- 面板 SchemaForm：id 字段只读（创建留空提示自动生成）、timeline links 对象数组 JSON 文本框兜底、anime 月份精度日期控件（YYYY-MM）。

> columns 上界 6 为 Server 防呆上限（C2a 规格），官方仅『默认 3』无上界——非官方口径。
