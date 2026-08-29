/**
 * [阶段 P4] shared/collections/devices — devices 条目 schema（grouped 结构的值类型）
 * [Phase3-C2b/ADR-018] 官方字段面收敛：恰 5 字段全必填（name/image/specs/
 *   description/link），多余字段拒绝（.strict()）。devices 整体为
 *   `{ [分类名: string]: Device[] }` 分组对象（DeviceGroupedSchema），
 *   「自定义」等任意分类键名天然覆盖。
 * [状态] ACTIVE
 */
import { z } from 'zod';

export const DeviceItemSchema = z
  .object({
    /** 分组内唯一（grouped 类型的 idField） */
    name: z.string(),
    /** [R2-12] 图片类字段引导（SchemaForm 渲染为帮助文案） */
    image: z
      .string()
      .describe('本地图片填媒体库回传的相对路径（public/images/uploads/…），外链直接粘贴 URL'),
    specs: z.string(),
    description: z.string(),
    link: z.string(),
  })
  .strict();

/** devices 整体结构：分类 → 设备数组（任意键名分组，含「自定义」） */
export const DeviceGroupedSchema = z.record(z.string(), z.array(DeviceItemSchema));

export type DeviceItem = z.infer<typeof DeviceItemSchema>;
export type DeviceGrouped = z.infer<typeof DeviceGroupedSchema>;
