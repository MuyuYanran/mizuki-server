/**
 * [跨根备份] `common/fs/backup-roots` 单测 —— 受管根闭集、分类、manifest 落点解析
 *
 * 六组钉子：
 * ① `resolveManagedRoots`：只有「external + 版本受支持 + mounts 合法 + path 源 + 目录存在」
 *    才产出 content 根，其余一律 null（含 git 源、local 模式、mounts 禁用）；
 * ② `classifyManagedTarget`：**content 优先于 theme**（关键顺序，见函数注释）；
 * ③ `resolveManifestEntryPath`：拒绝绝对路径 / `..` / 空段；content 根不可用时明确失败；
 * ④ `archiveSubPath`：无标签 ⇒ 扁平（存量布局零变化）；有标签 ⇒ `<root>/<rel>`；
 * ⑤ **零绝对路径泄漏**：manifest 只存 root 标签 + 相对路径；
 * ⑥ 跨平台：Windows 反斜杠与盘符形态都不得逃逸。
 *
 * 全部在 mkdtemp 临时域内构造（仓规红线 9）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveSubPath,
  classifyManagedTarget,
  resolveManagedRoots,
  resolveManifestEntryPath,
} from '../../src/common/fs/backup-roots';
import { MANIFEST_FILE } from '../../src/common/theme/content-source';

const tmpRoots: string[] = [];
const ENV_KEYS = ['CONTENT_DIR', 'CONTENT_REPO_URL', 'SHIRONE_CONTENT_SYNC'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function makeRoot(prefix = 'backup-roots-'): string {
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

describe('[跨根备份] resolveManagedRoots', () => {
  it('① 未初始化（空串 / 不存在）⇒ 两个根都无效', () => {
    expect(resolveManagedRoots('')).toEqual({ themeRoot: '', contentRoot: null });
    const missing = path.join(os.tmpdir(), 'backup-roots-missing-xyz');
    expect(resolveManagedRoots(missing).contentRoot).toBeNull();
  });

  it('① local 模式（无清单）⇒ contentRoot 为 null', () => {
    const root = makeRoot();
    expect(resolveManagedRoots(root)).toEqual({ themeRoot: root, contentRoot: null });
  });

  it('① external + path 源 + 目录存在 ⇒ contentRoot 生效', () => {
    const root = makeRoot();
    const repo = makeRoot('content-repo-');
    writeManifest(root, { schemaVersion: 1, source: { type: 'path', path: repo } });
    expect(resolveManagedRoots(root).contentRoot).toBe(repo);
  });

  it('① 清单版本超上限 ⇒ contentRoot 为 null（不按旧版猜）', () => {
    const root = makeRoot();
    const repo = makeRoot('content-repo-');
    writeManifest(root, { schemaVersion: 99, source: { type: 'path', path: repo } });
    expect(resolveManagedRoots(root).contentRoot).toBeNull();
  });

  it('① mounts 非法 ⇒ contentRoot 为 null（不猜落点）', () => {
    const root = makeRoot();
    const repo = makeRoot('content-repo-');
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'path', path: repo },
      mounts: { '../escape': 'src/x' },
    });
    expect(resolveManagedRoots(root).contentRoot).toBeNull();
  });

  it('① git 源 ⇒ contentRoot 为 null（工作副本随时被强检强清）', () => {
    const root = makeRoot();
    writeManifest(root, {
      schemaVersion: 1,
      source: { type: 'git', url: 'https://example.invalid/x.git' },
    });
    expect(resolveManagedRoots(root).contentRoot).toBeNull();
  });

  it('① path 源但目录不存在 ⇒ contentRoot 为 null（无从落盘）', () => {
    const root = makeRoot();
    const ghost = path.join(os.tmpdir(), 'backup-roots-ghost-repo-xyz');
    writeManifest(root, { schemaVersion: 1, source: { type: 'path', path: ghost } });
    expect(resolveManagedRoots(root).contentRoot).toBeNull();
  });

  it('① SHIRONE_CONTENT_SYNC 关闭 ⇒ 退化为 local，contentRoot 为 null', () => {
    const root = makeRoot();
    const repo = makeRoot('content-repo-');
    writeManifest(root, { schemaVersion: 1, source: { type: 'path', path: repo } });
    process.env['SHIRONE_CONTENT_SYNC'] = '0';
    expect(resolveManagedRoots(root).contentRoot).toBeNull();
  });
});

describe('[跨根备份] classifyManagedTarget', () => {
  const theme = path.join(os.tmpdir(), 'cls-theme');
  const repo = path.join(os.tmpdir(), 'cls-repo');
  const roots = { themeRoot: theme, contentRoot: repo };

  it('② 内容仓内 ⇒ content 标签 + 根内相对路径', () => {
    const r = classifyManagedTarget(roots, path.join(repo, 'content', 'posts', 'a', 'index.md'));
    expect(r).toEqual({ root: 'content', rel: 'content/posts/a/index.md' });
  });

  it('② 主题根内 ⇒ theme 标签', () => {
    const r = classifyManagedTarget(roots, path.join(theme, 'src', 'config.ts'));
    expect(r).toEqual({ root: 'theme', rel: 'src/config.ts' });
  });

  it('② **content 优先于 theme**：内容仓在主题根之内时仍判为 content', () => {
    // 默认形态 contentRoot = <themeRoot>/content
    const inner = { themeRoot: theme, contentRoot: path.join(theme, 'content') };
    const r = classifyManagedTarget(inner, path.join(theme, 'content', 'posts', 'x.md'));
    expect(r?.root).toBe('content');
    expect(r?.rel).toBe('posts/x.md');
  });

  it('② 两个根之外 ⇒ null（调用方必须拒绝，不得静默跳过）', () => {
    expect(classifyManagedTarget(roots, path.join(os.tmpdir(), 'elsewhere', 'f.txt'))).toBeNull();
  });

  it('② contentRoot 为 null 时全部落到 theme 判定', () => {
    const onlyTheme = { themeRoot: theme, contentRoot: null };
    const r = classifyManagedTarget(onlyTheme, path.join(theme, 'content', 'a.md'));
    expect(r?.root).toBe('theme');
  });
});

describe('[跨根备份] resolveManifestEntryPath', () => {
  const theme = path.join(os.tmpdir(), 'res-theme');
  const repo = path.join(os.tmpdir(), 'res-repo');

  it('③ 无 root 标签 ⇒ 按 theme（存量备份语义）', () => {
    const r = resolveManifestEntryPath({ themeRoot: theme, contentRoot: null }, { path: 'src/data/a.ts' });
    expect(r).toEqual({ ok: true, abs: path.join(theme, 'src', 'data', 'a.ts') });
  });

  it('③ root=content 且内容根可用 ⇒ 落到内容仓', () => {
    const r = resolveManifestEntryPath(
      { themeRoot: theme, contentRoot: repo },
      { root: 'content', path: 'content/posts/a/index.md' },
    );
    expect(r).toEqual({ ok: true, abs: path.join(repo, 'content', 'posts', 'a', 'index.md') });
  });

  it('③ root=content 但内容根不可用 ⇒ content-root-unavailable', () => {
    const r = resolveManifestEntryPath(
      { themeRoot: theme, contentRoot: null },
      { root: 'content', path: 'content/posts/a.md' },
    );
    expect(r).toEqual({ ok: false, reason: 'content-root-unavailable' });
  });

  it('③ 主题根未初始化 ⇒ theme-root-uninitialized', () => {
    const r = resolveManifestEntryPath({ themeRoot: '', contentRoot: null }, { path: 'a.ts' });
    expect(r).toEqual({ ok: false, reason: 'theme-root-uninitialized' });
  });

  it('③ 拒绝各种逃逸形态（绝对路径 / .. / 空段 / 空串）', () => {
    const roots = { themeRoot: theme, contentRoot: repo };
    const bad = [
      '/etc/passwd',
      'C:/Windows/win.ini',
      'C:\\Windows\\win.ini',
      '../escape.txt',
      'a/../../b.txt',
      'a//b.txt',
      '',
    ];
    for (const p of bad) {
      expect(resolveManifestEntryPath(roots, { path: p }).ok, p).toBe(false);
    }
  });

  it('③ 反斜杠相对路径被归一化后正常解析', () => {
    const r = resolveManifestEntryPath(
      { themeRoot: theme, contentRoot: null },
      { path: 'src\\data\\a.ts' },
    );
    expect(r).toEqual({ ok: true, abs: path.join(theme, 'src', 'data', 'a.ts') });
  });
});

describe('[跨根备份] archiveSubPath — 归档布局', () => {
  it('④ 无标签 ⇒ 扁平（存量归档布局逐字节不变）', () => {
    expect(archiveSubPath({ path: 'src/content/posts/a.md' })).toBe('src/content/posts/a.md');
  });

  it('④ theme 标签 ⇒ theme/<rel>', () => {
    expect(archiveSubPath({ root: 'theme', path: 'src/data/a.ts' })).toBe('theme/src/data/a.ts');
  });

  it('④ content 标签 ⇒ content/<rel>', () => {
    expect(archiveSubPath({ root: 'content', path: 'posts/a.md' })).toBe('content/posts/a.md');
  });

  it('④ 混根时不会撞名：theme 侧的 content/a.md 与 content 侧的 a.md 落在不同位置', () => {
    const a = archiveSubPath({ root: 'theme', path: 'content/a.md' });
    const b = archiveSubPath({ root: 'content', path: 'a.md' });
    expect(a).not.toBe(b);
    expect(a).toBe('theme/content/a.md');
    expect(b).toBe('content/a.md');
  });

  it('⑤ manifest 条目本身不含绝对路径（只 root 标签 + 相对路径）', () => {
    const roots = { themeRoot: path.join(os.tmpdir(), 'leak-theme'), contentRoot: path.join(os.tmpdir(), 'leak-repo') };
    const cls = classifyManagedTarget(roots, path.join(roots.contentRoot, 'content', 'moments', 'm.md'));
    expect(cls).not.toBeNull();
    if (cls === null) return;
    const serialized = JSON.stringify({ path: cls.rel, root: cls.root });
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(serialized).not.toContain(os.tmpdir());
  });
});
