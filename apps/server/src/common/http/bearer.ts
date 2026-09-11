/**
 * [重构/Wave-1] common/http/bearer — Bearer Token 提取
 * [职责] 从 Authorization 头提取 access token 的单源实现（原 2 处重复：
 *   jwt-auth.guard.ts 私有函数、main.ts /site-assets 守卫链内联同正则）。
 * [状态] ACTIVE
 *
 * 正则 `/^Bearer\s+(.+)$/i` 与两侧逐字一致（大小写不敏感、至少一个分隔空白）；
 * 头值为数组时取首项（Express 多值头语义）。
 */
import type { Request } from 'express';

/** 从 Authorization 头值提取 Bearer token（格式不符 → undefined） */
export function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : undefined;
}

/** 便捷入口：直接从请求对象读取 */
export function extractRequestBearerToken(req: Request): string | undefined {
  return extractBearerToken(req.headers['authorization']);
}
