/**
 * [Phase3-C7] 语言代码口径（C5 posts lang 裁决的共享抽取）
 * [Phase3-F] 拆分双 schema（C7 疑问① 收官落地）：
 *   - langCodeSchema()：posts 域（frontmatter lang），BCP-47 连字符口径——引用点
 *     语义冻结零变化；
 *   - siteLangSchema()：config 域（siteConfig.lang），分隔符 [-_] 双兼容——
 *     主题约定取下划线形（`SITE_LANG = "zh_CN"`，主题注释示例 'en'/'zh_CN'/'ja'），
 *     C7 时点连字符口径在面板拒绝该形；纯数字段、大小写并存（'EN'/'en'）属
 *     有意宽松（历史值兼容优先）。
 *   五要素与 C5 终行全同构（trim / 空串归一未设置 / 字符集 regex / max(16) /
 *   不 enum 化 + 外层 optional 缺键可选），仅字符集口径不同。
 * [状态] ACTIVE
 */
import { z } from 'zod';

/** BCP-47 简码字符集（posts 域）：分段（字母数字）+ 连字符连接 */
export const LANG_CODE_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

/** 站点语言字符集（config 域）：分隔符 [-_] 双兼容（下划线形 zh_CN + 连字符形 zh-Hans） */
export const SITE_LANG_PATTERN = /^[A-Za-z0-9]+([-_][A-Za-z0-9]+)*$/;

/** 语言代码长度上限（有意取舍：'zh-Hant-TW' 等长组合可容，更长拒绝） */
export const LANG_CODE_MAX_LENGTH = 16;

/**
 * 语言代码字段终行（posts frontmatter lang 专用；C5 裁决口径，F 拆分后连字符
 * 口径在此锚定——引用点语义零变化）。
 */
export function langCodeSchema() {
  return z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().regex(LANG_CODE_PATTERN).max(LANG_CODE_MAX_LENGTH).optional())
    .optional();
}

/**
 * 站点语言字段终行（siteConfig.lang 专用；config 域 [-_] 双兼容，C7 疑问① 收官落地）。
 * 四格语义：键缺失 / 空串 → 归一未设置（不落键）；非法（内嵌空白/超长）→ 400；
 * 合法（'en' / 'zh_CN' / 'zh-Hans' / 'EN' / ' en ' 剪缘归一）→ 通过。
 */
export function siteLangSchema() {
  return z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().regex(SITE_LANG_PATTERN).max(LANG_CODE_MAX_LENGTH).optional())
    .optional();
}
