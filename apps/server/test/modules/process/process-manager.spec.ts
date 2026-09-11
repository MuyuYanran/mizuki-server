import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSpawnOptions,
  childEnv,
  detectPackageManager,
  StartTaskBodySchema,
  TASK_WHITELIST,
  taskArgs,
} from '../../../src/modules/process/process-manager.service';

/**
 * P9 §6.7 安全断言（代码级）+ §3.1 白名单/参数映射：
 * shell 恒为 false、env 仅 PATH/HOME/APPDATA、命令参数逐字固定、
 * 白名单外（含注入串）一律拒绝。
 */

describe('P9 ProcessManagerService 纯工具（安全断言）', () => {
  it('§6.7 spawn 选项：shell 恒为 false（命令注入根防线）', () => {
    const options = buildSpawnOptions('some-cwd');
    expect(options.shell).toBe(false);
    expect(options.cwd).toBe('some-cwd');
    // detached：POSIX true / Windows false（平台行为取舍记报告）
    expect(options.detached).toBe(process.platform !== 'win32');
  });

  it('§6.7 env 白名单：仅透传 PATH / HOME / APPDATA（+ 恒定注入 CI，见下例）', () => {
    process.env['MIZUKI_P9_LEAK_TEST'] = 'should-not-pass-through';
    try {
      const env = childEnv();
      const allowed = new Set(['PATH', 'HOME', 'APPDATA', 'CI']);
      for (const key of Object.keys(env)) {
        expect(allowed.has(key)).toBe(true);
      }
      expect(env['MIZUKI_P9_LEAK_TEST']).toBeUndefined();
      expect(typeof env['PATH']).toBe('string');
    } finally {
      delete process.env['MIZUKI_P9_LEAK_TEST'];
    }
  });

  it('[Phase4-D4/配套1] CI=true 为恒定注入字面量，不取宿主 env（泄漏边界不破）', () => {
    const prevCI = process.env['CI'];
    process.env['CI'] = 'false'; // 宿主声称非 CI
    process.env['MIZUKI_P9_CI_LEAK_TEST'] = 'should-not-pass-through';
    try {
      const env = childEnv();
      expect(env['CI']).toBe('true'); // 恒写常量，不被宿主 env 覆盖
      expect(env['MIZUKI_P9_CI_LEAK_TEST']).toBeUndefined();
    } finally {
      if (prevCI === undefined) {
        delete process.env['CI'];
      } else {
        process.env['CI'] = prevCI;
      }
      delete process.env['MIZUKI_P9_CI_LEAK_TEST'];
    }
  });

  it('§3.1 任务白名单恰为四项', () => {
    expect([...TASK_WHITELIST]).toEqual(['install', 'dev', 'build', 'preview']);
  });

  it('§3.1 白名单拒绝：注入串与任意未知任务 → zod 校验失败（400 语义）', () => {
    for (const evil of ['install;rm -rf /', 'shell', 'arbitrary', 'dev && echo pwned', '', 'INSTALL']) {
      expect(StartTaskBodySchema.safeParse({ task: evil }).success).toBe(false);
    }
    for (const ok of TASK_WHITELIST) {
      expect(StartTaskBodySchema.safeParse({ task: ok }).success).toBe(true);
    }
  });

  it('§3.1 参数映射：逐字固定（install：yarn 无参；其余 run <task>）', () => {
    expect(taskArgs('install', 'npm')).toEqual(['install']);
    expect(taskArgs('install', 'pnpm')).toEqual(['install']);
    expect(taskArgs('install', 'yarn')).toEqual([]);
    expect(taskArgs('dev', 'npm')).toEqual(['run', 'dev']);
    expect(taskArgs('build', 'pnpm')).toEqual(['run', 'build']);
    expect(taskArgs('preview', 'yarn')).toEqual(['run', 'preview']);
  });

  it('包管理器探测：按 lockfile（pnpm/yarn/npm，均无默认 npm）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-pm-'));
    try {
      expect(detectPackageManager(tmp)).toBe('npm');
      fs.writeFileSync(path.join(tmp, 'package-lock.json'), '{}');
      expect(detectPackageManager(tmp)).toBe('npm');
      fs.writeFileSync(path.join(tmp, 'yarn.lock'), '');
      expect(detectPackageManager(tmp)).toBe('yarn'); // yarn 优先于 package-lock
      fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(tmp)).toBe('pnpm'); // pnpm 最优先
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
