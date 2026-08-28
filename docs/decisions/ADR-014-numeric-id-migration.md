# ADR-014: 六类集合 id 类型迁移语义（自动换新）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-28 |
| 阶段 | Phase2-B2（裁决 9） |

## 背景

一期 Server 六类集合（diary/friends/projects/timeline/skills/devices）id 采用 nanoid string（P4 决策）；B4 审计发现官方规格 id 为 number（SPEC-ALIGNMENT-B4 总表 + 追加裁决项 9）。人工裁决选定「自动换新」语义：存量 string id 一次性换新为 number（max+1），不保留旧 id 映射、不做旧引用兼容；需旧 id 的用户在面板重编。

## 决策

1. **迁移触发点（防死锁）**：引擎载入集合文件时触发——在 zod parse **之前**对原始 JSON 检测，发现任一 id 非 number 立即执行换新，经引擎既有管线原子写回（文件锁 + temp+rename + pre_write 备份），再走正常流程。实现于 `CollectionsService.ensureNumericIds`，在 list/create/update/remove 四入口先于任何读写调用。
2. **原始值层操作**：迁移函数调用 `mutateCollection` 时**故意不传 schema**——迁移不得依赖新 schema 的 parse 成功（存量数据可能同时存在旧形状字段，先 parse 会死锁：旧数据进不来、新流程写不回）。
3. **max+1 基准**：文件内现存 number id 最大值 +1 起（全 string 则从 1 起）；换新后保证文件内唯一（Set 查重跳过）。
4. **幂等**：全 number 的文件不触发迁移（结构异常交由后续正常流程报错，迁移不吞）。
5. **新生成 id**：POST 自动生成改 max+1（`nextAutoId`），并发写入挪动基准时冲突重试，上界 1000 次（`MAX_ID_RETRY`）。
6. **devices 例外**：devices 为 grouped 形状，官方规格无数字 id（idField 为 name，用户填写的分组内唯一键），保持 string 不参与迁移（registry `numericId:false` 注记）。故迁移实际覆盖五类（diary/friends/projects/timeline/skills）。
7. **无兼容层**：迁移完成后盘上无 string id；`:id` 路由参数改数字校验（`routeId`，仅接受正整数字符串），无双兼容分支；旧引用（文章正文内嵌 id、跨集合引用）不做改写——需旧 id 的用户在面板重编（裁决原文）。

## 备选方案

- **保留旧 id 映射 + 双读兼容**：迁移期新旧 id 并存，路由按类型分支——兼容层永久化成本高、双形状测试面翻倍 → 否决（裁决明确「不做旧引用兼容」）。
- **一次性手工迁移脚本/面板按钮**：把迁移负担转嫁给用户，且与「文件即数据库」的载入语义割裂 → 否决。
- **迁移放在 zod parse 之后**：依赖新 schema parse 成功，旧形状数据直接被拒，形成死锁 → 否决（评审修订触发点的原因）。

## 后果

- 存量项目首次访问任一集合端点即自动完成迁移并落盘，用户无感；迁移发生时 warn 日志留痕；
- e2e 存量 string 数据由测试 setup 直接写入数据目录构造（fixture 本体已 number 化），`p4b-id-migration.e2e-spec.ts` 用例 ① 即「死锁修复的直接证明」（临时 string 文件 → 列表接口 → 响应与磁盘均 number 化）；
- 六类 schema/shared mapper/media-reference 类型同步 number 化；面板 SchemaForm id 字段只读展示（新条目自动分配、编辑不可改）；
- 备份导出 JSON id 为 number，round-trip e2e 断言一致；
- 官方主题按 number id 消费数据文件，迁移后与官方兼容。
