/**
 * [Phase3-C7] 语言代码口径（C5 posts lang 裁决的共享抽取）
 * [职责] posts frontmatter `lang` 与站点配置 `siteConfig.lang` 两处共用的
 *   校验口径——引用在库基线（C5），不重写终行：
 *   - trim 剪缘空白；
 *   - 空串归一为未设置（undefined，= 站点默认/未设置语义）；
 *   - BCP-47 简码字符集（字母数字分段 + 连字符连接）；
 *   - max(16)（'zh-Hant-TW' 等长组合可容，更长拒绝——有意取舍）；
 *   - 不做 enum 化（C2b 过度收窄教训）；
 *   - 内层 .optional() 承接空串归一出的 undefined；外层 .optional() 使缺键可选
 *     （缺键与空串同语义）。
 * [状态] ACTIVE
 */
import { z } from 'zod';

/** BCP-47 简码字符集：分段（字母数字）+ 连字符连接 */
export const LANG_CODE_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

/** 语言代码长度上限（有意取舍：'zh-Hant-TW' 等长组合可容，更长拒绝） */
export const LANG_CODE_MAX_LENGTH = 16;

/**
 * 语言代码字段终行（posts frontmatter lang 与 siteConfig.lang 共用；
 * C7 自 posts.service 内联终行上收共享，字段面与校验语义零变化）。
 */
export function langCodeSchema() {
  return z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().regex(LANG_CODE_PATTERN).max(LANG_CODE_MAX_LENGTH).optional())
    .optional();
}
