# apps/server/data —— 运行时产物目录

本目录由服务运行时生成与维护，已被 `.gitignore` 忽略（仅本 `README.md` 与 `backups/` 纳入版本控制）。

## 运行时产物

- `config.json` —— 站点配置（**P0b** 起由 `config/app-config` 读取并 zod 校验）
- `mizuki.db` —— Drizzle + better-sqlite3 文件数据库（**P0b** 起，位于本目录）
- `backups/` —— 备份目录（**P2** 起）
  - `pre_write/` —— 写操作前的自动快照
  - 手动备份与 DB 备份，含 `manifest` 清单与恢复入口
