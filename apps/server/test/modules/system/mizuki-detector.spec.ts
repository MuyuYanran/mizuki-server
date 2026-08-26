import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MizukiDetectorService, type DetectCheck } from '../../../src/modules/system/mizuki-detector.service';

/**
 * P6 §6.7 验收依据（detector 正反用例）：
 * 正——完整假项目四项检查全通过 + packageManager 与 lockfile 一致；
 * 反——分别缺 astro 依赖 / 缺 astro.config / 缺 src/data / 缺 posts。
 */

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/mizuki');

/** fixture 临时副本（每个用例独立，可自由破坏） */
function freshCopy(): { root: string; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-detect-'));
  const root = path.join(tmp, 'project');
  fs.cpSync(FIXTURE_DIR, root, { recursive: true });
  return { root, tmp };
}

function cleanup(tmp: string): void {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function checkByName(checks: DetectCheck[], name: string): DetectCheck {
  const found = checks.find((check) => check.name === name);
  if (!found) {
    throw new Error(`缺少检查项：${name}`);
  }
  return found;
}

describe('P6 MizukiDetectorService（MASTER-PLAN §4.3 四项检测）', () => {
  const detector = new MizukiDetectorService();

  it('正例：完整假项目 → valid + 四项检查通过 + pnpm lockfile 探测', () => {
    const { root, tmp } = freshCopy();
    try {
      fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
      const result = detector.detect(root);
      expect(result.valid).toBe(true);
      for (const name of ['packageJson', 'astroConfig', 'dataDir', 'postsDir']) {
        expect(checkByName(result.checks, name).passed).toBe(true);
      }
      expect(result.packageManager).toBe('pnpm');
      expect(checkByName(result.checks, 'packageManager').detail).toContain('pnpm');
    } finally {
      cleanup(tmp);
    }
  });

  it('正例：无 lockfile → 默认 npm 且在 checks 中注明', () => {
    const { root, tmp } = freshCopy();
    try {
      const result = detector.detect(root);
      expect(result.valid).toBe(true);
      expect(result.packageManager).toBe('npm');
      expect(checkByName(result.checks, 'packageManager').detail).toContain('默认');
    } finally {
      cleanup(tmp);
    }
  });

  it('正例：yarn.lock → yarn', () => {
    const { root, tmp } = freshCopy();
    try {
      fs.writeFileSync(path.join(root, 'yarn.lock'), '');
      expect(detector.detect(root).packageManager).toBe('yarn');
    } finally {
      cleanup(tmp);
    }
  });

  it('反例：package.json 无 astro 依赖 → valid:false 且 packageJson 检查失败', () => {
    const { root, tmp } = freshCopy();
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'no-astro', dependencies: {} }));
      const result = detector.detect(root);
      expect(result.valid).toBe(false);
      expect(checkByName(result.checks, 'packageJson').passed).toBe(false);
      // 其余项不受影响
      expect(checkByName(result.checks, 'astroConfig').passed).toBe(true);
    } finally {
      cleanup(tmp);
    }
  });

  it('反例：缺 astro.config → valid:false 且 astroConfig 检查失败', () => {
    const { root, tmp } = freshCopy();
    try {
      fs.rmSync(path.join(root, 'astro.config.mjs'));
      const result = detector.detect(root);
      expect(result.valid).toBe(false);
      expect(checkByName(result.checks, 'astroConfig').passed).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it('反例：缺 src/data → valid:false 且 dataDir 检查失败', () => {
    const { root, tmp } = freshCopy();
    try {
      fs.rmSync(path.join(root, 'src', 'data'), { recursive: true, force: true });
      const result = detector.detect(root);
      expect(result.valid).toBe(false);
      expect(checkByName(result.checks, 'dataDir').passed).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it('反例：缺 src/content/posts → valid:false 且 postsDir 检查失败', () => {
    const { root, tmp } = freshCopy();
    try {
      fs.rmSync(path.join(root, 'src', 'content', 'posts'), { recursive: true, force: true });
      const result = detector.detect(root);
      expect(result.valid).toBe(false);
      expect(checkByName(result.checks, 'postsDir').passed).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });
});
