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
