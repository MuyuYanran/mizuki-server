/**
 * [重构/Wave-1] common/security/url-path — URL 路径逐段解码与走私拒绝
 * [职责] HTTP 层把请求路径切段并逐段 decodeURIComponent，拒绝一切可构成
 *   路径穿越/走私的形态（原 2 处重复：main.ts 的 /site-assets 守卫链、
 *   preview.service.ts 的 parseSegments）。
 * [状态] ACTIVE
 *
 * 为什么必须单源：这是**安全关键**逻辑的两份实现，且两侧的加固已发生漂移——
 *   - /site-assets：空段 → 拒绝（尾斜杠即 404）；不检查点开头段；
 *   - /preview   ：空段 → 跳过（尾斜杠归一）；额外拒绝点开头段（隐藏文件禁）。
 * 漂移本身是有意的业务差异，但「同一函数两处手写」意味着今后任一侧新增
 * 加固（%c0%af 超长编码、Unicode 归一化等价形、Windows 保留名）都不会自动
 * 传导到另一侧。故统一实现 + 差异显式参数化。
 *
 * 拒绝面（两侧共有的硬约束，不可放宽）：
 *   - decodeURIComponent 抛错（非法百分号序列）→ 拒绝；
 *   - 解码后为 '' / '.' / '..' → 拒绝；
 *   - 解码后含 '/'、'\'、'\0'（%2f、%5c、%00 走私多段与截断）→ 拒绝。
 */
import type { Request } from 'express';

export interface DecodePathOptions {
  /** 空段处置：'reject'（/site-assets 口径，尾斜杠即拒绝）| 'skip'（/preview 口径，归一）；默认 'reject' */
  empty?: 'reject' | 'skip';
  /** 拒绝以 '.' 开头的段（隐藏文件/目录禁；/preview 启用，/site-assets 不启用） */
  rejectHidden?: boolean;
}

/**
 * 路径 → 段数组；任一形态可疑 → null（调用方一律映射 404，隐藏存在性差异）。
 * @param rawPath 不含查询串的路径（express req.path / req.baseUrl+req.path 派生）
 */
export function decodePathSegments(rawPath: string, options: DecodePathOptions = {}): string[] | null {
  const emptyMode = options.empty ?? 'reject';
  const segments: string[] = [];
  for (const raw of rawPath.split('/')) {
    if (raw === '') {
      if (emptyMode === 'skip') {
        continue; // 前导/尾随/重复斜杠归一（/preview 口径）
      }
      return null; // /site-assets 口径：空段即拒绝
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null; // 非法百分号编码序列
    }
    if (isRejectedSegment(decoded) || (options.rejectHidden === true && decoded.startsWith('.'))) {
      return null;
    }
    segments.push(decoded);
  }
  return segments;
}

/** 单段拒绝判定（穿越/走私的最小子集；两侧共有，禁放宽） */
export function isRejectedSegment(decoded: string): boolean {
  return (
    decoded === '' ||
    decoded === '.' ||
    decoded === '..' ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0')
  );
}

/** 便捷入口：直接取 req.path（Express 已剥查询串） */
export function decodeRequestPath(req: Request, options?: DecodePathOptions): string[] | null {
  return decodePathSegments(req.path, options);
}
