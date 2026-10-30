/**
 * [T4-4] `resolveContentLogicalPath` 单测 —— 逻辑路径 → 物理落点的全段映射
 *
 * 四组钉子：
 * ① **local**：逻辑路径原样落在代码仓 `<root>/src/content/<rest>`；
 * ② **external + path 源**：落在 `<contentRoot>/content/<rest>`，`needsSync: true`；
 * ③ **拒绝判据与 `resolveContentSubdirTarget` 同源**（git / mounts 禁用 / mounts 非法 / 版本超限），
 *    不另立一套 —— 两处判据劈叉会让「闸门放行、映射拒绝」这种自相矛盾状态出现；
 * ④ **口径纪律**：逻辑前缀恒为 `src/content`，即使 `mounts.content` 被改到 `src/my-content`
 *    （否则索引口径会随部署漂移，而 `article.filePath` / 事件 `filePaths` 都是对外契约）。
 *
 * 全部在 mkdtemp 临时域内构造（仓规红线 9）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOGICAL_CONTENT_ROOT,
  MANIFEST_FILE,
  resolveContentLogicalPath,
} from '../../src/common/theme/content-source';

const tmpRoots: string[] = [];
const ENV_KEYS = ['CONTENT_DIR', 'CONTENT_REPO_URL', 'SHIRONE_CONTENT_SYNC'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function makeRoot(prefix = 'logical-path-'): string {
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

describe('[T4-4] resolveContentLogicalPath — local', () => {
  it('① 逻辑路径原样落在代码仓，needsSync=false', () => {
    const root = makeRoot();
    const r = resolveContentLogicalPath(root, 'src/content/posts/hello/index.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.abs).toBe(path.join(root, 'src', 'content', 'posts', 'hello', 'index.md'));
    expect(r.rest).toBe('posts/hello/index.md');
    expect(r.needsSync).toBe(false);
    expect(r.inContentRepo).toBe(false);
  });

  it('① 任意深度都支持（封面 / 单文件 / 子目录 index）', () => {
    const root = makeRoot();
    for (const rel of [
      'src/content/posts/hello/cover.jpg',
      'src/content/posts/standalone.md',
      'src/content/posts/a/b/c/index.mdx',
    ]) {
      const r = resolveContentLogicalPath(root, rel);
      expect(r.ok, rel).toBe(true);
      if (!r.ok) continue;
      expect(r.abs).toBe(path.join(root, ...rel.split('/')));
    }
  });

  it('④ 反斜杠输入被归一化（Windows 调用方容错）', () => {
    const root = makeRoot();
    const r = resolveContentLogicalPath(root, 'src\\content\\posts\\x\\index.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rest).toBe('posts/x/index.md');
    expect(r.abs).toBe(path.join(root, 'src', 'content', 'posts', 'x', 'index.md'));
  });

  it('④ 不在逻辑内容根之下 ⇒ 明确拒绝（编程错误，不是配置问题）', () => {
    const root = makeRoot();
    for (const bad of ['src/data/diary.ts', 'src/content', '/abs/path.md']) {
      const r = resolveContentLogicalPath(root, bad);
      expect(r.ok, bad).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe('logical-path-outside-content-root');
    }
  });
});

describe('[T4-4] resolveContentLogicalPath — external', () => {
  it('② 落在内容仓 <contentRoot>/content/<rest>，needsSync=true', () => {
    const root = makeRoot();
    const contentRepo = makeRoot('content-repo-');
    writeManifest(root, { schemaVersion: 1, source: { type: 'path', path: contentRepo } });
    const r = resolveContentLogicalPath(root, 'src/content/posts/hello/index.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.abs).toBe(path.join(contentRepo, 'content', 'posts', 'hello', 'index.md'));
    expect(r.rest).toBe('posts/hello/index.md');
    expect(r.needsSync).toBe(true);
    expect(r.inContentRepo).toBe(true);
  });

  it('④ mounts.content 改到别处时，**逻辑口径仍恒为 src/content**（索引不随部署漂移）', () => {
    const root = makeRoot();
    const contentRepo = makeRoot('content-repo-');
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: contentRepo },
      mounts: { content: 'src/my-content' },
    });
    // 传入的仍是逻辑口径 src/content
    const r = resolveContentLogicalPath(root, 'src/content/posts/x/index.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 物理落点跟随内容仓（内容仓侧目录名恒为 content —— 挂载源键）
    expect(r.abs).toBe(path.join(contentRepo, 'content', 'posts', 'x', 'index.md'));
  });

  it('③ git 源 ⇒ 拒绝（写必丢），reason 与底座同源', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/x.git' },
    });
    const r = resolveContentLogicalPath(root, 'src/content/posts/x/index.md');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('content-source-git');
  });

  it('③ mounts.content 禁用 ⇒ 拒绝', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: makeRoot('cr-') },
      mounts: { content: null },
    });
    const r = resolveContentLogicalPath(root, 'src/content/posts/x/index.md');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('content-mount-disabled');
  });

  it('③ mounts 非法 ⇒ 拒绝', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: makeRoot('cr-') },
      mounts: { '../escape': 'src/x' },
    });
    const r = resolveContentLogicalPath(root, 'src/content/posts/x/index.md');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('mounts-invalid');
  });

  it('③ 清单版本超限 ⇒ 拒绝', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 99,
      source: { type: 'path', path: makeRoot('cr-') },
    });
    const r = resolveContentLogicalPath(root, 'src/content/posts/x/index.md');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('manifest-unsupported-version');
  });

  it('③ SHIRONE_CONTENT_SYNC 关闭 ⇒ 退化为 local 映射（不是拒绝）', () => {
    const root = makeRoot();
    writeManifest(root, { schemaVersion: 1, source: { type: 'path', path: makeRoot('cr-') } });
    process.env['SHIRONE_CONTENT_SYNC'] = '0';
    const r = resolveContentLogicalPath(root, 'src/content/posts/x/index.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inContentRepo).toBe(false);
    expect(r.abs).toBe(path.join(root, 'src', 'content', 'posts', 'x', 'index.md'));
  });
});

describe('[T4-4] 口径常量', () => {
  it('LOGICAL_CONTENT_ROOT 恒为 src/content（与 mounts 默认目标一致）', () => {
    expect(LOGICAL_CONTENT_ROOT).toBe('src/content');
  });
});
