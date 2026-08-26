/**
 * [阶段 P0a] packages/shared 入口
 * [职责] 前后端共享类型与常量（事件目录、集合 schema、媒体引用契约）
 * [状态] ACTIVE
 */

export const MIZUKI_API_PREFIX = '/api/v1' as const;

// [P0b] 事件目录骨架（事件名常量 + payload zod schema）
export * from './events';

// [P4] 六类集合条目 schema（前后端共用字段规格，P10 表单驱动）
export * from './collections';

// [P7] 媒体引用贡献者契约（注册表机制纯类型，宿主在 server common/registry）
export * from './media-reference';
