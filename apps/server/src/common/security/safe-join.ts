/**
 * [阶段 P1] common/security/safe-join
 * [职责] 路径监狱：resolve + 前缀校验 + realpath 防符号链接逃逸。
 *   本模块是全项目唯一合法路径入口——后续所有模块读写文件必须经过本函数
 *   （MASTER-PLAN §9 守则 4）。
 * [状态] ACTIVE
 *
 * 函数族：
 *   - safeJoin(root, untrusted)：纯字符串层校验（resolve + 前缀），越界抛 ForbiddenPathError；
 *   - safeRealJoin(root, untrusted)：safeJoin 之上对「已存在祖先链」做 realpath 校验，
 *     防止 root 内的符号链接把路径引到 root 之外（MASTER-PLAN §7）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 路径越界错误：untrusted 试图逃出 root 之外（含空字节 / URL 编码 / 反斜杠等变体） */
export class ForbiddenPathError extends Error {
  constructor(untrusted: string) {
    super(`路径越界，已拒绝：${JSON.stringify(untrusted)}`);
    this.name = 'ForbiddenPathError';
  }
}

/** 对候选串做 resolve + 前缀校验（p === root 或 p 以 root + 分隔符 开头），越界即抛错 */
function assertWithin(root: string, candidate: string): string {
  const p = path.resolve(root, candidate);
  if (p !== root && !p.startsWith(root + path.sep)) {
    throw new ForbiddenPathError(candidate);
  }
  return p;
}

/**
 * 路径监狱入口（MASTER-PLAN §7 逐字规格 + 入口加固）：
 * 1. 空字节在 Windows 路径中本身非法，入口直接拒绝；
 * 2. path.resolve 归一化后做前缀校验（主防线）；
 * 3. 防御性复查（不改变返回值，仅扩大拒绝面）：
 *    - URL 编码：'%2e%2e%2f' 等解码一次后若越界同样拒绝；
 *    - 反斜杠：Windows 风格分隔符翻转后再查（即使运行在 POSIX，
 *      客户端仍可能提交 Windows 风格路径）。
 */
export function safeJoin(root: string, untrusted: string): string {
  if (untrusted.includes('\0')) {
    throw new ForbiddenPathError(untrusted);
  }
  const normalizedRoot = path.resolve(root);
  const p = assertWithin(normalizedRoot, untrusted);

  const variants: string[] = [];
  const pushVariants = (candidate: string): void => {
    variants.push(candidate);
    if (candidate.includes('\\')) {
      variants.push(candidate.replace(/\\/g, '/'));
    }
  };
  if (untrusted.includes('%')) {
    try {
      const decoded = decodeURIComponent(untrusted);
      if (decoded !== untrusted) {
        pushVariants(decoded);
      }
    } catch {
      // 非法百分号编码序列（如 '%zz'）：原始串已通过主防线，跳过解码复查
    }
  }
  if (untrusted.includes('\\')) {
    pushVariants(untrusted);
  }
  for (const variant of variants) {
    assertWithin(normalizedRoot, variant);
  }
  return p;
}

/**
 * safeJoin + 已存在祖先链的 realpath 校验（防符号链接逃逸）。
 *
 * 策略：自下而上找到 target 的最深层已存在祖先（含 target 自身），
 * 对其 realpath 后要求仍位于 root 的 realpath 之内。realpath 会解析
 * 祖先链上的全部符号链接，因此链上任一环节指向外部都会被捕获；
 * 不存在的部分无法构成逃逸（字符串级穿越已被 safeJoin 消除）。
 * root 内部互指的符号链接（realpath 仍在 root 内）放行。
 */
export function safeRealJoin(root: string, untrusted: string): string {
  const normalizedRoot = path.resolve(root);
  const target = safeJoin(normalizedRoot, untrusted);
  if (!fs.existsSync(normalizedRoot)) {
    throw new Error(`safeRealJoin: root 不存在：${normalizedRoot}`);
  }
  const realRoot = fs.realpathSync(normalizedRoot);

  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe || parent.length < normalizedRoot.length) {
      // 理论不可达：target 在 root 内且 root 已存在
      throw new ForbiddenPathError(untrusted);
    }
    probe = parent;
  }
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new ForbiddenPathError(untrusted);
  }
  return target;
}
