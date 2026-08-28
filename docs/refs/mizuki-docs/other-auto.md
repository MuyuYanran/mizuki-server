> 快照说明：抓取自 https://docs.mizuki.mysqil.com/Other/auto/ ，快照日期 2026-08-28，文档日期 2025-11-20。仅供 B4 审计引用。

# 自动构建

## 问题

启用内容分离后，内容仓库（Mizuki-Content）更新不会自动触发代码仓库（Mizuki）的重新部署。

## 解决方案（推荐）

使用 **Repository Dispatch** 让内容更新时自动触发构建，适用于所有部署平台。

## 5 步快速配置

1. 创建 GitHub Token（scopes 勾选 `repo`）。
2. 在**内容仓库**添加 Secret：`DISPATCH_TOKEN`。
3. 修改内容仓库 `.github/workflows/trigger-build.yml` 的 repository 为你的代码仓库。
4. 更新代码仓库 `.github/workflows/deploy.yml` 的 `on:` 部分，添加 `repository_dispatch: types: [content-updated]`。
5. 内容仓库推送一次测试。

## 故障排查（节选）

- Token 问题：`Bad credentials` → 确认 Token 完整、有 repo 权限。
- 仓库名称问题：`Not Found` → 确认 `owner/repo` 格式。
- 代码仓库未触发：检查 `repository_dispatch` 与 event type `content-updated`。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
