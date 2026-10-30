/**
 * [U3-P3/K5] shared/process-tasks — 任务白名单单源
 * [职责] 把「可执行的白名单任务」这一概念从 L3（modules/process）升格到 L0
 *   （packages/shared），使 L0 的 config 层能用 z.enum 引用它，而不必反向
 *   import L3（违反 eslint boundaries 分层红线，见 eslint.config.mjs）。
 * [状态] ACTIVE
 *
 * 背景（U3-P3 再裁 B）：
 *   R2-10 原规格要求「任务命令模板进 data/config.json，形态 tasks.{dev,build}.{cmd,args,shell}」，
 *   那是「配置文件驱动的通用命令执行器」，正面违反 AGENTS §5 硬红线
 *   （任务白名单硬编码 / shell 恒 false / 不接受用户传参）与 ADR-011 解析链架构。
 *   模板重定义为**白名单任务的命名快捷预设** `{name, task, description?}`：
 *   面板渲染按钮 → 点击走既有 startTask(task) 白名单链路，零新执行面。
 *
 * 纪律：本文件只放常量与类型，禁止业务逻辑（与 shared 其余文件同规）。
 */

/**
 * 任务白名单（逐字硬编码，MASTER-PLAN §7）：**任务名即 `package.json` 的脚本名**。
 *
 * [T3d] 末两项是内容同步（ADR-028 §17.6 / 裁定 Q6）：配置写入落在**内容仓**，必须有一条
 *   「让它物化到主题」的通道，否则面板会停在「写成功但永不生效」。
 *
 *   ⚠ **同一个概念，两档上游的脚本名完全不同**（上游 `package.json` 实测，非推断）：
 *     · Mizuki HEAD → `sync-content`（`node scripts/sync-content.js`）——**没有** `content:sync`
 *     · Shirone     → `content:sync`（`node scripts/content/sync.mjs`）
 *   ⇒ 两个名字都要在白名单里，由当前主题形态决定面板显示哪一个（形态判定在服务端能力画像，
 *     不在这里；本文件只放常量）。执行器保持「哑」：固定无参 + `shell:false` +
 *     不接受用户传参 —— 加白名单**不引入任何新的执行面**。
 *
 * [为什么不复制上游的 `|| true`] HEAD 的 `predev` / `prebuild` 写成
 *   `node scripts/sync-content.js || true` ⇒ **上游把 dev/build 前的同步失败静默吞掉**。
 *   本服务不继承该行为：白名单任务的退出码由子进程原样上报，同步失败在面板上必须看得见。
 */
export const TASK_WHITELIST = [
  'install',
  'dev',
  'build',
  'preview',
  'content:sync',
  'sync-content',
] as const;

/** 白名单任务名 */
export type ProcessTaskName = (typeof TASK_WHITELIST)[number];

/**
 * 任务模板（白名单任务命名预设）——config.json `tasks` 键的元素形态。
 * 严格对象：含 cmd/args/shell 等越界键 → 解析失败（config 既有失败语义）。
 */
export interface TaskTemplate {
  /** 按钮显示名（1–64 字符） */
  name: string;
  /** 绑定的白名单任务 */
  task: ProcessTaskName;
  /** 按钮说明（≤200 字符，可选） */
  description?: string;
}
