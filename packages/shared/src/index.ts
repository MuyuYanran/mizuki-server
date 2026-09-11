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

// [Phase3-C7] 语言代码口径（C5 posts lang 裁决共享抽取，posts 与 siteConfig.lang 共用）
export * from './lang-code';

// [Phase3-C7] 站点配置受控子集 schema（override 批，ADR-020）
export * from './site-config';

// [Phase4-D3] 导航受控子集 schema（#8，C7 机制扩展至对象数组域，ADR-020 追加节）
export * from './nav-config';

// [Phase4-E3a] 主题档案 schema + Mizuki Tier 1 内置档案（theme-lock 机制，ADR-024）
export * from './theme-profile';
