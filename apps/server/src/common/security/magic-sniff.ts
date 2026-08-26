/**
 * [阶段 P7] common/security/magic-sniff — 最小魔数嗅探器（纯函数）
 * [职责] 四格式图片魔数识别（人工定案：不引入 file-type，见 ADR-006）：
 *   JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF…WEBP` / GIF `GIF87a|GIF89a`。
 *   上传管线第 2 步：嗅探结果必须与扩展名白名单映射一致；
 *   sharp 重编码对无法解码内容兜底拒绝。
 * [状态] ACTIVE
 */

/** 可识别的图片格式 */
export type MagicFormat = 'jpeg' | 'png' | 'webp' | 'gif';

/** 扩展名（含点，小写）→ 魔数格式映射（即上传白名单本身） */
export const EXTENSION_FORMAT: Record<string, MagicFormat> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
};

/**
 * 嗅探缓冲区真实图片类型；不是四种已知格式之一 → undefined。
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
  return undefined;
}
