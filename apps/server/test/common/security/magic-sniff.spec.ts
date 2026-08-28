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

  it('TIFF 魔数双端序识别（小端 II*\\0 / 大端 MM\\0*）[B4 新增]', () => {
    // 小端：II*\0（49 49 2A 00）
    expect(sniffImageFormat(Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]))).toBe('tiff');
    // 大端：MM\0*（4D 4D 00 2A）
    expect(sniffImageFormat(Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08]))).toBe('tiff');
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

  it('扩展名映射覆盖白名单扩展名（.jpg/.jpeg 同归 jpeg；.tif/.tiff 同归 tiff）', () => {
    expect(EXTENSION_FORMAT['.jpg']).toBe('jpeg');
    expect(EXTENSION_FORMAT['.jpeg']).toBe('jpeg');
    expect(EXTENSION_FORMAT['.png']).toBe('png');
    expect(EXTENSION_FORMAT['.webp']).toBe('webp');
    expect(EXTENSION_FORMAT['.gif']).toBe('gif');
    expect(EXTENSION_FORMAT['.tif']).toBe('tiff');
    expect(EXTENSION_FORMAT['.tiff']).toBe('tiff');
    expect(EXTENSION_FORMAT['.txt']).toBeUndefined();
  });

  it('[B4 审计] 官方支持但明确不进上传面的格式：bmp（sharp 无法解码）与 svg（XSS 面）不在白名单', () => {
    expect(EXTENSION_FORMAT['.bmp']).toBeUndefined();
    expect(EXTENSION_FORMAT['.svg']).toBeUndefined();
    expect(EXTENSION_FORMAT['.avif']).toBeUndefined();
  });
});
