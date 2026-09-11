/**
 * [Phase4-D3] 导航受控子集 schema（#8，C7 机制扩展至对象数组域，ADR-020 追加节）
 * [字段面] T1.1 实测主题类型（Mizuki src/types/config.ts NavBarLink）：
 *   name/url 必填，icon（iconify 字符串字面量，非组件引用 → 纳入受控子集）、
 *   external（布尔）、children（嵌套数组）可选。全量覆盖语义下 external/children
 *   不纳入 = 静默丢字段 → 一并纳入；children 封顶 1 层（官方示例层级，更深层
 *   400 拒绝禁静默丢弃，记 ADR-020 已知限制）。
 * [值域] url scheme 白名单（T1.1 官方示例集）：http/https 外链、/ 站内相对路径、
 *   # 锚点占位（官方示例 Others 项实测在用）；mailto 官方示例无 → 不纳入；
 *   javascript:/data:/vbscript: 等白名单外任何 scheme 拒绝。长度上限 name 64 /
 *   url 512 / icon 128；控制字符（U+0000-U+001F）一律拒绝。
 * [状态] ACTIVE
 */
import { z } from 'zod';

/** 控制字符拒绝（U+0000-U+001F；nav 各字符串字段共用） */
const NO_CONTROL_CHARS = /^[^\u0000-\u001F]*$/;

/** url scheme 白名单 + 非空 + 无控制字符（\S 内嵌拒绝空格/制表/换行） */
const URL_PATTERN = /^(?:https?:\/\/\S+|\/\S*|#)$/;

/** 子导航项（children 元素；不再允许嵌套 children——1 层封顶） */
export const NavChildItemSchema = z
  .object({
    name: z.string().min(1).max(64).regex(NO_CONTROL_CHARS),
    url: z.string().min(1).max(512).regex(NO_CONTROL_CHARS).regex(URL_PATTERN),
    icon: z.string().min(1).max(128).regex(NO_CONTROL_CHARS).optional(),
    external: z.boolean().optional(),
  })
  .strict();

/** 顶层导航项（children 可选，元素为 NavChildItemSchema） */
export const NavItemSchema = z
  .object({
    name: z.string().min(1).max(64).regex(NO_CONTROL_CHARS),
    url: z.string().min(1).max(512).regex(NO_CONTROL_CHARS).regex(URL_PATTERN),
    icon: z.string().min(1).max(128).regex(NO_CONTROL_CHARS).optional(),
    external: z.boolean().optional(),
    children: z.array(NavChildItemSchema).optional(),
  })
  .strict();

/** navBarConfig 受控形态（物化置换的声明初始化器结构） */
export const NavConfigSchema = z.object({ links: z.array(NavItemSchema) }).strict();

/**
 * PUT /admin/config/nav 请求体。
 * 四格语义（T5）：links 键缺失/undefined → 清除 override（config.ts 还原留档
 * 原文本）；links: [] → 合法 = 清空导航（破坏性语义，面板二次确认）；
 * 非法（越界键/缺 name/url/类型错/坏 scheme/超长/控制字符/越层 children）→ 400；
 * 合法 → 物化 config.ts + 侧车留档。
 */
export const PutNavBodySchema = z.object({ links: z.array(NavItemSchema).optional() }).strict();

export type NavChildItemValue = z.infer<typeof NavChildItemSchema>;
export type NavItemValue = z.infer<typeof NavItemSchema>;
export type NavConfigValue = z.infer<typeof NavConfigSchema>;
