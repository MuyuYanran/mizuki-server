/**
 * [重构/Wave-1] common/crypto/hash — 全项目唯一哈希入口
 * [职责] sha256 计算的单源实现（原 5 处重复：data-files 写管线陈旧检测、
 *   posts 文章 fileHash、backup manifest 完整性校验、theme 指纹与 digest、
 *   media 上传 sha256）：消除「同一算法多份实现」的漂移面。
 * [状态] ACTIVE
 *
 * 区分文本与文件两个入口：文本恒按 UTF-8 编码（与既有 4 处逐字一致），
 * 文件按原始字节读取（与 backup/theme/media 既有实现逐字一致）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

/** 文本 sha256（hex，UTF-8 编码） */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 文件内容 sha256（hex，原始字节） */
export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** 任意 Buffer sha256（hex；media 上传自持 buffer 时使用，免二次落盘） */
export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
