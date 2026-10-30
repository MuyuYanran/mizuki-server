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

// [U3-P3/K5] 任务白名单单源（从 L3 process 升格，供 L0 config 引用；模板再裁 B）
export * from './process-tasks';

// [U3-P4a/K1/K3] 任务级环境变量（config.json taskEnv 约束 + 掩码视图单源）
export * from './task-env';

// [U3-P4c/K5] Markdown 通用导入预览契约（只读端点响应 + 三道上限常量单源）
export * from './posts-import';

// [U4-AI1/K1] AI 接入契约（档案 / 代理三态 / 聊天请求 / SSE 事件名 / 限额单源）
export * from './ai';

// [T1] 主题适配层契约（mizuki / shirone 识别 + 能力画像；命名避让见文件头）
export * from './theme-adapter';

// [T3b-2b] 主题配置域写入契约（PUT /admin/config/domains/:domain 请求体信封，ADR-028 §17.6）
export * from './theme-config-write';

// [T4-1] posts frontmatter 两主题逐字段对照（转换摘要与面板提示的字段命运单源）
export * from './posts-frontmatter-compat';

// [T4-2] Shirone 主题 posts frontmatter schema（逐字转录上游 postsCollection.schema，28 字段）
export * from './posts-frontmatter-shirone';

// [T4-3] Shirone 写入口面 frontmatter schema + null 删键集（16 键；与构造面字段名恒等）
export * from './posts-frontmatter-shirone-write';

// [T5b-1] Shirone series / moments 内容集合：构造面 + 写入口面（两面制）+ 删键集
export * from './shirone-content-collections';
