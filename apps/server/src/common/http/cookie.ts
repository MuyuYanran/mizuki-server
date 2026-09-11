/**
 * [重构/Wave-1] common/http/cookie — Cookie 头解析（零依赖）
 * [职责] 从 Cookie 请求头解析指定键值（原 2 处逐字重复：main.ts 的
 *   /site-assets 通道 cookie 兜底、preview.service.ts 的预览凭据 cookie）。
 * [状态] ACTIVE
 *
 * 语义（与原实现逐字一致，两条纪律不可改）：
 *   - 非法百分号编码（如 '%zz'）→ 返回 undefined，不抛错；
 *   - 仅认指定键名，其余 cookie 一律忽略（命名空间隔离：外来 cookie
 *     不产生任何行为差异）。
 */
import type { Request } from 'express';

/** 从 cookie 头解析指定键值（缺失/非法编码 → undefined） */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    if (part.slice(0, eq).trim() !== name) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** 便捷入口：直接从请求对象读取（Express 头值可能为数组） */
export function readRequestCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  return readCookie(Array.isArray(raw) ? raw[0] : raw, name);
}
