/**
 * [T5b-2] Shirone 内容集合（`series` / `moments`）读写服务
 *
 * [职责] 对 `<目标根>/<slug>.md` 做扁平扫描与 CRUD，**不进 `article` 统一索引**
 *        （dj 2026-10-30 裁定：两者的业务语义、字段结构、排序维度都与长文不同，
 *         塞进 article 表只会污染文章索引与搜索面；体量极小，纯文件扫描最干净、零 DB 迁移）。
 * [状态] ACTIVE
 *
 * ── 路径自第一天起对齐底座（T5b-1）────────────────────────────────────────────
 * 读写根一律来自 `resolveContentSubdirTarget(root, 'series'|'moments')`：
 *   - `local` 档 ⇒ `<themeRoot>/src/content/<subdir>`（代码仓即真源）
 *   - `external` + path 源 ⇒ `<contentRoot>/content/<subdir>`（内容仓，`needsSync: true`）
 * 监狱根随之**动态切换**：`safeJoin(该次解析出的 dirAbs, '<slug>.md')`，
 * 绝不是固定的 `src/content/<subdir>` —— 后者在 external 档会把文件写进一个会被
 * `content:sync` 裁掉的副本目录（ADR-028 §22.2 已逐行证明）。
 *
 * ── 拒绝语义（两条轴，不要混）──────────────────────────────────────────────
 * ① **主题不支持**（非 Shirone / 能力位 `contentCollections.supported === false`）
 *    ⇒ **404**：该集合在此主题下**根本不存在**，属「资源不存在」，不是「越权」。
 * ② **支持但落点被拒**（git 源 / `mounts.content` 被禁用 / `mounts` 非法 / 清单版本超限）
 *    ⇒ **403** + 指路牌：集合存在，但当前配置下这个落点不能安全读写。
 *
 * ── 读操作的唯一例外：git 源 ──────────────────────────────────────────────
 * git 源下**写必然丢失**（工作副本每次 sync 被 `checkout --force` + `clean -ffdx`），
 * 但**读**是安全的：工作副本里就是上次同步到的内容。故：
 *   - 写 ⇒ 403（`content-source-git`）
 *   - 读 ⇒ 回退读 `<themeRoot>/.content-src/content/<subdir>`（`WORKING_COPY_DIR`），
 *          只读、且响应带 `readOnly: true` 让调用方知道这不是可写落点。
 * 这比「读写全拒」更有用，也不会误导用户以为写进去能留住。
 * 其余拒绝原因（mounts 禁用 / mounts 非法 / 版本超限）**读写皆拒**：
 * 此时连「真实根在哪」都无法确定，展示一份可能是陈旧的副本比明确拒绝更坏。
 *
 * ── 备份 ────────────────────────────────────────────────────────────────
 * repo 红线 §4.1 要求写盘前置 `pre_write` 备份。但 `BackupService.preWriteBackup`
 * 的监狱根是 **mizukiRoot**（`joinWithinRoot` 越界抛 403）。内容仓在主题根之外时
 * （`CONTENT_DIR` 指向外部绝对路径）无法备份 —— 这是 T4-4 才彻底解决的架构约束
 * （见 ADR-028 §24），本批的处理是：
 *   - 目标在主题根内（**默认情形**：`<root>/content`、`<root>/.content-src`）⇒ 正常备份；
 *   - 目标在主题根外 ⇒ **跳过备份并 warn**（不静默），同时在响应里带 `backupSkipped: true`。
 * 内容的最终恢复通道是内容仓自身的 git 历史。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  MOMENTS_NULL_DELETE_KEYS,
  MOMENTS_REQUIRED_KEYS,
  SERIES_NULL_DELETE_KEYS,
  SERIES_REQUIRED_KEYS,
  SHIRONE_COLLECTION_EXTENSIONS,
  type ShironeCollectionSubdir,
  ShironeMomentsWriteSchema,
  ShironeSeriesWriteSchema,
} from '@mizuki/shared';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { logger } from '../../common/logger';
import { parseMarkdown, stringifyMarkdown } from '../../common/markdown/frontmatter';
import {
  resolveContentSubdirTarget,
  WORKING_COPY_DIR,
  type ContentSubdirRejected,
} from '../../common/theme/content-source';
import { ThemeAdapter } from '../../common/theme/theme-adapter';
import { singleSegmentName } from '../../common/validation/segment-name';
import { parseOrBadRequest } from '../../common/validation/zod-issues';
import { getAppConfig } from '../../config/app-config';
import { type BackupOptions, BACKUP_OPTIONS, BackupService } from '../../infra/backup/backup.service';

/** 单段 slug（无路径分隔符、非点段）；扩展名固定 `.md` ⇒ 用户输入的 slug **不含**扩展名 */
export const ContentSlugSchema = singleSegmentName({
  max: 200,
  separatorMessage: 'slug 不得包含路径分隔符',
  invalidMessage: 'slug 非法',
});

/** 唯一允许的扩展名（上游 `glob pattern: "**\/*.md"` ⇒ 仅 `.md`，无 `.mdx`） */
const ALLOWED_EXT = SHIRONE_COLLECTION_EXTENSIONS[0];

/** 集合档案：写入口面 schema + 删键集 + 必填键（单一映射表，禁止散落多处） */
interface CollectionSpec {
  subdir: ShironeCollectionSubdir;
  label: string;
  writeSchema: z.ZodType<Record<string, unknown>>;
  nullDeleteKeys: readonly string[];
  requiredKeys: readonly string[];
}

const COLLECTIONS: Readonly<Record<ShironeCollectionSubdir, CollectionSpec>> = Object.freeze({
  series: {
    subdir: 'series',
    label: '系列',
    writeSchema: ShironeSeriesWriteSchema,
    nullDeleteKeys: SERIES_NULL_DELETE_KEYS,
    requiredKeys: SERIES_REQUIRED_KEYS,
  },
  moments: {
    subdir: 'moments',
    label: '动态',
    writeSchema: ShironeMomentsWriteSchema,
    nullDeleteKeys: MOMENTS_NULL_DELETE_KEYS,
    requiredKeys: MOMENTS_REQUIRED_KEYS,
  },
});

/** 对外视图（与 posts 的 PostView 同形：slug + frontmatter + content） */
export interface ContentItemView {
  slug: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

/** 写操作附加元信息（面板据此提示「需要跑一次内容同步」） */
export interface ContentWriteMeta {
  /** 落点是否在内容仓（true ⇒ 必须跑一次内容同步才在主题里生效） */
  needsSync: boolean;
  /** 是否因目标在主题根之外而跳过了 pre_write 备份（见文件头「备份」段） */
  backupSkipped: boolean;
}

/** 列表项附加元信息 */
export interface ContentListResult {
  items: ContentItemView[];
  needsSync: boolean;
  inContentRepo: boolean;
  /** 读的是只读回退根（git 源的工作副本） */
  readOnly: boolean;
}

/** 本次操作解析出的读写根 */
interface ResolvedRoot {
  dirAbs: string;
  needsSync: boolean;
  inContentRepo: boolean;
  readOnly: boolean;
}

// ── 请求体 schema（全部输入边界） ──

export const CreateContentBodySchema = z.object({
  slug: ContentSlugSchema,
  frontmatter: z.record(z.string(), z.unknown()),
  content: z.string().optional(),
});

export const UpdateContentBodySchema = z.object({
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  content: z.string().optional(),
});

/**
 * null 删键处理：浅拷贝后删除值为 null 的可删键。
 * 与 `posts.service.ts` 的同名函数**语义完全一致**（同一循环、同一浅拷贝、同一「只删 null」），
 * 但删键集由集合档案注入 —— 两个模块各持自己那份集合，不互相 import（L2 禁互导）。
 */
function stripNullDeleteKeys(
  frontmatter: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const result = { ...frontmatter };
  for (const key of keys) {
    if (result[key] === null) {
      delete result[key];
    }
  }
  return result;
}

/**
 * [跨根备份] 原先此处有 `isInsideRoot()`（判断目标是否在主题根内，决定备份是否跳过）。
 * `BackupService` 双根化后「目标属于哪个受管根」由 L0 的 `classifyManagedTarget()` 统一回答，
 * 本服务不再需要自己判根（两处判根 = 事故来源），故删除。
 */

@Injectable()
export class ShironeContentService {
  constructor(
    private readonly backup: BackupService,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── 公共入口 ──

  list(kind: ShironeCollectionSubdir): ContentListResult {
    const spec = COLLECTIONS[kind];
    const resolved = this.resolveReadRoot(kind);
    const dirAbs = resolved.dirAbs;
    const items: ContentItemView[] = [];
    if (fs.existsSync(dirAbs)) {
      for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(ALLOWED_EXT)) continue;
        const slug = entry.name.slice(0, -ALLOWED_EXT.length);
        if (slug === '') continue;
        const abs = path.join(dirAbs, entry.name);
        const parsed = parseMarkdown(fs.readFileSync(abs, 'utf8'));
        items.push({ slug, frontmatter: parsed.frontmatter, content: parsed.content });
      }
    }
    items.sort((a, b) => a.slug.localeCompare(b.slug));
    logger.info(
      { kind: spec.subdir, count: items.length, inContentRepo: resolved.inContentRepo },
      `${spec.label}列表读取完成`,
    );
    return {
      items,
      needsSync: resolved.needsSync,
      inContentRepo: resolved.inContentRepo,
      readOnly: resolved.readOnly,
    };
  }

  read(kind: ShironeCollectionSubdir, slugInput: string): ContentItemView {
    const spec = COLLECTIONS[kind];
    const slug = parseOrBadRequest(ContentSlugSchema, slugInput, 'slug 校验失败');
    const resolved = this.resolveReadRoot(kind);
    const abs = this.itemAbs(resolved.dirAbs, slug);
    if (!fs.existsSync(abs)) {
      throw new NotFoundException(`${spec.label}不存在：${slug}`);
    }
    const parsed = parseMarkdown(fs.readFileSync(abs, 'utf8'));
    return { slug, frontmatter: parsed.frontmatter, content: parsed.content };
  }

  async create(
    kind: ShironeCollectionSubdir,
    body: z.infer<typeof CreateContentBodySchema>,
  ): Promise<ContentItemView & ContentWriteMeta> {
    const spec = COLLECTIONS[kind];
    const slug = parseOrBadRequest(ContentSlugSchema, body.slug, 'slug 校验失败');
    const resolved = this.resolveWriteRoot(kind);
    const abs = this.itemAbs(resolved.dirAbs, slug);
    if (fs.existsSync(abs)) {
      throw new ConflictException(`${spec.label}已存在：${slug}`);
    }
    // 写入口面校验 → null 删键 → 落盘（顺序不可变：parse 先于 strip，null 才到得了 strip）
    const frontmatter = stripNullDeleteKeys(
      parseOrBadRequest(spec.writeSchema, body.frontmatter, 'frontmatter 校验失败'),
      spec.nullDeleteKeys,
    );
    const content = body.content ?? '';
    const backupSkipped = await this.backupBeforeWrite(abs, `${kind} create: ${slug}`);
    this.atomicWrite(abs, stringifyMarkdown(frontmatter, content));
    logger.info({ kind, slug, needsSync: resolved.needsSync }, `${spec.label}创建完成`);
    return { slug, frontmatter, content, needsSync: resolved.needsSync, backupSkipped };
  }

  async update(
    kind: ShironeCollectionSubdir,
    slugInput: string,
    body: z.infer<typeof UpdateContentBodySchema>,
  ): Promise<ContentItemView & ContentWriteMeta> {
    const spec = COLLECTIONS[kind];
    const slug = parseOrBadRequest(ContentSlugSchema, slugInput, 'slug 校验失败');
    const resolved = this.resolveWriteRoot(kind);
    const abs = this.itemAbs(resolved.dirAbs, slug);
    if (!fs.existsSync(abs)) {
      throw new NotFoundException(`${spec.label}不存在：${slug}`);
    }
    const existing = parseMarkdown(fs.readFileSync(abs, 'utf8'));
    const mergedRaw =
      body.frontmatter !== undefined
        ? { ...existing.frontmatter, ...body.frontmatter }
        : existing.frontmatter;
    const frontmatter = parseOrBadRequest(
      spec.writeSchema,
      stripNullDeleteKeys(mergedRaw, spec.nullDeleteKeys),
      `frontmatter 校验失败（${slug}）`,
    );
    const content = body.content ?? existing.content;
    const backupSkipped = await this.backupBeforeWrite(abs, `${kind} update: ${slug}`);
    this.atomicWrite(abs, stringifyMarkdown(frontmatter, content));
    logger.info({ kind, slug }, `${spec.label}修改完成`);
    return { slug, frontmatter, content, needsSync: resolved.needsSync, backupSkipped };
  }

  async remove(
    kind: ShironeCollectionSubdir,
    slugInput: string,
  ): Promise<{ deleted: true; backupIds: string[]; needsSync: boolean; backupSkipped: boolean }> {
    const spec = COLLECTIONS[kind];
    const slug = parseOrBadRequest(ContentSlugSchema, slugInput, 'slug 校验失败');
    const resolved = this.resolveWriteRoot(kind);
    const abs = this.itemAbs(resolved.dirAbs, slug);
    if (!fs.existsSync(abs)) {
      throw new NotFoundException(`${spec.label}不存在：${slug}`);
    }
    const backupIds: string[] = [];
    // [跨根备份] 内容仓文件现在也能 pre_write 备份（`BackupService` 已双根化）
    const info = await this.backup.preWriteBackup(abs, `${kind} delete: ${slug}`);
    if (info) backupIds.push(info.id);
    fs.unlinkSync(abs);
    logger.info({ kind, slug, backupIds }, `${spec.label}删除完成`);
    return { deleted: true, backupIds, needsSync: resolved.needsSync, backupSkipped: false };
  }

  // ── 根部解析（读写分轴：读有 git 回退、写没有） ──

  /**
   * 读根：主题不支持 ⇒ 404；落点被拒时，**仅 git 源**回退到工作副本只读，
   * 其余原因一并拒绝（理由见文件头「读操作的唯一例外」）。
   */
  private resolveReadRoot(kind: ShironeCollectionSubdir): ResolvedRoot {
    this.assertThemeSupports();
    const root = getAppConfig().mizukiRoot;
    const target = resolveContentSubdirTarget(root, kind);
    if (target.ok) {
      return {
        dirAbs: target.dirAbs,
        needsSync: target.needsSync,
        inContentRepo: target.inContentRepo,
        readOnly: false,
      };
    }
    if (target.reason === 'content-source-git') {
      // 工作副本里就是上次同步到的内容 —— 读是安全的（写不）。
      const workingCopy = path.join(root, WORKING_COPY_DIR, 'content', kind);
      logger.info(
        { kind, fallback: 'content-working-copy' },
        `${COLLECTIONS[kind].label}读取：git 源 ⇒ 只读回退到内容工作副本`,
      );
      return { dirAbs: workingCopy, needsSync: false, inContentRepo: true, readOnly: true };
    }
    throw this.rejectToHttp(target);
  }

  private resolveWriteRoot(kind: ShironeCollectionSubdir): ResolvedRoot {
    this.assertThemeSupports();
    const root = getAppConfig().mizukiRoot;
    const target = resolveContentSubdirTarget(root, kind);
    if (!target.ok) throw this.rejectToHttp(target);
    return {
      dirAbs: target.dirAbs,
      needsSync: target.needsSync,
      inContentRepo: target.inContentRepo,
      readOnly: false,
    };
  }

  /** 主题不支持该集合 ⇒ 404（「资源不存在」，不是「越权」） */
  private assertThemeSupports(): void {
    const appConfig = getAppConfig();
    const profile = new ThemeAdapter().resolve(appConfig.mizukiRoot, appConfig.mode);
    if (!profile.capabilities.contentCollections.supported) {
      throw new NotFoundException({
        message:
          '当前主题不支持该内容集合：series / moments 是 Shirone 主题独有的内容集合，当前主题档位没有这个概念。下一步：把主题根指向 Shirone 主题目录，或改用对应主题支持的集合（如 Markdown 文章）。',
        detail: { kind: profile.kind, supported: false },
      });
    }
  }

  /** 落点被拒 ⇒ 403 + 指路牌（message 已在 L0 单源里写好且零绝对路径） */
  private rejectToHttp(target: ContentSubdirRejected): ForbiddenException {
    logger.warn(
      { reason: target.reason },
      '内容集合读写被拒绝：当前内容源配置下无法确定安全落点',
    );
    return new ForbiddenException({
      message: target.message,
      detail: { reason: target.reason },
    });
  }

  // ── 落盘 ──

  /** slug → `<dirAbs>/<slug>.md`（`slug` 已过单段校验；此处再叠一层 safeJoin 语义断言） */
  private itemAbs(dirAbs: string, slug: string): string {
    const abs = path.join(dirAbs, `${slug}${ALLOWED_EXT}`);
    // 纵深防御：即使插值后也必须在 dirAbs 之内（slug 校验已挡住 '../'，此处是第二道）
    const rel = path.relative(path.resolve(dirAbs), path.resolve(abs));
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ForbiddenException('路径越界：目标不在内容集合目录内');
    }
    return abs;
  }

  /**
   * [跨根备份] 写前备份 —— 纯转发。
   *
   * T4-3b/T5b-2 时这里对「目标在主题根之外」做跳过 + `backupSkipped: true`，因为
   * `BackupService` 当时只有单根监狱。本轮它已升级为**闭集双根**（theme / content），
   * 内容仓文件同样有 `pre_write` 快照 ⇒ 不再有降级分支，`backupSkipped` 恒为 false。
   *
   * 保留该字段（而不是删掉）的理由：它是**对外的响应契约**，面板已按它渲染提示；
   * 契约值恒 false 比删字段更稳（老前端不会因缺字段报错，新前端也不会误报）。
   */
  private async backupBeforeWrite(abs: string, note: string): Promise<boolean> {
    await this.backup.preWriteBackup(abs, note);
    return false;
  }

  /** 原子写（同目录临时文件 → rename）；`ensureDir` 保留「目标目录自动创建」语义 */
  private atomicWrite(absPath: string, data: string): void {
    atomicWriteFile(absPath, data, { ensureDir: true });
  }
}
