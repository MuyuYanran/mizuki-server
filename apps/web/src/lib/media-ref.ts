/**
 * [Phase4-D2/ADR-022] 媒体引用形态中心（纯函数，无 Vue/网络依赖）
 * [职责] #3/#4 断点修复的口径唯一出口——内容字段与编辑器里引用图片一律用
 *   **站点 URL 形态**（`/images/...`），外链用原始 URL：
 *   - 主题消费链实证（Mizuki/src/components/features/diary/MomentCard.astro
 *     `src={image}` 原样渲染；diary 示例数据为 `/images/...` URL 形态）：
 *     既有 `public/images/uploads/...`（API 原始 path）作为 src 会被浏览器
 *     按 `http://站点/public/...` 请求 → 404，即「上传入媒体库但不引用」断点。
 *   - 外链 http(s) 原样（ADR-012 裁决语义；https 部署下 http 图混合内容
 *     拦截记 ADR-022 已知限制）。
 * [状态] ACTIVE
 */

/** 判定是否外链 URL（http/https 开头） */
export function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * 任意媒体引用输入 → 站点引用形态：
 * - http(s) URL 原样返回；
 * - `public/images/...`（API 原始 path 形态）剥 `public` 首段 → `/images/...`；
 * - `/images/...` 站点绝对路径原样；
 * - 其他相对段 → 补前导 `/`（如 `images/a.png` → `/images/a.png`）。
 */
export function toSiteReference(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim();
  if (isExternalUrl(trimmed)) {
    return trimmed;
  }
  const segments = trimmed
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '' && seg !== '.');
  if (segments[0] === 'public') {
    segments.shift();
  }
  return `/${segments.map((seg) => seg).join('/')}`;
}

/** 编辑器插入用 Markdown 图片引用（alt 为文件名去扩展名的场景由消费方先处理） */
export function markdownImageRef(url: string, alt = ''): string {
  return `![${alt}](${url})`;
}

/**
 * 追加一条图片引用（返回新数组，不改入参）。
 * [Phase4-D2 幂等语义定稿（T1.1）] 与媒体库上传一致——**每次成功引用都追加，
 * 不做去重**（服务端 sha256 仅记录不判定，同图重传产生新条目属既有契约，
 * 锚⑥固化）。
 */
export function appendImageRef(list: string[], url: string): string[] {
  return [...list, toSiteReference(url)];
}
