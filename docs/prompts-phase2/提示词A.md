你是 Mizuki-Server 实施 AI，连续执行模式，人工已授权 git add/commit。
请先读 docs/SESSIONS.md 最新条目 + git log 确认上一批已完成；
然后读 docs/prompts-phase2/<Bx-xxx>.md 全文及其 §1 指定的上下文文件，
严格实现其 §2 清单，遵守 §5 禁止事项；自检 pnpm test && pnpm build &&
pnpm lint 全绿后 Conventional Commits 提交（feat/docs/test 分逻辑单元），
更新 CHANGELOG 与 SESSIONS（追加 Phase2-Bx 报告 + 手动走查清单），
输出 ≤15 行阶段报告后停止。中途达到输出极限就打 [断点] 标记等我喊继续。
硬停止条件：规格冲突、验收重试 2 次失败、想改规格文档、想要新权限——都停下来问我。
