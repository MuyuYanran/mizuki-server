/**
 * [Phase2-B1.5 / ADR-012] 站点资产统一拼源工具
 * [职责] 全前端唯一的图片 src 拼接出口：
 *  - http(s) 开头原样返回（外部相册 URL 项不经 /site-assets 通道，裁决原文）；
 *  - 其余输入视为 Mizuki 相对路径，规范化后拼 /site-assets/<相对段>：
 *      · 去首尾空白与多余斜杠 / 忽略空段与 '.'；
 *      · 允许 'public/images/uploads/x.jpg'（API 原始 path 形态）与
 *        '/images/uploads/x.jpg'（站点 URL 形态）两种入参——前者剥离
 *        'public' 首段；
 *      · 逐段 encodeURIComponent（相册名可含中文）。
 * [状态] ACTIVE
 *
 * 散拼字符串禁止（B1.5 规格 §3.3）：消费点一律 import 本函数。
 */
export function imageSrc(relOrUrl: string): string {
  if (/^https?:\/\//i.test(relOrUrl)) {
    return relOrUrl;
  }
  const segments = relOrUrl
    .trim()
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '' && seg !== '.');
  if (segments[0] === 'public') {
    segments.shift();
  }
  if (segments.length === 0) {
    return '/site-assets/';
  }
  return `/site-assets/${segments.map(encodeURIComponent).join('/')}`;
}

/**
 * [Phase2-B2/裁决 1] content-posts 相对路径预览改写（纯函数，无文件存在性检查）：
 * 把文件夹方案文章的相对路径图片引用改写为
 * `/site-assets/content-posts/<slug>/<解析后相对段>`（服务端 src/content/posts
 * 只读出口；目标不存在由服务端 404，破图即「图未就位」）。
 *
 * 改写规则（裁决原文两分支）：
 *  - 相对路径解析后仍落在 slug 目录内（含 ./ 与子目录 sub/x.png）→ 改写；
 *  - 解析后逃出 slug 目录（../ 逃逸）→ 返回 null 不改写（预览层保持纯函数，
 *    不做存在性检查，与 B3 站内图管线行为一致）；
 *  - 仅改预览展示层，不改用户源文件。
 *
 * 不改写（返回 null）的输入：
 *  - slug 为空串（新建未定名文章无基准目录）；
 *  - http(s) 外链（外链不经通道，ADR-012 语义）；
 *  - '/' 开头的站内绝对路径与 'public/' 首段的站内图形态（走 imageSrc 既有管线）。
 */
export function contentPostSrc(slug: string, raw: string): string | null {
  if (slug === '') {
    return null;
  }
  if (/^https?:\/\//i.test(raw)) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('/')) {
    return null;
  }
  const segments = trimmed
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '' && seg !== '.');
  if (segments.length === 0 || segments[0] === 'public') {
    return null;
  }
  // 解析 '..'：弹出上一段；在基准（slug 目录）之上再逃逸 → 不改写
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '..') {
      if (resolved.length === 0) {
        return null;
      }
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  if (resolved.length === 0) {
    return null;
  }
  return `/site-assets/content-posts/${encodeURIComponent(slug)}/${resolved.map(encodeURIComponent).join('/')}`;
}
