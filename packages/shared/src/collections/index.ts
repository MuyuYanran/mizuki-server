/**
 * [阶段 P4] shared/collections — 集合 zod schema 汇总导出
 * [Phase3-C2b] 七类内容（diary/friends/projects/timeline/skills/devices/anime）
 *   的条目 schema 汇总；服务端（P4 注册表/校验）与 Web 面板（P10b schema
 *   驱动表单）复用同一份字段规格。
 * [状态] ACTIVE
 *
 * 纪律：本目录只放 schema 与类型，禁止业务逻辑。
 */
export * from './diary';
export * from './friends';
export * from './projects';
export * from './timeline';
export * from './skills';
export * from './devices';
