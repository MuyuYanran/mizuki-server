# @mizuki/web（管理面板）

Mizuki-Server 的管理前端：**Vue 3 + Element Plus + Vite + TypeScript（strict）**。

## 阶段状态（P10a 起）

- **P10a（已实现）**：面板外壳——登录页、初始化向导（四步）、主布局与侧边栏导航、
  路由守卫（未登录 → `/login`）、统一请求层（自动附 Bearer Token、401 自动
  refresh 且并发去重、适配后端 `{ code, message, detail }` 异常格式）。
- P10b（待实现）：六类集合管理页（`@mizuki/shared` zod schema 驱动表单）。
- P10c（待实现）：文章管理（Markdown + TipTap 富文本 + about）。
- P10d（待实现）：媒体库、相册、备份恢复、构建预览控制台、仪表盘、设置。

## 开发

```bash
pnpm --filter @mizuki/web dev      # http://localhost:20155（dev 代理 /api → 20154）
pnpm --filter @mizuki/web build    # vue-tsc --noEmit && vite build
pnpm --filter @mizuki/web preview  # 产物预览
```

生产形态：面板静态产物与后端同源部署，统一经 `/api/v1` 与 `@mizuki/server` 通信
（MASTER-PLAN §1：管理面板与 API 同源，端口 20154）。

## 约定

- 所有 API 调用只经 `src/api/` 封装，禁止组件内裸写 URL 字符串；
- `refreshToken` 只用于 `/admin/auth/refresh`，不附加到普通请求头；
- 前端不出现任何 secret（JWT 密钥、密码常量）。
