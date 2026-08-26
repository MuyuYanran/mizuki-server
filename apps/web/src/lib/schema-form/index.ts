/**
 * [P10b] schema-form 模块出口
 * - mapper：zod schema → 字段描述符 + 浏览器端校验 + 空值初值
 * - SchemaForm.vue：由描述符渲染 Element Plus 表单的通用组件
 */
export { describeSchema, validateBySchema, emptyValueFromSchema, type FieldDescriptor, type WidgetKind } from './mapper';
export { default as SchemaForm } from './SchemaForm.vue';
