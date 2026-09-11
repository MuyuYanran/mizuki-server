/**
 * [重构/Wave-1] common/http/pagination — 分页参数解析（两种既有口径的显式归位）
 * [职责] 把此前分散在两处、语义不同的分页参数解析集中到单一文件，
 *   并**显式命名**两条口径，防止后来者把二者当作同一个工具互相替换。
 * [状态] ACTIVE
 *
 * 两条口径（对外契约不同，均不得改语义）：
 *   - 管理接口（clamp 口径，原 system.controller.clampInt）：非法值回落默认值，
 *     超限静默截断至上限。用于 /admin/system/logs 等管理面（limit 上限 100）。
 *   - 公开接口（strict 口径，原 articles.controller.parsePageParam/parseLimitParam）：
 *     非法值回落默认值，**超限抛 400**（limit 上限 50，P8 §3.4 明文规格）。
 * 统一语义会构成对外行为变更，故本模块只归位、不改语义。
 */
import { BadRequestException } from '@nestjs/common';

/** 解析结果：非整数或越下界 → 回落默认值（两条口径共用的保守起点） */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

/**
 * [clamp 口径] 管理接口分页参数：非整数回落默认值，超出 [min,max] 静默夹取。
 * @see system.controller GET /admin/system/logs（limit 上限 100，防御深分页）
 */
export function clampIntParam(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * [strict 口径] 公开接口 page 参数：非整数/越下界回落默认值（无上限）。
 * @see articles.controller GET /public/articles
 */
export function parseStrictPage(raw: string | undefined, fallback: number): number {
  return parsePositiveInt(raw, fallback);
}

/**
 * [strict 口径] 公开接口 limit 参数：非整数/越下界回落默认值；超过 max 抛 400。
 * @param max 公开面硬上限（P8 §3.4 定为 50）
 * @see articles.controller GET /public/articles
 */
export function parseStrictLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = parsePositiveInt(raw, fallback);
  if (parsed > max) {
    throw new BadRequestException(`limit 超出上限 ${max}`);
  }
  return parsed;
}
