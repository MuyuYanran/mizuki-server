import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PackageManagerResolver, pmEnvVarName } from '../../../src/modules/process/pm-resolver';
import { resolveProjectSpawnPlan } from '../../../src/modules/process/process-manager.service';

/**
 * C3 §T5 解析链单测（提示词编号 ①②③④⑤④'）：
 * 全程注入 pathEnv 指向 test/fixtures/pm-resolver/，不改测试进程真实 PATH；
 * 每用例新建 resolver 实例（记忆化双保险之一，另一保险是键含 pathEnv/映射活读）。
 * 平台分支：win 走 .cmd 垫片（垫片穿透，ADR-011 决策③），posix 走 sh 可执行脚本。
 */

const FIXTURE = path.resolve(__dirname, '../../fixtures/pm-resolver');
const isWin = process.platform === 'win32';
const PATH_SEP = isWin ? ';' : ':';

/** 各形态下的候选目录与显式路径 */
const goodDir = path.join(FIXTURE, isWin ? 'win/good' : 'posix/good');
const exit3Dir = path.join(FIXTURE, isWin ? 'win/exit3' : 'posix/exit3');
const danglingPath = isWin
  ? path.join(FIXTURE, 'win/dangling/pnpm.cmd')
  : path.join(FIXTURE, 'posix/exit3', 'pnpm');
const hangDir = path.join(FIXTURE, isWin ? 'win/hang' : 'posix/hang');
const goodCmd = path.join(goodDir, isWin ? 'pnpm.cmd' : 'pnpm');

/** posix 夹具依赖执行位，git 不保证携带：运行期补齐（win 无操作） */
function ensureExecBits(): void {
  if (isWin) {
    return;
  }
  for (const dir of [goodDir, exit3Dir, hangDir]) {
    fs.chmodSync(path.join(dir, 'pnpm'), 0o755);
  }
}

describe('C3 包管理器解析链（pm-resolver 单测）', () => {
  beforeAll(() => {
    ensureExecBits();
  });

  it('① 层①显式路径优先且成功（注入映射；探活与任务 spawn 同计划，垫片穿透为 node+入口）', async () => {
    const resolver = new PackageManagerResolver();
    const plan = await resolver.resolve('pnpm', { explicitPaths: { pnpm: goodCmd } });
    expect(plan.manager).toBe('pnpm');
    expect(plan.source).toBe('explicit-inject');
    if (isWin) {
      // 垫片穿透：最终执行体是 node 本体 + 入口 js（ADR-011 决策③）
      expect(plan.file).toBe(process.execPath);
      expect(plan.argsPrefix[0]).toMatch(/good-entry\.cjs$/);
    } else {
      expect(plan.file).toBe(goodCmd);
      expect(plan.argsPrefix).toEqual([]);
    }
  });

  it('①b 层① env 变体活读：resolver 建立后才设 env，resolve 期读取成功（P11 坑 5：不做启动快照）', async () => {
    const varName = pmEnvVarName('pnpm');
    const resolver = new PackageManagerResolver(); // 先建实例
    process.env[varName] = goodCmd; // 后设 env → 证明非启动快照
    try {
      const plan = await resolver.resolve('pnpm', {});
      expect(plan.source).toBe('explicit-env');
      expect(plan.manager).toBe('pnpm');
    } finally {
      delete process.env[varName];
    }
  });

  it('② 层①探活失败 → 快速失败（错误含配置指引，不落层②③④）', async () => {
    const resolver = new PackageManagerResolver();
    await expect(resolver.resolve('pnpm', { explicitPaths: { pnpm: danglingPath } })).rejects.toThrow(
      /MIZUKI_PM_PNPM_PATH/,
    );
    await expect(resolver.resolve('pnpm', { explicitPaths: { pnpm: danglingPath } })).rejects.toThrow(
      /不会自动降级/,
    );
    // 层①语义回归锚：快速失败文案 ≠ 层④的四层尝试摘要
    await expect(resolver.resolve('pnpm', { explicitPaths: { pnpm: danglingPath } })).rejects.not.toThrow(
      /四层尝试摘要/,
    );
  });

  it('③ 层③候选跳过：假 shim（非零退出）探活失败 → 下一候选成功', async () => {
    const resolver = new PackageManagerResolver();
    const plan = await resolver.resolve('pnpm', {
      pathEnv: `${exit3Dir}${PATH_SEP}${goodDir}`,
      projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-pmr-')), // 无 node_modules/.bin
    });
    expect(plan.manager).toBe('pnpm');
    expect(plan.source).toBe(isWin ? 'where' : 'which');
    if (isWin) {
      expect(plan.argsPrefix[0]).toMatch(/good-entry\.cjs$/);
    }
  });

  it('④ 层④全失败 → 报错含四层尝试摘要与配置指引', async () => {
    const resolver = new PackageManagerResolver();
    await expect(
      resolver.resolve('pnpm', {
        pathEnv: exit3Dir,
        projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-pmr-')),
      }),
    ).rejects.toThrow(/四层尝试摘要[\s\S]*退出码 3[\s\S]*MIZUKI_PM_PNPM_PATH/);
  });

  it("④' 探活超时跳过（假挂起脚本 + 缩短超时注入）→ 层④摘要含超时记录", async () => {
    const resolver = new PackageManagerResolver();
    await expect(
      resolver.resolve('pnpm', {
        pathEnv: hangDir,
        probeTimeoutMs: 300,
        projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-pmr-')),
      }),
    ).rejects.toThrow(/探活超时/);
  }, 10_000);

  it('⑤ 层②集成：夹具目录含 pnpm-lock.yaml → 解析链采用 pnpm（resolveProjectSpawnPlan 编排）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-pmr-lock-'));
    try {
      fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '');
      const resolver = new PackageManagerResolver();
      const plan = await resolveProjectSpawnPlan(tmp, resolver, { explicitPaths: { pnpm: goodCmd } });
      expect(plan.manager).toBe('pnpm');
      expect(plan.source).toBe('explicit-inject');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
