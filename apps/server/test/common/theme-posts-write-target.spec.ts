/**
 * [T4-3b] posts-write-target 单测 —— 「文章写入是否持久」四档四格
 *
 * 全部在 mkdtemp 临时域内构造（仓规红线 9，绝不碰真实主题目录）。
 *
 * 本 spec 钉的核心不是「有没有拒绝」，而是**拒绝的边界画得对不对** —— 因为这一层的风险
 * 有两个方向，且**假拒绝**比假放行更隐蔽（用户会以为功能坏了）：
 *   ① 漏拒（Shirone external 放行）⇒ 静默丢数据；
 *   ② 误拒（Mizuki HEAD 拒绝）⇒ 该档明明写代码仓是持久的（junction 写穿内容仓），却被挡死。
 * 故四档各钉一组，且 **Mizuki HEAD 的 OK 分支是本 spec 的重点**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANIFEST_FILE } from '../../src/common/theme/content-source';
import { resolvePostsWriteTarget } from '../../src/common/theme/posts-write-target';

const tmpRoots: string[] = [];
const ENV_KEYS = ['ENABLE_CONTENT_SYNC', 'CONTENT_DIR', 'CONTENT_REPO_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function makeRoot(prefix = 'posts-write-target-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function touch(file: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, '', 'utf8');
}

function writeText(file: string, text: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, 'utf8');
}

/** mizuki legacy：单文件 `src/config.ts`，无 `src/config/` */
function makeLegacyRoot(): string {
  const root = makeRoot('posts-t-legacy-');
  touch(path.join(root, 'src', 'config.ts'));
  ensureDir(path.join(root, 'src', 'content', 'posts'));
  return root;
}

/** mizuki HEAD：`src/config/overrideLoader.ts` */
function makeHeadRoot(): string {
  const root = makeRoot('posts-t-head-');
  touch(path.join(root, 'src', 'config', 'overrideLoader.ts'));
  ensureDir(path.join(root, 'src', 'content', 'posts'));
  return root;
}

/** shirone：`src/config/integrationsConfig.ts` */
function makeShironeRoot(): string {
  const root = makeRoot('posts-t-shirone-');
  touch(path.join(root, 'src', 'config', 'integrationsConfig.ts'));
  ensureDir(path.join(root, 'src', 'content', 'posts'));
  return root;
}

function writeManifest(root: string, body: Record<string, unknown>): void {
  writeText(path.join(root, MANIFEST_FILE), JSON.stringify(body, null, 2));
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
  for (const dir of tmpRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('[T4-3b] resolvePostsWriteTarget — mizuki legacy（无内容分离）', () => {
  it('① 放行：代码仓即真源，零 needSync', () => {
    const root = makeLegacyRoot();
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form).toBe('mizuki-legacy');
    expect(r.materialization).toBe('durable-code-repo');
    expect(r.needsSync).toBe(false);
    expect(r.postsDirAbs).toBe(path.join(root, 'src', 'content', 'posts'));
  });

  it('① 不受 Mizuki HEAD 的 env 影响（legacy 根本不看 .env）', () => {
    const root = makeLegacyRoot();
    writeText(path.join(root, '.env'), 'ENABLE_CONTENT_SYNC=false\n');
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(true);
  });
});

describe('[T4-3b] resolvePostsWriteTarget — mizuki HEAD（junction 写穿 ⇒ 放行）', () => {
  it('② **关键**：external 档 + 内容目录存在 ⇒ 放行（写代码仓写穿内容仓，持久）', () => {
    const root = makeHeadRoot();
    ensureDir(path.join(root, 'content'));
    const r = resolvePostsWriteTarget(root);
    expect(r.ok, '按 external 一律拒绝会在这里误拒整档').toBe(true);
    if (!r.ok) return;
    expect(r.form).toBe('mizuki-head');
    expect(r.materialization).toBe('durable-code-repo');
    expect(r.needsSync).toBe(true);
    // 残留风险必须如实标注（symlink 失败上游会降级为复制）
    expect(r.notes.some((n) => n.startsWith('symlink-fallback-risk'))).toBe(true);
    expect(r.evidence.some((e) => e.name === 'materialization' && e.passed)).toBe(true);
  });

  it('② CONTENT_DIR 指向绝对路径同样放行（绝对值原样使用，勿改回一律 join）', () => {
    const root = makeHeadRoot();
    const contentDir = makeRoot('posts-t-content-');
    writeText(path.join(root, '.env'), `CONTENT_DIR=${contentDir}\n`);
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(true);
  });

  it('② ENABLE_CONTENT_SYNC=false ⇒ 拒绝（上游早退，posts 不被物化）', () => {
    const root = makeHeadRoot();
    ensureDir(path.join(root, 'content'));
    writeText(path.join(root, '.env'), 'ENABLE_CONTENT_SYNC=false\n');
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('mizuki-head-content-sync-disabled');
    expect(r.materialization).toBe('ephemeral');
    expect(r.message).toContain('ENABLE_CONTENT_SYNC');
  });

  it('② 无内容目录且无 CONTENT_REPO_URL ⇒ 拒绝（上游打印「本地内容」后早退）', () => {
    const root = makeHeadRoot();
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('mizuki-head-no-content-dir');
    expect(r.materialization).toBe('ephemeral');
  });

  it('② 无内容目录但设了 CONTENT_REPO_URL ⇒ 放行（上游会先克隆再建 junction）', () => {
    const root = makeHeadRoot();
    writeText(path.join(root, '.env'), 'CONTENT_REPO_URL=https://example.invalid/x.git\n');
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(true);
  });

  it('② .env 的键**压过**进程 env（HEAD 上游 load-env.js 方向，与 Shirone 相反）', () => {
    const root = makeHeadRoot();
    ensureDir(path.join(root, 'content'));
    writeText(path.join(root, '.env'), 'ENABLE_CONTENT_SYNC=false\n');
    process.env['ENABLE_CONTENT_SYNC'] = 'true';
    const r = resolvePostsWriteTarget(root);
    // 文件说 false ⇒ 必须按 false 走（若按进程 env 优先就会错判成可写）
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('mizuki-head-content-sync-disabled');
  });
});

describe('[T4-3b] resolvePostsWriteTarget — shirone', () => {
  it('③ local 模式 ⇒ 放行（主题仓自持内容）', () => {
    const root = makeShironeRoot();
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form).toBe('shirone');
    expect(r.materialization).toBe('durable-code-repo');
    expect(r.needsSync).toBe(false);
  });

  it('③ **关键**：external + prune 默认 true ⇒ 拒绝，且指明持久落点是内容仓', () => {
    const root = makeShironeRoot();
    writeManifest(root, { schemaVersion: 1, source: { type: 'path', path: './content-repo' } });
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('shirone-external-copy-prune');
    // 语义要害：不是「没法写」，而是「持久落点在别处，本服务还没接通」
    expect(r.materialization).toBe('durable-content-repo');
    expect(r.message).toContain('内容仓');
    // 指路牌：必须告诉用户下一步去哪儿写
    expect(r.message).toContain('下一步');
  });

  it('③ prune 被显式关闭也**仍然拒绝**（复制本身就会用源覆盖，比裁剪更彻底）', () => {
    const root = makeShironeRoot();
    writeManifest(root, { schemaVersion: 1, prune: false, source: { type: 'path', path: './c' } });
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('shirone-external-copy-prune');
  });

  it('③ 清单版本不受支持 ⇒ 单独一类拒绝（不静默按 v1 处理）', () => {
    const root = makeShironeRoot();
    writeManifest(root, { schemaVersion: 99, source: { type: 'path', path: './c' } });
    const r = resolvePostsWriteTarget(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('content-source-unsupported');
    expect(r.materialization).toBe('ephemeral');
  });
});

describe('[T4-3b] resolvePostsWriteTarget — unknown 与安全性质', () => {
  it('④ 主题根为空串 / 不存在 ⇒ 拒绝且不抛错', () => {
    for (const root of ['', path.join(os.tmpdir(), 'posts-t-missing-does-not-exist-xyz')]) {
      const r = resolvePostsWriteTarget(root);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('theme-form-unknown');
    }
  });

  it('④ 拒绝文案**不含绝对路径**（仓规红线 6）', () => {
    const cases: Array<() => ReturnType<typeof resolvePostsWriteTarget>> = [
      () => {
        const root = makeHeadRoot();
        writeText(path.join(root, '.env'), 'ENABLE_CONTENT_SYNC=false\n');
        return resolvePostsWriteTarget(root);
      },
      () => {
        const root = makeShironeRoot();
        writeManifest(root, { schemaVersion: 1, source: { type: 'path', path: './c' } });
        return resolvePostsWriteTarget(root);
      },
    ];
    for (const run of cases) {
      const r = run();
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.message).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(r.message).not.toContain(os.tmpdir());
    }
  });

  it('④ evidence 每条都有 name / passed / detail，且 detail 不含绝对路径', () => {
    const root = makeHeadRoot();
    ensureDir(path.join(root, 'content'));
    const r = resolvePostsWriteTarget(root);
    expect(r.evidence.length).toBeGreaterThan(0);
    for (const e of r.evidence) {
      expect(typeof e.name).toBe('string');
      expect(typeof e.passed).toBe('boolean');
      expect(typeof e.detail).toBe('string');
      expect(e.detail).not.toMatch(/[A-Za-z]:[\\/]/);
    }
  });

  it('④ 四档的 form 取值与 ConfigWriteForm 同名同域（不另立真源）', () => {
    expect(resolvePostsWriteTarget(makeLegacyRoot()).form).toBe('mizuki-legacy');
    expect(resolvePostsWriteTarget(makeHeadRoot()).form).toBe('mizuki-head');
    expect(resolvePostsWriteTarget(makeShironeRoot()).form).toBe('shirone');
    expect(resolvePostsWriteTarget('').form).toBe('unknown');
  });
});
