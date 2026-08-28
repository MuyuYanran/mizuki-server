import { EXTENSION_FORMAT, sniffImageFormat } from '../../../src/common/security/magic-sniff';

/**
 * P7 §3.1 第 2 步依据：最小魔数嗅探器（四格式纯函数，ADR-006）。
 */

describe('common/security/magic-sniff（魔数嗅探）', () => {
  it('JPEG 魔数 FF D8 FF 识别', () => {
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('jpeg');
  });

  it('PNG 魔数 89 50 4E 47 识别', () => {
    expect(sniffImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('png');
  });

  it('WebP 魔数 RIFF…WEBP 识别', () => {
    const buffer = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
    expect(sniffImageFormat(buffer)).toBe('webp');
  });

  it('GIF 魔数 GIF87a / GIF89a 识别', () => {
    expect(sniffImageFormat(Buffer.from('GIF87a..'))).toBe('gif');
    expect(sniffImageFormat(Buffer.from('GIF89a..'))).toBe('gif');
  });

  it('TIFF 魔数双端序识别（小端 II*\\0 / 大端 MM\\0*）[B4 新增，能力层签名保留]', () => {
    // 小端：II*\0（49 49 2A 00）
    expect(sniffImageFormat(Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]))).toBe('tiff');
    // 大端：MM\0*（4D 4D 00 2A）
    expect(sniffImageFormat(Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08]))).toBe('tiff');
  });

  it('AVIF 魔数识别（ISOBMFF ftyp box 主品牌 avif）[B2 裁决 3 新增]', () => {
    const avif = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypavif'),
      Buffer.alloc(16),
    ]);
    expect(sniffImageFormat(avif)).toBe('avif');
    // 非 avif 主品牌（如 isom）不误判
    const isom = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(16),
    ]);
    expect(sniffImageFormat(isom)).toBeUndefined();
  });

  it('TIFF 近似魔数被拒（字节次序或终值不符）[B4 反例]', () => {
    // 小端缺终值 0x00（3 字节过短不算，凑满 4 字节但终字节非 0）
    expect(sniffImageFormat(Buffer.from([0x49, 0x49, 0x2a, 0x01]))).toBeUndefined();
    // 大端终字节非 0x2A
    expect(sniffImageFormat(Buffer.from([0x4d, 0x4d, 0x00, 0x00]))).toBeUndefined();
    // 4 字节过短边界
    expect(sniffImageFormat(Buffer.from([0x49, 0x49, 0x2a]))).toBeUndefined();
  });

  it('非图片内容（文本/过短）返回 undefined', () => {
    expect(sniffImageFormat(Buffer.from('这其实是一个文本文件'))).toBeUndefined();
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8]))).toBeUndefined();
    expect(sniffImageFormat(Buffer.alloc(0))).toBeUndefined();
  });

  it('扩展名映射覆盖白名单终集扩展名（.jpg/.jpeg 同归 jpeg；.avif 归 avif）[B2 裁决 3]', () => {
    expect(EXTENSION_FORMAT['.jpg']).toBe('jpeg');
    expect(EXTENSION_FORMAT['.jpeg']).toBe('jpeg');
    expect(EXTENSION_FORMAT['.png']).toBe('png');
    expect(EXTENSION_FORMAT['.webp']).toBe('webp');
    expect(EXTENSION_FORMAT['.gif']).toBe('gif');
    expect(EXTENSION_FORMAT['.avif']).toBe('avif');
    expect(EXTENSION_FORMAT['.txt']).toBeUndefined();
  });

  it('[B2 裁决 3] 白名单终集排除：bmp（sharp 无法解码）/ svg（XSS 面）/ tiff（能力层在、放行层排除）不在白名单', () => {
    expect(EXTENSION_FORMAT['.bmp']).toBeUndefined();
    expect(EXTENSION_FORMAT['.svg']).toBeUndefined();
    expect(EXTENSION_FORMAT['.tif']).toBeUndefined();
    expect(EXTENSION_FORMAT['.tiff']).toBeUndefined();
  });
});
