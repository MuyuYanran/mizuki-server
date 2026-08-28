# ADR-015: 改密后的 token 窗口语义（access 不主动吊销）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-28 |
| 阶段 | Phase2-B2.1（判卷残留补记，机制随 B2 T4 落地） |

## 背景

Phase2-B2 T4 实现改密端点 `PATCH /admin/auth/password`（旧密码 argon2id verify + 新密码哈希），并新增 `admin_user.token_version` 字段实现会话吊销。

## 决策

改密成功 → `admin_user.token_version` +1；refresh token 内携带 `ver` claim，刷新时与表内值比对，不一致即 401——旧 refresh 全部失效；新密码可登录、新 refresh 可轮换。

## 窗口语义（本 ADR 核心）

已签发的 **access token（15min TTL）不主动吊销、无黑名单**——改密后旧 access 在自然过期前（最长 15 分钟）仍可用。风险接受理由：TTL 短（15min）+ 无状态先例（ADR-005 决策 5：logout 同样不维护服务端黑名单），引入 access 黑名单需为每次请求增加存储查询，与本服务单机定位不成比例。

## 证据链

`apps/server/test/p2b-t4-auth-system.e2e-spec.ts` 改密三用例：改密②（token_version 递增落库）、改密③（旧 refresh → 401；旧 access 有效期内仍可用）、改密④（新密码登录 → 200；新 refresh 可轮换）。
