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

/** 任务白名单（逐字硬编码，MASTER-PLAN §7）；语义与迁格前零变化 */
export const TASK_WHITELIST = ['install', 'dev', 'build', 'preview'] as const;

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
