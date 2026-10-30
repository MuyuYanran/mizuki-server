/**
 * [阶段 P4] shared/collections/devices — devices 条目 schema（grouped 结构的值类型）
 * [Phase3-C2b/ADR-018] 官方字段面收敛：恰 5 字段全必填（name/image/specs/
 *   description/link），多余字段拒绝（.strict()）。devices 整体为
 *   `{ [分类名: string]: Device[] }` 分组对象（DeviceGroupedSchema），
 *   「自定义」等任意分类键名天然覆盖。
 * [T2/双主题] 追加 Shirone 档的扁平数组形状（ShironeDeviceItemSchema）——
 *   两档结构与身份字段都不同，见文件下半部的差异说明。
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

// ─────────────────────────────────────────────────────────────────────────────
// [T2] Shirone 档：devices 是**扁平数组**，条目字段面显著更宽
// ─────────────────────────────────────────────────────────────────────────────

/**
 * [T2/双主题] Shirone `src/data/devices.ts` 的条目形状。
 * 权威源：上游 `src/types/devicesConfig.ts:32` `interface DeviceItem`。
 *
 * 与 Mizuki 档的差异（**不得统一**，这是适配层分档的理由）：
 * - **结构**：上游顶层是 `DeviceItem[]`（`devices.ts:7` `export const devicesData: DeviceItem[] = [`），
 *   分类是条目字段 `category`；Mizuki 是 `{ [分类名]: Device[] }`（`DeviceGroupedSchema`）。
 * - **身份**：上游有**显式必填 `id: string`**（`devices.ts:8` 实测 `id: "macbook-pro-16"`，
 *   类型注释「稳定标识（URL 片段 / 测试选择器）」）；Mizuki 档的身份字段是 `name`，
 *   且全表恰 5 字段。⇒ 上游条目过不了 `DeviceItemSchema`，Mizuki 条目也过不了本 schema，
 *   两档各持一份是**唯一**不污染冻结面的做法。
 * - `.strict()` 与既有多数集合 schema 同口径：上游新增字段时**显式报错**（400 带 zod issues），
 *   而不是静默丢字段。
 */
export const ShironeDeviceStatusSchema = z.enum(['active', 'backup', 'archived', 'wishlist']);

/** 单个设备详细规格属性（键值对，用于展开详情；上游 `DeviceSpecItem`） */
export const ShironeDeviceSpecItemSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    value: z.string(),
  })
  .strict();

export const ShironeDeviceItemSchema = z
  .object({
    /** 稳定标识（URL 片段 / 测试选择器）——本档的 idField */
    id: z.string(),
    name: z.string(),
    /** 品牌/厂商（如 Apple, Sony） */
    brand: z.string(),
    /** 所属场景分类（对应配置 `DeviceCategory.key`） */
    category: z.string(),
    status: ShironeDeviceStatusSchema,
    /** 核心规格简述（卡片醒目位置） */
    specs: z.string(),
    description: z.string(),
    /** 可选独立开关；关闭后不参与渲染与计数 */
    enable: z.boolean().optional(),
    specDetails: z.array(ShironeDeviceSpecItemSchema).optional(),
    /** [R2-12] 图片类字段引导（SchemaForm 渲染为帮助文案） */
    image: z
      .string()
      .describe('本地图片填媒体库回传的相对路径（public/images/uploads/…），外链直接粘贴 URL')
      .optional(),
    /** 无图片时使用的 Iconify 图标 */
    icon: z.string().optional(),
    link: z.string().optional(),
    /** 主力/特别推荐标记 */
    featured: z.boolean().optional(),
    /** 购入或开始使用年份（自由格式，如 "2024"） */
    year: z.string().optional(),
  })
  .strict();

export type ShironeDeviceStatus = z.infer<typeof ShironeDeviceStatusSchema>;
export type ShironeDeviceSpecItem = z.infer<typeof ShironeDeviceSpecItemSchema>;
export type ShironeDeviceItem = z.infer<typeof ShironeDeviceItemSchema>;
