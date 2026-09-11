/**
 * [重构/Wave-1] common/http/json-error — 统一 JSON 错误响应体
 * [职责] Express 层（非 Nest 控制器）直出错误的单源格式：`{ code, message, detail }`，
 *   与 AllExceptionsFilter 的形状逐字一致（原 2 处重复：main.ts 的 /site-assets
 *   守卫链 respond401/respond404、preview.service.ts 的 respondJson）。
 * [状态] ACTIVE
 *
 * 适用场景：挂在 app.use 上的裸守卫链（不经 Nest 异常过滤器），需手工构造响应体。
 * 控制器内部一律 `throw new XxxException(...)`，不得直接调用本模块。
 */
import type { Response } from 'express';

/** 统一 JSON 错误体（detail 恒为 null，与过滤器成功路径形状对齐） */
export function respondJsonError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ code, message, detail: null });
}

/** 401（code 与 Nest UnauthorizedException 同名，前端按 code 分支时无需区分来源） */
export function respond401(res: Response, message: string): void {
  respondJsonError(res, 401, 'UnauthorizedException', message);
}

/** 404（code 与 Nest NotFoundException 同名） */
export function respond404(res: Response, message: string): void {
  respondJsonError(res, 404, 'NotFoundException', message);
}

/** 405（code 与 Nest MethodNotAllowedException 同名） */
export function respond405(res: Response, message: string): void {
  respondJsonError(res, 405, 'MethodNotAllowedException', message);
}
