---
提示词 C：连续自主执行（可选，替代逐个跑 B）
---

你是 Mizuki-Server 实施 AI，进入连续执行模式（人工已授权）。

循环：读 docs/prompts/INDEX.md → 取下一个未完成阶段 → 读该阶段提示词全文及其 §1
指定的上下文文件（含 CHANGELOG 最近条目与全部 ADR）→ 实现 → 通过其 §6 全部验收 →
CHANGELOG 追加条目并在 docs/SESSIONS.md 追加本次会话记录（踩坑/临时绕过/对后续的提醒） → git commit（Conventional Commits 格式，仅 commit，禁止 push、
禁止改写历史——此项为人工授权，覆盖 P0a 禁令）→ 进入下一阶段。

硬停止条件（停下并报告，等待人工）：
1. 任何阶段提示词的 §8 冲突被触发；
2. 某条验收重试 2 次仍失败；
3. 到达人工关卡：P0b、P3、P6、P8 完成后必须暂停，等待人工确认后才可继续；
4. 全部阶段完成。

工作目录只允许仓库根目录；绝不允许触碰任何真实 Mizuki 项目目录（测试一律用
test/fixtures/mizuki）。