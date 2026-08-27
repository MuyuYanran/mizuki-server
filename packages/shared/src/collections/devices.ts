/**
 * [阶段 P4] shared/collections/devices — devices 条目 schema（grouped 结构的值类型）
 * [职责] 与 REQUIREMENTS §6.8 字段表逐字对齐（P10 表单与后端共用同一字段规格）。
 *   devices 整体为 `{ [分类名: string]: Device[] }` 分组对象（由
 *   DeviceGroupedSchema 描述），此处 itemSchema 描述单个设备。
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const DeviceItemSchema = z.object({
  /** 分组内唯一（grouped 类型的 idField） */
  name: z.string(),
  /** [R2-12] 图片类字段引导（SchemaForm 渲染为帮助文案） */
  image: z
    .string()
    .optional()
    .describe('本地图片填媒体库回传的相对路径（public/images/uploads/…），外链直接粘贴 URL'),
  specs: z.string().optional(),
  description: z.string().optional(),
  link: z.string().optional(),
});

/** devices 整体结构：分类 → 设备数组 */
export const DeviceGroupedSchema = z.record(z.string(), z.array(DeviceItemSchema));

export type DeviceItem = z.infer<typeof DeviceItemSchema>;
export type DeviceGrouped = z.infer<typeof DeviceGroupedSchema>;
