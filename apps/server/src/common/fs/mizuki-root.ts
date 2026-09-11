/**
 * [重构/Wave-1] common/fs/mizuki-root — mizukiRoot 解析与路径监狱包装
 * [职责] 「未配置 root → 明确报错」「相对路径 → root 内绝对路径」的单源实现
 *   （原 8 处重复：posts / articles / media / albums / data-files / backup /
 *   process / theme / site-config 各写一遍 try/catch + safeJoin + 异常映射）。
 * [状态] ACTIVE
 *
 * 为什么单源：路径监狱（safe-join）是全项目唯一合法路径入口，但「入口之前的
 * root 解析」此前被复制 8 遍。任何一处漏判「未配置」都会让后续 safeJoin 拿到
 * 空串 root 并以 process.cwd() 为基准——这是路径语义最危险的失败模式，必须
 * 只有一种写法。
 *
 * 差异参数化（逐字保留各模块既有措辞与异常类型，对外零变化）：
 *   - missing：未配置时抛 BadRequestException（默认）或 NotFoundException；
 *   - missingMessage：未配置时的错误文案（各模块措辞不同，默认取通用文案）；
 *   - forbidden：路径越界时抛 ForbiddenException（默认，REST 层 403）
 *     或 BadRequestException（process 模块的「根目录非法」口径）。
 */
import path from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ForbiddenPathError, safeJoin } from '../security/safe-join';

/** 通用「未配置」文案（多数模块逐字使用；个别模块传 missingMessage 覆盖） */
export const MIZUKI_ROOT_MISSING_MESSAGE = 'Mizuki 项目根目录未配置（请先完成初始化）';

export interface MizukiRootOptions {
  /** 未配置 root 时的异常类型（默认 'bad-request'） */
  missing?: 'bad-request' | 'not-found';
  /** 未配置 root 时的错误文案（默认 MIZUKI_ROOT_MISSING_MESSAGE） */
  missingMessage?: string;
  /** 路径越界时的异常类型（默认 'forbidden' → 403；'bad-request' → 400） */
  forbidden?: 'forbidden' | 'bad-request';
  /** 路径越界时的错误文案（默认「路径越界，已拒绝：<rel>」） */
  forbiddenMessage?: string;
}

/** root 未配置时抛错；已配置时返回 resolve 后的绝对路径 */
export function requireMizukiRoot(root: string, options: MizukiRootOptions = {}): string {
  if (root === '') {
    const message = options.missingMessage ?? MIZUKI_ROOT_MISSING_MESSAGE;
    if (options.missing === 'not-found') {
      throw new NotFoundException(message);
    }
    throw new BadRequestException(message);
  }
  return path.resolve(root);
}

/** root 内相对路径 → 绝对路径（root 未配置 / 路径越界均抛错） */
export function toMizukiAbs(root: string, rel: string, options: MizukiRootOptions = {}): string {
  let resolved: string;
  try {
    resolved = safeJoin(requireMizukiRoot(root, options), rel);
  } catch (error) {
    if (error instanceof ForbiddenPathError) {
      if (options.forbidden === 'bad-request') {
        throw new BadRequestException(options.forbiddenMessage ?? `路径越界，已拒绝：${rel}`);
      }
      throw new ForbiddenException(options.forbiddenMessage ?? `路径越界，已拒绝：${rel}`);
    }
    throw error; // root 未配置（BadRequest/NotFound）原样上抛
  }
  return resolved;
}

/**
 * 同 toMizukiAbs，但路径非法时返回 null 而不抛错。
 * 用于「收集现存文件、跳过非法条目」的扫描场景（backup 恢复前快照）。
 */
export function tryToMizukiAbs(root: string, rel: string, options: MizukiRootOptions = {}): string | null {
  try {
    return toMizukiAbs(root, rel, options);
  } catch {
    return null;
  }
}
