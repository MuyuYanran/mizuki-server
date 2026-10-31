/**
 * [T3] config-write-target 单测：全部在 mkdtemp 临时域内构造（仓规红线 9，绝不碰真实主题目录）。
 * 覆盖：三档可写落点 + 九条拒绝原因 + `message` 不泄绝对路径 + 调用后零写盘。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANIFEST_FILE } from '../../src/common/theme/content-source';
import { resolveConfigWriteTarget } from '../../src/common/theme/config-write-target';

const tmpRoots: string[] = [];
const ENV_KEYS = ['ENABLE_CONTENT_SYNC', 'CONTENT_DIR', 'CONTENT_REPO_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

/** 新建临时域 */
function makeRoot(prefix = 'mizuki-write-target-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 建一个空文件（含父目录） */
function touch(file: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, '', 'utf8');
}

function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** mizuki legacy（单文件 src/config.ts） */
function makeLegacy(): string {
  const root = makeRoot('legacy-');
  touch(path.join(root, 'src', 'config.ts'));
  return root;
}

/** mizuki HEAD（src/config/overrideLoader.ts） */
function makeMizukiHead(): string {
  const root = makeRoot('head-');
  touch(path.join(root, 'src', 'config', 'overrideLoader.ts'));
  return root;
}

/** shirone 源码形态（src/config/integrationsConfig.ts），可选清单 */
function makeShirone(manifest?: unknown): string {
  const root = makeRoot('shirone-');
  touch(path.join(root, 'src', 'config', 'integrationsConfig.ts'));
  if (manifest !== undefined) writeJson(path.join(root, MANIFEST_FILE), manifest);
  return root;
}

/** 临时域的全部相对条目（目录带尾斜杠），用于「零写盘」断言 */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
    }
  };
  walk(dir, '');
  return out.sort();
}

// 用例内的 env 必须自证清白：先清场（避免宿主真实 env 渗入），再在 afterEach 还原
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => {
  for (const dir of tmpRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveConfigWriteTarget — mizuki legacy', () => {
  it('单文件 src/config.ts ⇒ ts-morph 落点，不需要 sync', () => {
    const root = makeLegacy();
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.form).toBe('mizuki-legacy');
    expect(resolution.sink).toBe('mizuki-legacy-ts-morph');
    expect(resolution.dirAbs).toBe(path.join(root, 'src'));
    expect(resolution.needsSync).toBe(false);
  });
});

describe('resolveConfigWriteTarget — mizuki HEAD', () => {
  it('内容目录不存在 ⇒ mizuki-head-no-content-dir', () => {
    const root = makeMizukiHead();
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mizuki-head-no-content-dir');
    expect(resolution.invalidMounts).toEqual([]);
  });

  it('内容目录存在（无 overrides/）⇒ 可写，落点 <内容目录>/overrides，needsSync:true', () => {
    const root = makeMizukiHead();
    const contentDir = path.join(root, 'content');
    ensureDir(contentDir);
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.form).toBe('mizuki-head');
    expect(resolution.sink).toBe('mizuki-head-override');
    expect(resolution.dirAbs).toBe(path.join(contentDir, 'overrides'));
    expect(resolution.needsSync).toBe(true);
  });

  it('内容目录已有 overrides/ ⇒ 同样可写（写内容仓的那份，不会被 rmSync 删）', () => {
    const root = makeMizukiHead();
    const contentDir = path.join(root, 'content');
    ensureDir(path.join(contentDir, 'overrides'));
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.sink).toBe('mizuki-head-override');
    expect(resolution.dirAbs).toBe(path.join(contentDir, 'overrides'));
    expect(resolution.needsSync).toBe(true);
  });

  it('内容目录含 .git ⇒ mizuki-head-content-dir-is-git', () => {
    const root = makeMizukiHead();
    ensureDir(path.join(root, 'content', '.git'));
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mizuki-head-content-dir-is-git');
  });

  it('ENABLE_CONTENT_SYNC=false ⇒ mizuki-head-content-sync-disabled（且优先于内容目录判定）', () => {
    const root = makeMizukiHead();
    ensureDir(path.join(root, 'content', 'overrides'));
    process.env.ENABLE_CONTENT_SYNC = 'false';
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mizuki-head-content-sync-disabled');
  });

  it('CONTENT_DIR 覆盖内容目录：绝对值按上游口径**原样**使用；相对值按主题根解析', () => {
    const root = makeMizukiHead();
    const external = makeRoot('head-content-');
    ensureDir(external);

    // [订正] 上游把 CONTENT_DIR 原样用于 fs.existsSync / path.join(CONTENT_DIR, …)，
    // 全仓无二次 join(rootDir, CONTENT_DIR)（实测 grep -c = 0）⇒ 绝对路径原样生效。
    // 曾误实现为「一律 join(root, value)」，会把这里误判成「无内容目录」而拒绝。
    process.env.CONTENT_DIR = external;
    const absolute = resolveConfigWriteTarget(root);
    expect(absolute.ok).toBe(true);
    if (!absolute.ok) return;
    expect(absolute.dirAbs).toBe(path.join(external, 'overrides'));

    // 相对值：上游原样交给 Node（相对进程 CWD），pnpm 以主题根为 CWD ⇒ 等价 join(root, v)
    process.env.CONTENT_DIR = 'alt-content';
    ensureDir(path.join(root, 'alt-content'));
    const relative = resolveConfigWriteTarget(root);
    expect(relative.ok).toBe(true);
    if (!relative.ok) return;
    expect(relative.dirAbs).toBe(path.join(root, 'alt-content', 'overrides'));
  });
});

describe('resolveConfigWriteTarget — shirone', () => {
  it('source.type=git ⇒ content-source-git（工作副本每次 sync 被清）', () => {
    const root = makeShirone({
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/content.git', ref: 'main' },
    });
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('content-source-git');
  });

  it('source.type=path ⇒ 落点 <该目录>/config，needsSync:true', () => {
    const contentRepo = makeRoot('shirone-content-');
    const root = makeShirone({ schemaVersion: 1, source: { type: 'path', path: contentRepo } });
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.form).toBe('shirone');
    expect(resolution.sink).toBe('shirone-yaml');
    expect(resolution.dirAbs).toBe(path.join(contentRepo, 'config'));
    expect(resolution.needsSync).toBe(true);
  });

  it('无清单（local）⇒ shirone-local-mode', () => {
    const root = makeShirone();
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('shirone-local-mode');
  });

  it('schemaVersion:2 ⇒ manifest-unsupported-version', () => {
    const contentRepo = makeRoot('shirone-content-');
    const root = makeShirone({ schemaVersion: 2, source: { type: 'path', path: contentRepo } });
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('manifest-unsupported-version');
  });

  it('非法 mounts（保留目录）⇒ mounts-invalid，附相对键清单', () => {
    const contentRepo = makeRoot('shirone-content-');
    const root = makeShirone({
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
      mounts: { '.git': 'src/content' },
    });
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mounts-invalid');
    expect(resolution.invalidMounts).toEqual(['.git']);
  });

  it('交叉重叠 mounts ⇒ mounts-overlap（优先于 mounts-invalid 判定）', () => {
    const contentRepo = makeRoot('shirone-content-');
    const root = makeShirone({
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
      // 默认 content → src/content 仍生效，此目标落在它下面 ⇒ 目标目录交叉重叠
      mounts: { extra: 'src/content/deep' },
    });
    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mounts-overlap');
    expect(resolution.invalidMounts.length).toBeGreaterThan(0);
  });
});

describe('resolveConfigWriteTarget — mizuki HEAD 的 .env 口径（上游 load-env.js）', () => {
  /** 写一个 `<主题根>/.env` */
  function writeEnv(root: string, body: string): void {
    fs.writeFileSync(path.join(root, '.env'), body, 'utf8');
  }

  it('.env 里的 CONTENT_DIR 压过进程环境变量（上游无条件赋值 ⇒ 文件优先）', () => {
    const root = makeMizukiHead();
    ensureDir(path.join(root, 'env-content'));
    ensureDir(path.join(root, 'process-content'));
    writeEnv(root, '# 主题侧默认内容目录\nCONTENT_DIR = env-content\n');
    process.env.CONTENT_DIR = 'process-content';

    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.dirAbs).toBe(path.join(root, 'env-content', 'overrides'));
    expect(resolution.dirAbs).not.toBe(path.join(root, 'process-content', 'overrides'));
  });

  it('.env 里 ENABLE_CONTENT_SYNC=false ⇒ mizuki-head-content-sync-disabled', () => {
    const root = makeMizukiHead();
    ensureDir(path.join(root, 'content', 'overrides'));
    process.env.ENABLE_CONTENT_SYNC = 'true';
    writeEnv(root, 'ENABLE_CONTENT_SYNC=false\n');

    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mizuki-head-content-sync-disabled');
  });

  it('绝对 CONTENT_DIR 指向**不存在**的目录 ⇒ 拒绝（上游 fs.existsSync 为假 ⇒ 早退，不 sync）', () => {
    const root = makeMizukiHead();
    const missing = path.join(os.tmpdir(), 'mizuki-absent-content-9f3a1c');
    expect(fs.existsSync(missing)).toBe(false);
    process.env.CONTENT_DIR = missing;

    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mizuki-head-no-content-dir');
  });

  it('内容目录不存在 + CONTENT_REPO_URL 已设 ⇒ 拒绝（上游会 git clone 成工作副本）', () => {
    const root = makeMizukiHead();
    process.env.CONTENT_REPO_URL = 'https://example.invalid/content.git';

    const resolution = resolveConfigWriteTarget(root);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('mizuki-head-content-repo-url');
  });

  it('读 .env 不污染 process.env（调用前后深等）', () => {
    const root = makeMizukiHead();
    ensureDir(path.join(root, 'env-content'));
    writeEnv(
      root,
      'CONTENT_DIR=env-content\nENABLE_CONTENT_SYNC=true\nMIZUKI_ENV_SPEC_PROBE=1\n',
    );
    const before = { ...process.env };

    resolveConfigWriteTarget(root);

    expect({ ...process.env }).toEqual(before);
    expect(process.env['MIZUKI_ENV_SPEC_PROBE']).toBeUndefined();
  });
});

describe('resolveConfigWriteTarget — unknown 与路径纪律', () => {
  it('空目录 / 空串 / 不存在的根 ⇒ theme-form-unsupported，不抛错', () => {
    const empty = makeRoot('empty-');
    const missing = path.join(os.tmpdir(), 'mizuki-write-target-missing-2026');
    for (const root of [empty, '', missing]) {
      const resolution = resolveConfigWriteTarget(root);
      expect(resolution.ok).toBe(false);
      if (resolution.ok) return;
      expect(resolution.reason).toBe('theme-form-unsupported');
    }
  });

  it('message 不含绝对路径（root 串与盘符，平台无关判据），可写分支的 dirAbs 是绝对路径', () => {
    const legacy = makeLegacy();
    const head = makeMizukiHead();
    ensureDir(path.join(head, 'content', '.git'));
    const shirone = makeShirone();
    const okRoot = makeShirone({
      schemaVersion: 1,
      source: { type: 'path', path: makeRoot('shirone-content-') },
    });

    const cases = [legacy, head, shirone, okRoot];

    for (const root of cases) {
      const resolution = resolveConfigWriteTarget(root);
      if (resolution.ok) {
        expect(path.isAbsolute(resolution.dirAbs)).toBe(true);
        continue;
      }
      expect(resolution.message).not.toContain(root);
      // 要挡的是「盘符 / 绝对路径」，不是「本平台的根前缀」：POSIX 下 path.parse(root).root 就是单个 "/"，
      // 而合法相对投影 config/<域>.yaml 天然含 "/" ⇒ 用它当判据在 POSIX 恒失败（CI run 41165961289）。
      expect(resolution.message).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(resolution.message).not.toContain(':\\');
      for (const key of resolution.invalidMounts) {
        expect(path.isAbsolute(key)).toBe(false);
      }
    }

    // 明确一条拒绝分支也满足同口径
    const disabled = resolveConfigWriteTarget(legacy);
    expect(disabled.ok).toBe(true);
  });

  it('任何分支都不写盘：调用前后临时域条目完全一致', () => {
    const legacy = makeLegacy();
    const head = makeMizukiHead();
    ensureDir(path.join(head, 'content', 'overrides'));
    const headGit = makeMizukiHead();
    ensureDir(path.join(headGit, 'content', '.git'));
    const shirone = makeShirone();
    const shironeOk = makeShirone({
      schemaVersion: 1,
      source: { type: 'path', path: makeRoot('shirone-content-') },
    });
    const empty = makeRoot('empty-');

    const roots = [legacy, head, headGit, shirone, shironeOk, empty];
    const before = roots.map((root) => snapshot(root));
    for (const root of roots) resolveConfigWriteTarget(root);
    const after = roots.map((root) => snapshot(root));
    expect(after).toEqual(before);
  });
});
