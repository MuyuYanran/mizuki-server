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
  image: z.string().optional(),
  specs: z.string().optional(),
  description: z.string().optional(),
  link: z.string().optional(),
});

/** devices 整体结构：分类 → 设备数组 */
export const DeviceGroupedSchema = z.record(z.string(), z.array(DeviceItemSchema));

export type DeviceItem = z.infer<typeof DeviceItemSchema>;
export type DeviceGrouped = z.infer<typeof DeviceGroupedSchema>;
