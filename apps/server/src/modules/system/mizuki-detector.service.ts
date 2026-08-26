/**
 * [阶段 P6] modules/system/mizuki-detector.service — Mizuki 项目检测
 * [职责] MASTER-PLAN §4.3 逐字：给定路径 P，判定为 Mizuki 项目需同时满足
 *   1. P/package.json 存在且 dependencies/devDependencies 含 astro；
 *   2. P/astro.config.{mjs,ts,js} 存在；
 *   3. P/src/data/ 存在且至少含 diary.ts / friends.ts 之一；
 *   4. P/src/content/posts/ 存在。
 *   返回 { valid, checks（每项明细）, packageManager（lockfile 探测） }。
 * [状态] ACTIVE
 *
 * 包管理器探测：pnpm-lock.yaml → pnpm；yarn.lock → yarn；
 * package-lock.json → npm；均无 → 默认 npm 并在 checks 中注明。
 * 注意：检测仅做存在性判断与读取 package.json（初始化前无可用路径监狱，
 * 本地管理场景，见交付报告安全说明）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';

/** 单项检查明细 */
export interface DetectCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/** 检测结果 */
export interface DetectResult {
  valid: boolean;
  checks: DetectCheck[];
  packageManager: 'pnpm' | 'yarn' | 'npm';
}

@Injectable()
export class MizukiDetectorService {
  detect(candidatePath: string): DetectResult {
    const root = path.resolve(candidatePath);
    const checks: DetectCheck[] = [
      this.checkPackageJson(root),
      this.checkAstroConfig(root),
      this.checkDataDir(root),
      this.checkPostsDir(root),
    ];
    const { packageManager, note } = detectPackageManager(root);
    checks.push({
      name: 'packageManager',
      passed: true,
      detail: note,
    });
    const valid = checks.slice(0, 4).every((check) => check.passed);
    return { valid, checks, packageManager };
  }

  /** 检查 1：package.json 存在且 dependencies/devDependencies 含 astro */
  private checkPackageJson(root: string): DetectCheck {
    const file = path.join(root, 'package.json');
    if (!fs.existsSync(file)) {
      return { name: 'packageJson', passed: false, detail: 'package.json 不存在' };
    }
    let parsed: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof parsed;
    } catch {
      return { name: 'packageJson', passed: false, detail: 'package.json 解析失败' };
    }
    const hasAstro =
      typeof parsed.dependencies?.['astro'] === 'string' ||
      typeof parsed.devDependencies?.['astro'] === 'string';
    return {
      name: 'packageJson',
      passed: hasAstro,
      detail: hasAstro ? 'astro 依赖存在' : 'dependencies/devDependencies 未找到 astro',
    };
  }

  /** 检查 2：astro.config.{mjs,ts,js} 存在 */
  private checkAstroConfig(root: string): DetectCheck {
    for (const ext of ['mjs', 'ts', 'js']) {
      if (fs.existsSync(path.join(root, `astro.config.${ext}`))) {
        return { name: 'astroConfig', passed: true, detail: `astro.config.${ext} 存在` };
      }
    }
    return { name: 'astroConfig', passed: false, detail: 'astro.config.{mjs,ts,js} 均不存在' };
  }

  /** 检查 3：src/data 存在且至少含 diary.ts / friends.ts 之一 */
  private checkDataDir(root: string): DetectCheck {
    const dataDir = path.join(root, 'src', 'data');
    if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
      return { name: 'dataDir', passed: false, detail: 'src/data/ 不存在' };
    }
    const has = ['diary.ts', 'friends.ts'].some((name) => fs.existsSync(path.join(dataDir, name)));
    return {
      name: 'dataDir',
      passed: has,
      detail: has ? 'src/data/ 含 diary.ts / friends.ts 至少其一' : 'src/data/ 缺少 diary.ts 与 friends.ts',
    };
  }

  /** 检查 4：src/content/posts 存在 */
  private checkPostsDir(root: string): DetectCheck {
    const postsDir = path.join(root, 'src', 'content', 'posts');
    const passed = fs.existsSync(postsDir) && fs.statSync(postsDir).isDirectory();
    return {
      name: 'postsDir',
      passed,
      detail: passed ? 'src/content/posts/ 存在' : 'src/content/posts/ 不存在',
    };
  }
}

/** 包管理器探测（按 lockfile，MASTER-PLAN §4.3） */
function detectPackageManager(root: string): { packageManager: DetectResult['packageManager']; note: string } {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) {
    return { packageManager: 'pnpm', note: '探测到 pnpm-lock.yaml' };
  }
  if (fs.existsSync(path.join(root, 'yarn.lock'))) {
    return { packageManager: 'yarn', note: '探测到 yarn.lock' };
  }
  if (fs.existsSync(path.join(root, 'package-lock.json'))) {
    return { packageManager: 'npm', note: '探测到 package-lock.json' };
  }
  return { packageManager: 'npm', note: '未探测到 lockfile，默认 npm' };
}
