# ADR-011: 包管理器确定性解析策略（R2-16）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳（人工裁决） |
| 日期 | 2026-08-27 |

关联：R2-10 控制台历史持久化 / 一期 P9 进程管理安全模型

## 背景

用户实测 Windows 下启动 build 任务失败：spawn('pnpm') 命中的 `.cmd` 垫片
指向 pnpm 按 dlxCacheMaxAge 自动清理的内容寻址缓存路径
（`D:\.pnpm-store\v11\links\@pnpm\exe\10.x\...`），报
"is not recognized as an internal or external command"；且系统内多版本
pnpm 共存时 PATH 解析结果不稳定。

三层成因：① Windows 上 spawn 以 shell:false 直接调 .cmd/.bat 属已知 Node
行为缺陷【cmd-shim 类问题】；② dlx 缓存可被清理，垫片随时可能悬空；
③ 多来源 pnpm（全局/corepack/dlx 缓存）并存。

## 决策

ProcessManagerService 在 spawn 前增加「确定性解析」步骤：

1. 按 lockfile 类型确定候选命令名（pnpm-lock.yaml→pnpm、package-lock→npm、
   yarn.lock→yarn）；
2. 解析真实可执行体：目标项目 `node_modules/.bin/<cmd>.cmd` 优先 →
   全局 where/which 兜底；
3. 若命中 `.cmd`/`.bat`：读取垫片文本提取其指向的实际 `.cjs`/`.js` 入口，
   最终命令改写为 `process.execPath + 入口js + 原参数数组` 直跑；
4. 解析失败的报错必须含人类可读诊断（多版本共存提示 / "请全局安装
   pnpm@<推荐版>" 指引），不得裸抛 ENOENT。

## 决策理由

- **为什么不改用 shell:true 或 cmd /c 中转**：P9 安全模型的根基是
  白名单任务 + shell:false + env 受控透传；引入 shell 层等于重开命令注入面，
  安全复查条款不可为修复便利倒退；
- **为什么不用固定路径直接调用 pnpm**：路径因机器而异，Server 不应硬编码
  用户环境；穿透垫片到 js 入口天然跨机器成立（入口经 node_modules 结构
  可推导）；
- **为什么记录改写后命令进 task_run.command_snapshot**：排障时能看到真实
  执行体而非字面意图，这与本 ADR 同目的。

## 影响与验证义务

- spawn 参数构造仅此一处变更，白名单四任务的集合与开关交互不变；
- 实施完成后必须附真实环境证据于交付报告：在宿主机跑一次 pnpm 任务，
  打印最终解析命令数组与退出码（作为"解析产物"的实证归档）；
- 兜底分支（无法提取 js 入口）的具体文案模板由实施者依 §报错规格落定，
  回填本文档"实施备注"小节。

## 实施备注
（待实施者回填：实际提取逻辑要点 / 观测到的最终命令示例 / 失败文案定稿）
