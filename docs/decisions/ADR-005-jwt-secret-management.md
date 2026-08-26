# ADR-005: JWT secret 管理策略与配置文件测试钩子

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-26 |
| 阶段 | P6（认证与初始化） |

## 背景

P6 §3.1 要求：JWT secret 从 config/env 读取——优先环境变量 `MIZUKI_JWT_SECRET`；缺失时自动生成强随机密钥并持久化到 `data/config.json`（`jwtSecret` 字段），保证重启后 refresh token（7 天时效）仍有效。同时，既有测试基建已有 `MIZUKI_DB_PATH` 测试注入钩子（P0b 偏差 5 先例），init 流程写 `config.json` 的 e2e 需要相同的隔离能力，否则测试会污染真实 `apps/server/data/config.json`。

## 决策

1. **secret 解析优先级**：`MIZUKI_JWT_SECRET`（非空）→ `config.json.jwtSecret` → 兜底生成并持久化。init 成功时若 env 未提供，则生成 `randomBytes(48).toString('base64url')`（384 bit）写入 config；写入后 `resetAppConfigCache()` 刷新配置单例。
2. **AppConfigSchema 追加可选字段 `jwtSecret: z.string().optional()`**（P6 §4.5 授权）。
3. **`MIZUKI_CONFIG_PATH` 环境变量钩子**：`defaultConfigPath()` 优先读该变量，与 `MIZUKI_DB_PATH` 同模式，仅用于测试隔离。
4. **锁定参数**（规格定值，记录备查）：连续 5 次失败 → 锁定 15 分钟（`locked_until`），锁定时失败计数清零；锁定值见 P6 §3.3。
5. **logout 无状态**：不维护服务端黑名单，返回 200，客户端清除 token（P6 §3.1）。

## 备选方案

- secret 仅存环境变量、不落盘：重启后依赖部署侧注入，本地单机场景（本服务定位）易丢失 → 7 天 refresh token 全部失效，体验断裂 → 否决。
- secret 存数据库 `site_setting` 表：config.json 在「数据库可用之前即需读取」的定位更基础，且 secret 与启动配置同生命周期 → 选 config.json。

## 后果

- 重启后 token 持续有效；env 注入通道保留（部署可用外部密钥覆盖文件值，文件值此时不生效也不冲突）。
- `config.json` 含敏感密钥：该文件位于 `apps/server/data/`，已被 `.gitignore` 覆盖不进 git；日志与响应不输出密钥（P6 验收 §6.9 断言脱敏）。
- 拿到部署需求后若改密钥管理（如密钥轮换），修订本 ADR。
