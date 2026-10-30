/**
 * [Q3] content-source 单测：全部在 mkdtemp 临时域内构造（仓规红线 9，绝不碰真实主题目录）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCK_FILE,
  MANIFEST_FILE,
  WORKING_COPY_DIR,
  resolveContentSource,
} from '../../src/common/theme/content-source';

const tmpRoots: string[] = [];

/** 新建一个临时主题域 */
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-content-src-'));
  tmpRoots.push(dir);
  return dir;
}

function writeJson(target: string, value: unknown): void {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

afterAll(() => {
  for (const dir of tmpRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── env 用例的卫生：先清场（宿主真实 env 不渗入），再在 afterEach 还原 ──────────
const ENV_KEYS = ['CONTENT_DIR', 'CONTENT_REPO_URL', 'CONTENT_REPO_REF', 'SHIRONE_CONTENT_SYNC'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

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

/** 写一个环境文件（`.env` / `.env.local`） */
function writeEnvFile(root: string, file: string, body: string): void {
  fs.writeFileSync(path.join(root, file), body, 'utf8');
}

describe('resolveContentSource — 退化到 local', () => {
  it('root 为空串 ⇒ mode:local，不抛错', () => {
    const profile = resolveContentSource('');
    expect(profile.mode).toBe('local');
    expect(profile.manifestPath).toBeNull();
    expect(profile.source).toBeNull();
    expect(profile.mounts).toEqual({});
  });

  it('root 不存在 ⇒ mode:local，不抛错', () => {
    const missing = path.join(os.tmpdir(), 'mizuki-content-src-does-not-exist-2026');
    const profile = resolveContentSource(missing);
    expect(profile.mode).toBe('local');
    expect(profile.manifestPath).toBeNull();
    expect(profile.lock.readable).toBe(false);
    expect(profile.supported).toBe(true);
  });

  it('目录存在但无 manifest ⇒ mode:local、manifestPath:null', () => {
    const root = makeRoot();
    const profile = resolveContentSource(root);
    expect(profile.mode).toBe('local');
    expect(profile.manifestPath).toBeNull();
    expect(profile.contentRoot).toBe(root);
    expect(profile.mounts).toEqual({});
    expect(profile.reason).not.toBeNull();
  });
});

describe('resolveContentSource — external 解析', () => {
  it('git 源 + lock 存在 ⇒ contentRoot 为 <root>/.content-src', () => {
    const root = makeRoot();
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/blog-content.git', ref: 'main' },
    });
    writeJson(path.join(root, LOCK_FILE), {
      schemaVersion: 1,
      syncedAt: '2026-10-29T00:00:00.000Z',
      source: {
        type: 'git',
        url: 'https://example.invalid/blog-content.git',
        ref: 'main',
        commit: '0'.repeat(40),
      },
      mounts: {},
      config: [],
      prune: true,
    });

    const profile = resolveContentSource(root);
    expect(profile.mode).toBe('external');
    expect(profile.contentRoot).toBe(path.join(root, WORKING_COPY_DIR));
    expect(profile.configDirInContent).toBe(path.join(root, WORKING_COPY_DIR, 'config'));
    expect(profile.overridesDirInContent).toBe(path.join(root, WORKING_COPY_DIR, 'overrides'));
    expect(profile.source).toEqual({
      type: 'git',
      url: 'https://example.invalid/blog-content.git',
      ref: 'main',
    });
    expect(profile.lock.readable).toBe(true);
    expect(profile.lock.sourceType).toBe('git');
    expect(profile.mounts).toEqual({
      content: 'src/content',
      data: 'src/data',
      assets: 'src/assets',
      public: 'public',
    });
    expect(profile.prune).toBe(true);
  });

  it('path 源 ⇒ contentRoot 解析正确', () => {
    const root = makeRoot();
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 1,
      source: { type: 'path', path: '../blog-content' },
    });

    const profile = resolveContentSource(root);
    expect(profile.mode).toBe('external');
    expect(profile.contentRoot).toBe(path.resolve(root, '../blog-content'));
    expect(profile.configDirInContent).toBe(path.resolve(root, '../blog-content', 'config'));
    expect(profile.overridesDirInContent).toBe(path.resolve(root, '../blog-content', 'overrides'));
    expect(fs.existsSync(path.join(root, LOCK_FILE))).toBe(false);
  });

  it('mounts 覆盖生效；null ⇒ 记入禁用', () => {
    const root = makeRoot();
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/c.git', ref: 'main' },
      mounts: { content: 'src/posts', data: null, assets: false },
    });

    const profile = resolveContentSource(root);
    expect(profile.mounts['content']).toBe('src/posts');
    expect('data' in profile.mounts).toBe(false);
    expect('assets' in profile.mounts).toBe(false);
    expect(profile.disabledMounts).toEqual(['data', 'assets']);
    expect(profile.mounts['public']).toBe('public');
    expect(profile.invalidMounts).toEqual([]);
  });

  it('非法 mounts（src 过宽 / 保留目录 / 空串）⇒ 保留默认值并落证据，不抛错', () => {
    const root = makeRoot();
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/c.git', ref: 'main' },
      mounts: { content: 'src', data: '.', assets: '' },
    });

    const profile = resolveContentSource(root);
    expect(profile.mounts).toEqual({
      content: 'src/content',
      data: 'src/data',
      assets: 'src/assets',
      public: 'public',
    });
    expect(profile.invalidMounts.map((item) => item.key).sort()).toEqual(['assets', 'content', 'data']);
    const mountsEvidence = profile.evidence.find((item) => item.name === 'mounts');
    expect(mountsEvidence?.passed).toBe(false);
  });

  it('schemaVersion: 2 ⇒ 标记不支持并落对应证据', () => {
    const root = makeRoot();
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 2,
      source: { type: 'path', path: 'content-repo' },
    });

    const profile = resolveContentSource(root);
    expect(profile.schemaVersion).toBe(2);
    expect(profile.supported).toBe(false);
    expect(profile.reason).not.toBeNull();
    expect(profile.reason ?? '').toContain('2');

    const versionEvidence = profile.evidence.find((item) => item.name === 'schema-version');
    expect(versionEvidence).toBeDefined();
    expect(versionEvidence?.passed).toBe(false);
    expect(versionEvidence?.detail).toContain('2');
  });

  it('lock 缺失 ⇒ 仍返回合理结果（不抛错）', () => {
    const root = makeRoot();
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/c.git', ref: 'main' },
    });

    const profile = resolveContentSource(root);
    expect(profile.mode).toBe('external');
    expect(profile.lock.readable).toBe(false);
    expect(profile.lock.sourceType).toBeNull();
    expect(profile.lock.syncedAt).toBeNull();
    expect(profile.contentRoot).toBe(path.join(root, WORKING_COPY_DIR));
    const lockEvidence = profile.evidence.find((item) => item.name === 'content-lock');
    expect(lockEvidence?.passed).toBe(false);
  });

  it('evidence 的 detail 不含绝对路径', () => {
    const root = makeRoot();
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 2,
      source: { type: 'path', path: root },
      mounts: { content: 'src/posts', data: null },
    });
    writeJson(path.join(root, LOCK_FILE), {
      schemaVersion: 1,
      syncedAt: '2026-10-29T00:00:00.000Z',
      source: { type: 'path', path: root, commit: 'abc' },
      mounts: {},
      config: [],
      prune: false,
    });

    const profile = resolveContentSource(root);
    const posixRoot = root.replace(/\\/g, '/');
    expect(profile.evidence.length).toBeGreaterThan(0);
    for (const entry of profile.evidence) {
      expect(entry.detail).not.toContain(root);
      expect(entry.detail).not.toContain(posixRoot);
      expect(/^[A-Za-z]:[\\/]/.test(entry.detail)).toBe(false);
      expect(path.isAbsolute(entry.detail)).toBe(false);
    }
    expect(profile.manifestPath).toBe(MANIFEST_FILE);
    expect(path.isAbsolute(profile.manifestPath ?? '')).toBe(false);
  });
});

describe('resolveContentSource — .env / .env.local 口径（上游 resolve-source.mjs）', () => {
  it('.env 的 CONTENT_DIR 压过「无 manifest ⇒ local」：external + path 源', () => {
    const root = makeRoot();
    const envContent = path.join(root, 'env-content');
    fs.mkdirSync(envContent, { recursive: true });
    writeEnvFile(root, '.env', `CONTENT_DIR=${envContent}\n`);

    const profile = resolveContentSource(root);
    expect(profile.mode).toBe('external');
    expect(profile.source).toEqual({ type: 'path', path: envContent });
    expect(profile.contentRoot).toBe(envContent);
    expect(profile.configDirInContent).toBe(path.join(envContent, 'config'));
    expect(profile.manifestPath).toBeNull();
  });

  it('进程环境变量优先：文件里的 CONTENT_DIR 不覆盖已继承的键', () => {
    const root = makeRoot();
    const fromFile = path.join(root, 'file-content');
    const fromProcess = path.join(root, 'process-content');
    fs.mkdirSync(fromFile, { recursive: true });
    fs.mkdirSync(fromProcess, { recursive: true });
    writeEnvFile(root, '.env', `CONTENT_DIR=${fromFile}\n`);
    process.env.CONTENT_DIR = fromProcess;

    const profile = resolveContentSource(root);
    expect(profile.mode).toBe('external');
    expect(profile.source).toEqual({ type: 'path', path: fromProcess });
    expect(profile.contentRoot).toBe(fromProcess);
  });

  it('.env.local 覆盖 .env（两文件都写 CONTENT_DIR）', () => {
    const root = makeRoot();
    const fromEnv = path.join(root, 'from-env');
    const fromLocal = path.join(root, 'from-local');
    fs.mkdirSync(fromEnv, { recursive: true });
    fs.mkdirSync(fromLocal, { recursive: true });
    writeEnvFile(root, '.env', `CONTENT_DIR=${fromEnv}\n`);
    writeEnvFile(root, '.env.local', `CONTENT_DIR=${fromLocal}\n`);

    const profile = resolveContentSource(root);
    expect(profile.source).toEqual({ type: 'path', path: fromLocal });
    expect(profile.contentRoot).toBe(fromLocal);
  });

  it('解析细节：CRLF 行尾、# 注释、空行、无 = 的行被忽略', () => {
    const root = makeRoot();
    const target = path.join(root, 'crlf-content');
    fs.mkdirSync(target, { recursive: true });
    writeEnvFile(
      root,
      '.env',
      `# 注释\r\n\r\nno-equals-line\r\nCONTENT_DIR=${target}\r\n`,
    );

    const profile = resolveContentSource(root);
    expect(profile.source).toEqual({ type: 'path', path: target });
  });

  it('引号口径：两端同型剥（单/双），单侧或异型保留', () => {
    const root = makeRoot();
    const single = path.join(root, "single'quote-content");
    fs.mkdirSync(single, { recursive: true });
    writeEnvFile(root, '.env', `CONTENT_DIR='${single}'\n`);

    expect(resolveContentSource(root).source).toEqual({ type: 'path', path: single });

    const root2 = makeRoot();
    writeEnvFile(
      root2,
      '.env',
      `CONTENT_REPO_URL="https://example.invalid/a.git"\nCONTENT_REPO_REF='main\n`,
    );
    const profile = resolveContentSource(root2);
    // URL 两端同为 " ⇒ 剥；REF 只有左侧单引号 ⇒ 原样保留（不校验配对）
    expect(profile.source).toEqual({
      type: 'git',
      url: 'https://example.invalid/a.git',
      ref: "'main",
    });
  });

  it('SHIRONE_CONTENT_SYNC=0 ⇒ mode:local + reason（压过 manifest 里的 source）', () => {
    const root = makeRoot();
    const contentRepo = path.join(root, 'repo');
    fs.mkdirSync(contentRepo, { recursive: true });
    writeJson(path.join(root, MANIFEST_FILE), {
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
    });
    writeEnvFile(root, '.env.local', 'SHIRONE_CONTENT_SYNC = false\n');

    const profile = resolveContentSource(root);
    expect(profile.mode).toBe('local');
    expect(profile.source).toBeNull();
    expect(profile.reason).not.toBeNull();
    expect(profile.reason ?? '').toContain('SHIRONE_CONTENT_SYNC');
    expect(profile.mounts).toEqual({});
  });

  it('读 .env / .env.local 后 process.env 与调用前深等（零污染）', () => {
    const root = makeRoot();
    writeEnvFile(root, '.env', 'CONTENT_DIR=dummy-content\nSHIRONE_CONTENT_SYNC=0\n');
    writeEnvFile(root, '.env.local', 'MIZUKI_ENV_SPEC_PROBE=1\n');
    const before = { ...process.env };

    resolveContentSource(root);

    expect({ ...process.env }).toEqual(before);
    expect(process.env['CONTENT_DIR']).toBeUndefined();
    expect(process.env['MIZUKI_ENV_SPEC_PROBE']).toBeUndefined();
  });
});
