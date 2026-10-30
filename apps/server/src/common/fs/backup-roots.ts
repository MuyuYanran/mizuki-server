/**
 * [跨根备份/恢复] common/fs/backup-roots — 受管根命名空间（L0 单源，纯只读零写盘）
 *
 * [职责] 回答两个问题，且**只**回答这两个：
 *   ① 给定一个绝对路径，它属于哪个**受管根**（theme / content）、在该根内的相对路径是什么；
 *   ② 给定一个 manifest 条目（root 标签 + 相对路径），它现在应该落到盘的哪里。
 *
 * [为什么需要] 备份服务（`infra/backup`）此前的路径监狱只有**一个根**：`mizukiRoot`。
 * T4-4 之后 `posts` / `config` / `series` / `moments` 在内容分离下会写到**主题根之外**的
 * 内容仓，于是 `preWriteBackup` 会被 `safeJoin` 判越界而跳过 —— 「写盘无备份」。
 * 本文件把「受管根」从单根推广为**闭集双根**，从而在不放开任意绝对路径的前提下恢复备份能力。
 *
 * [为什么不搞任意绝对路径备份] 路径监狱（`common/security/safe-join`）是本项目唯一的
 * 合法路径入口。若为了备份而允许任意绝对路径，等于在**最该保守**的恢复通道上开一个任意写口子
 * ——一份被篡改的 manifest 就能往宿主机任意位置回灌文件。故只认**闭集**：
 *   - `theme`   = 主题根（`BackupOptions.mizukiRoot`）
 *   - `content` = 内容分离下解析出的**本地持久内容仓根**（仅 `external` + `path` 源时存在）
 * 闭集之外的路径一律**拒绝**（不是跳过、不是兜底）——调用方应据此明确报错。
 *
 * [content 根的唯一真源] 不重新解析清单，复用 `common/theme/content-source` 的
 * `resolveContentSource()`（L0 内部互导合法）。git 源 / `local` 模式 / 清单不支持 /
 * `mounts` 非法 / 路径不可解析 ⇒ **无 content 根**（返回 null），此时内容条目不可备份也不可恢复。
 *
 * [红线 6] 本文件返回的 `absRoot` 是绝对路径，**仅供后端内部使用**，绝不进任何响应体；
 * manifest 里只存 `root` 标签 + 相对路径，**永不存宿主机绝对路径**。
 *
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveContentSource } from '../theme/content-source';

/** 受管根标签（闭集；manifest 只存这两个值或省略） */
export type BackupRootTag = 'theme' | 'content';

/** 解析出的受管根集合（content 为 null ⇒ 当前无独立内容根） */
export interface ManagedRoots {
  /** 主题根绝对路径（未初始化时为空串） */
  themeRoot: string;
  /** 本地持久内容仓根绝对路径；`null` ⇒ local / git 源 / 配置不可解析 */
  contentRoot: string | null;
}

/** 条目→绝对路径的既有分类结果 */
export interface ClassifiedTarget {
  root: BackupRootTag;
  /** 在该根内的相对路径（POSIX 风格） */
  rel: string;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** 路径是否在 root 之内（`root` 为空串 ⇒ false；相等也算不在，因为要的是「根内的文件」） */
function isInside(root: string, target: string): boolean {
  if (root === '') return false;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 绝对路径 → 相对 root 的 POSIX 风格相对路径 */
function relPosix(root: string, target: string): string {
  return path.relative(path.resolve(root), path.resolve(target)).replace(/\\/g, '/');
}

/**
 * [跨根备份] 解析当前受管根集合。
 *
 * `contentRoot` 仅在**同时**满足以下全部条件时非 null：
 *   - `resolveContentSource(root).mode === 'external'`（内容分离生效）
 *   - `supported === true`（清单版本受支持）
 *   - `invalidMounts` 为空（挂载表可解析，不猜）
 *   - `source.type === 'path'`（git 源的工作副本随时被强检强清，备份它没有意义）
 *   - 解析出的目录**真实存在**（否则恢复时无从落盘）
 *
 * 任一条不满足 ⇒ `null`，调用方据此把内容类操作按「无 content 根」处理（拒绝 + 指路）。
 */
export function resolveManagedRoots(themeRoot: string): ManagedRoots {
  const theme = typeof themeRoot === 'string' ? themeRoot : '';
  if (theme === '' || !isDirectory(theme)) {
    return { themeRoot: theme, contentRoot: null };
  }

  const profile = resolveContentSource(theme);
  const usable =
    profile.mode === 'external' &&
    profile.supported &&
    profile.invalidMounts.length === 0 &&
    profile.source !== null &&
    profile.source.type === 'path' &&
    profile.contentRoot !== '' &&
    isDirectory(profile.contentRoot);

  return { themeRoot: theme, contentRoot: usable ? profile.contentRoot : null };
}

/**
 * [跨根备份] 把待备份的绝对路径分类到某个受管根。
 *
 * **判定顺序：content 优先，theme 次之**，这不是随意选择：
 * 默认形态下 `contentRoot = <themeRoot>/content`（**在主题根之内**），若先按 theme 判，
 * 内容仓的文件会被标成 theme 条目 —— 于是恢复时「内容仓已切走」这道闸门永远不会触发，
 * 会把内容文件回灌到用户已经改配置的代码仓位置。先判 content 才能保住闸门语义。
 *
 * @returns `null` ⇒ 不在任何受管根内（调用方必须**拒绝**，不得静默跳过）
 */
export function classifyManagedTarget(
  roots: ManagedRoots,
  targetAbs: string,
): ClassifiedTarget | null {
  if (roots.contentRoot !== null && isInside(roots.contentRoot, targetAbs)) {
    return { root: 'content', rel: relPosix(roots.contentRoot, targetAbs) };
  }
  if (isInside(roots.themeRoot, targetAbs)) {
    return { root: 'theme', rel: relPosix(roots.themeRoot, targetAbs) };
  }
  return null;
}

/** 解析 manifest 条目落点时的失败原因（取值固定，调用方据此选文案） */
export type ManifestPathFailure =
  /** 条目声明在 content 根，但当前配置下已无有效内容仓 */
  | 'content-root-unavailable'
  /** 主题根未初始化 */
  | 'theme-root-uninitialized'
  /** 相对路径本身非法（含 `..` / 绝对路径 / 空） */
  | 'rel-path-invalid';

export type ManifestPathResolution =
  | { ok: true; abs: string }
  | { ok: false; reason: ManifestPathFailure };

/**
 * [跨根恢复] 把 manifest 条目解析为**当前**应落盘的绝对路径（纯函数，不写盘）。
 *
 * 安全要点：`rel` 来自磁盘上的 manifest.json（**可被篡改**），故一律：
 *   ① 拒绝绝对路径与任何 `..` 段（不依赖 `safeJoin` 也能保证不逃逸）；
 *   ② 拼到根后**再校验一次**确实落在该根之内（纵深防御，防 Windows 盘符/UNC 之类怪形）。
 * 绝不使用 `path.resolve(root, rel)` 单靠一次判断——那是历史事故的常见来源。
 */
export function resolveManifestEntryPath(
  roots: ManagedRoots,
  entry: { root?: BackupRootTag; path: string },
): ManifestPathResolution {
  const tag: BackupRootTag = entry.root ?? 'theme';
  const rel = entry.path;

  if (typeof rel !== 'string' || rel.trim() === '') {
    return { ok: false, reason: 'rel-path-invalid' };
  }
  const normalized = rel.replace(/\\/g, '/');
  if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return { ok: false, reason: 'rel-path-invalid' };
  }
  if (normalized.split('/').some((segment) => segment === '..' || segment === '')) {
    return { ok: false, reason: 'rel-path-invalid' };
  }

  const base = tag === 'content' ? roots.contentRoot : roots.themeRoot;
  if (base === null) {
    return { ok: false, reason: tag === 'content' ? 'content-root-unavailable' : 'theme-root-uninitialized' };
  }
  if (base === '') {
    return { ok: false, reason: 'theme-root-uninitialized' };
  }

  const abs = path.join(path.resolve(base), ...normalized.split('/'));
  // 纵深防御：拼完再验一次（防平台怪形：盘符、UNC、8.3 短名等）
  if (!isInside(base, abs)) {
    return { ok: false, reason: 'rel-path-invalid' };
  }
  return { ok: true, abs };
}

/**
 * [跨根恢复] 归档内的产物子路径。
 *
 * 布局规则（**向后兼容是硬约束**）：
 * - 条目**无 root 标签**（存量备份、纯 theme 备份）⇒ 归档里就是 `<rel>`（**与历史完全一致**）；
 * - 条目**有 root 标签**（涉及内容根的新备份）⇒ 归档里是 `<root>/<rel>`。
 *
 * 为什么必须「要么全不标、要么全标」：若一次备份里 theme 条目走扁平、content 条目走
 * `content/` 子目录，那么 theme 侧一个恰好叫 `content/...` 的相对路径就会与 content 条目
 * **撞名**（两者归档到同一位置）。故调用方（`createFileBackup`）在**任一条目涉及内容根**时
 * 给**全部**条目打标签；纯 theme 备份则一个标签都不打，从而存量布局零变化。
 */
export function archiveSubPath(entry: { root?: BackupRootTag; path: string }): string {
  return entry.root === undefined
    ? entry.path
    : `${entry.root}/${entry.path}`;
}
