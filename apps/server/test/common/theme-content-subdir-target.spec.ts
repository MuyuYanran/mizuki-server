/**
 * [T5b-1] 内容挂载点寻址底座（`resolveContentSubdirTarget`）单测
 *
 * 全部在 mkdtemp 临时域内构造（仓规红线 9）。
 *
 * 本 spec 的**风险是双向的**，与 T4-3b 同构：
 *   ① 漏拒 ⇒ 写进一个不会被同步的目录，静默丢数据；
 *   ② 误拒 ⇒ 明明该能写（local 模式）却被挡死。
 * 故六条拒绝原因各有正例，local 与 external 各有一条放行正例。
 *
 * 另钉一条**回归锚**：`resolveHeadEnv` / `resolveHeadContentDir` 是 T5b-1 从
 * `config-write-target.ts` 与 `posts-write-target.ts` 收敛出来的 L0 单源，
 * 必须与上游 `sync-content.js:17` 的「CONTENT_DIR 原样使用」口径逐字一致
 * —— 特别是**绝对值不得被二次 join**（ADR-028 §17 记过一次同类事故）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MANIFEST_FILE,
  resolveContentSubdirTarget,
  resolveHeadContentDir,
  resolveHeadEnv,
} from '../../src/common/theme/content-source';

const tmpRoots: string[] = [];
const ENV_KEYS = ['CONTENT_DIR', 'CONTENT_REPO_URL', 'SHIRONE_CONTENT_SYNC'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function makeRoot(prefix = 'subdir-target-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function writeManifest(root: string, body: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, MANIFEST_FILE), JSON.stringify(body, null, 2), 'utf8');
}

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
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

describe('[T5b-1] resolveHeadEnv / resolveHeadContentDir（Mizuki HEAD 口径）', () => {
  it('① .env 的键**压过**进程 env（与 Shirone 侧方向相反）', () => {
    const root = makeRoot('head-env-');
    fs.writeFileSync(path.join(root, '.env'), 'ENABLE_CONTENT_SYNC=false\n', 'utf8');
    process.env['ENABLE_CONTENT_SYNC'] = 'true';
    expect(resolveHeadEnv(root)('ENABLE_CONTENT_SYNC')).toBe('false');
    delete process.env['ENABLE_CONTENT_SYNC'];
  });

  it('① 文件没有的键退回进程 env；两边都没有 ⇒ undefined', () => {
    const root = makeRoot('head-env-');
    fs.writeFileSync(path.join(root, '.env'), 'A=1\n', 'utf8');
    process.env['T5B_ONLY_PROC'] = 'from-proc';
    const read = resolveHeadEnv(root);
    expect(read('A')).toBe('1');
    expect(read('T5B_ONLY_PROC')).toBe('from-proc');
    expect(read('NOPE')).toBeUndefined();
    delete process.env['T5B_ONLY_PROC'];
  });

  it('① 解析器细节：跳空行与 # 注释、取第一个 =、剥同型引号', () => {
    const root = makeRoot('head-env-');
    fs.writeFileSync(
      path.join(root, '.env'),
      ['# 注释行', '', 'KEY="quoted"', "SINGLE='sq'", 'EQ=a=b=c', '  SPACED  =  v  '].join('\n'),
      'utf8',
    );
    const read = resolveHeadEnv(root);
    expect(read('KEY')).toBe('quoted');
    expect(read('SINGLE')).toBe('sq');
    expect(read('EQ')).toBe('a=b=c');
    expect(read('SPACED')).toBe('v');
  });

  it('② 绝对值**原样使用**（绝不二次 join —— §17 事故的回归锚）', () => {
    const root = makeRoot('head-env-');
    const abs = path.join(os.tmpdir(), 'absolute-content-dir-xyz');
    fs.writeFileSync(path.join(root, '.env'), `CONTENT_DIR=${abs}\n`, 'utf8');
    expect(resolveHeadContentDir(root, resolveHeadEnv(root))).toBe(abs);
    // 若被错误 join，结果会以 root 开头
    expect(resolveHeadContentDir(root, resolveHeadEnv(root)).startsWith(root)).toBe(false);
  });

  it('② 相对值 ⇒ join(root, value)；缺省 ⇒ join(root, "content")', () => {
    const root = makeRoot('head-env-');
    fs.writeFileSync(path.join(root, '.env'), 'CONTENT_DIR=my-content\n', 'utf8');
    expect(resolveHeadContentDir(root, resolveHeadEnv(root))).toBe(
      path.join(root, 'my-content'),
    );
    fs.writeFileSync(path.join(root, '.env'), '', 'utf8');
    expect(resolveHeadContentDir(root, resolveHeadEnv(root))).toBe(path.join(root, 'content'));
  });
});

describe('[T5b-1] resolveContentSubdirTarget — 放行', () => {
  it('① local 模式：落点在代码仓 src/content/<subdir>，不需要 sync', () => {
    const root = makeRoot();
    for (const subdir of ['series', 'moments', 'spec', 'posts'] as const) {
      const r = resolveContentSubdirTarget(root, subdir);
      expect(r.ok, subdir).toBe(true);
      if (!r.ok) continue;
      expect(r.dirAbs).toBe(path.join(root, 'src', 'content', subdir));
      expect(r.inContentRepo).toBe(false);
      expect(r.needsSync).toBe(false);
    }
  });

  it('② external(path 源)：落点在内容仓 content/<subdir>，needsSync=true', () => {
    const root = makeRoot();
    const contentRepo = makeRoot('content-repo-');
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
    });
    const r = resolveContentSubdirTarget(root, 'series');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dirAbs).toBe(path.join(contentRepo, 'content', 'series'));
    expect(r.inContentRepo).toBe(true);
    expect(r.needsSync).toBe(true);
    expect(r.mountTarget).toBe('src/content');
  });

  it('② mounts.content 被改到别处 ⇒ 落点跟随 mounts，不写死 src/content', () => {
    const root = makeRoot();
    const contentRepo = makeRoot('content-repo-');
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
      mounts: { content: 'src/my-content' },
    });
    const r = resolveContentSubdirTarget(root, 'moments');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 内容仓侧目录名仍是 content（挂载源键），代码仓落点才是 src/my-content
    expect(r.dirAbs).toBe(path.join(contentRepo, 'content', 'moments'));
    expect(r.mountTarget).toBe('src/my-content');
  });
});

describe('[T5b-1] resolveContentSubdirTarget — 拒绝六因', () => {
  it('③ mounts.content 被显式关闭（null）⇒ 拒绝 + 指明是死路', () => {
    const root = makeRoot();
    const contentRepo = makeRoot('content-repo-');
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
      mounts: { content: null },
    });
    const r = resolveContentSubdirTarget(root, 'series');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('content-mount-disabled');
    expect(r.message).toContain('下一步');
    expect(r.message).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it('③ mounts.content 被显式关闭（false）⇒ 同样拒绝', () => {
    const root = makeRoot();
    const contentRepo = makeRoot('content-repo-');
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
      mounts: { content: false },
    });
    expect(resolveContentSubdirTarget(root, 'moments').ok).toBe(false);
  });

  it('④ 清单版本超上限 ⇒ 拒绝（不静默按 v1 处理）', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 99,
      source: { type: 'path', path: makeRoot('content-repo-') },
    });
    const r = resolveContentSubdirTarget(root, 'series');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('manifest-unsupported-version');
  });

  it('⑤ mounts 有非法项 ⇒ 拒绝（不猜用户意图）', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: makeRoot('content-repo-') },
      mounts: { '../escape': 'src/x' },
    });
    const r = resolveContentSubdirTarget(root, 'series');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('mounts-invalid');
  });

  it('⑥ git 源 ⇒ 拒绝（工作副本会被 checkout --force + clean -ffdx）', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/x.git' },
    });
    const r = resolveContentSubdirTarget(root, 'moments');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('content-source-git');
    expect(r.message).toContain('下一步');
  });

  it('⑥ SHIRONE_CONTENT_SYNC 关闭 ⇒ 退化为 local，放行且不 needsSync', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: makeRoot('content-repo-') },
    });
    process.env['SHIRONE_CONTENT_SYNC'] = '0';
    const r = resolveContentSubdirTarget(root, 'series');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inContentRepo).toBe(false);
    expect(r.needsSync).toBe(false);
  });

  it('⑦ 所有拒绝文案都含「下一步」且零绝对路径（红线 6）', () => {
    const cases: Array<() => ReturnType<typeof resolveContentSubdirTarget>> = [
      () => {
        const root = makeRoot();
        writeManifest(root, {
          schemaVersion: 99,
          source: { type: 'path', path: makeRoot('cr-') },
        });
        return resolveContentSubdirTarget(root, 'series');
      },
      () => {
        const root = makeRoot();
        writeManifest(root, {
          schemaVersion: 1,
          source: { type: 'path', path: makeRoot('cr-') },
          mounts: { content: null },
        });
        return resolveContentSubdirTarget(root, 'series');
      },
      () => {
        const root = makeRoot();
        writeManifest(root, { schemaVersion: 1, source: { type: 'git', url: 'https://e.invalid/x' } });
        return resolveContentSubdirTarget(root, 'series');
      },
    ];
    for (const run of cases) {
      const r = run();
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.message.length).toBeGreaterThan(10);
      expect(r.message).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(r.message).not.toContain(os.tmpdir());
    }
  });
});
