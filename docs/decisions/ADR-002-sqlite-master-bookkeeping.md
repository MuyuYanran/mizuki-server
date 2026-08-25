# ADR-002: sqlite_master 断言对 drizzle 迁移记账表的处理

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-26 |
| 阶段 | P0b（数据库定型关卡） |

## 背景

P0b 验收 §6.1 要求：临时目录执行 `runMigrations` 后查询 `sqlite_master`，断言表名集合**恰好**为 11 张业务表。而规格 §3.3 同时要求迁移必须使用 `drizzle-orm/better-sqlite3/migrator` 的 `migrate()`——该函数会在库中自动创建第 12 张表 `__drizzle_migrations`（迁移簿记：记录已应用的迁移文件与时间戳，是幂等执行的基础）。两条要求按字面同时执行必然矛盾。

## 决策

采用「更保守、更少代码」的解释（P0b §8 末句授权）：断言集合 = 11 张业务表 + `__drizzle_migrations`，即：

- 业务表集合（排除 `sqlite_*` 内部表与 `__drizzle_migrations`）**恰好**等于 11 张表名——多一张、少一张都算失败；
- 额外断言 `__drizzle_migrations` 存在，证明走的是 drizzle migrator（而非手工建表）。

理由：`__drizzle_migrations` 是迁移工具的内部记账，不是数据模型的一部分；11 张表定型的实质约束（六类集合不建表、表清单逐字对齐 MASTER-PLAN §3）不受影响。

## 备选方案

- 自行解析 drizzle 迁移 SQL 并逐条 `exec`（不产生记账表）：可让字面断言成立，但需重造 migrate() 的顺序/幂等逻辑，代码量与出错面显著增加，且偏离「使用 migrator 的 migrate()」的明确规格 → 否决。

## 后果

- 后续阶段的测试若统计表数，同样需排除 `__drizzle_migrations`；
- 数据库定型关卡的核对基准为「11 张业务表 + 1 张工具记账表」；
- 若未来更换迁移方案（如 push 模式），记账表可能消失，本断言需同步调整。
