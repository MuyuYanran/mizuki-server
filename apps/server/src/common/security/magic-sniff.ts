/**
 * [阶段 P7] common/security/magic-sniff — 最小魔数嗅探器（纯函数）
 * [职责] 五格式图片魔数识别（人工定案：不引入 file-type，见 ADR-006；
 *   tiff 为 B4 规格对齐新增，官方相册支持格式见 docs/refs/mizuki-docs/
 *   special-gallery.md §支持的图片格式）：
 *   JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF…WEBP` /
 *   GIF `GIF87a|GIF89a` / TIFF `II*\0|MM\0*`（双端序）。
 *   上传管线第 2 步：嗅探结果必须与扩展名白名单映射一致；
 *   sharp 重编码对无法解码内容兜底拒绝。
 * [状态] ACTIVE
 *
 * [B4 审计注记] 官方支持 .bmp 与 .svg，但二者不进上传白名单：
 *   - bmp：sharp 0.35 预编译版无法解码（实测 `Input buffer contains
 *     unsupported image format`），重编码/解码兜底全链路不存在，白名单
 *     放行等于必 400 的死入口——终集处置转 B4 T4-3 裁决；
 *   - svg：可携带脚本，公开博客直接服务用户 SVG 存在 XSS 面——转 T4-3 裁决。
 */

/** 可识别的图片格式 */
export type MagicFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff';

/** 扩展名（含点，小写）→ 魔数格式映射（即上传白名单本身） */
export const EXTENSION_FORMAT: Record<string, MagicFormat> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
  '.tif': 'tiff',
  '.tiff': 'tiff',
};

/**
 * 嗅探缓冲区真实图片类型；不是已知格式之一 → undefined。
 * 纯函数：不抛错、不做解码（解码兜底由 sharp 完成）。
 */
export function sniffImageFormat(buffer: Buffer): MagicFormat | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') {
      return 'gif';
    }
  }
  // TIFF 双端序：小端 `II*\0`（49 49 2A 00）/ 大端 `MM\0*`（4D 4D 00 2A）
  if (buffer.length >= 4) {
    const littleEndian =
      buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
    const bigEndian =
      buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
    if (littleEndian || bigEndian) {
      return 'tiff';
    }
  }
  return undefined;
}
