/**
 * [阶段 P5] posts/posts.service — Markdown 文章读写与索引同步
 * [职责] 文章目录管理（创建/读取/修改/删除+恢复）、封面上传（sharp 转 JPG）、
 *   about 页读写、`article` 表 `source_type='markdown'` 索引同步（幂等）；
 *   写管线成功出口发射 post.changed / article.published / content.changed。
 * [Phase4-D4/B2] 扩文件形态：`<slug>.md` 单文件文章（规则① slug 去扩展名直取；
 *   ② 同名冲突目录式优先 + warn；filePath/filePaths 投影实际盘上路径）。
 * [Phase4-D4/C2] 编辑解除（supersede B2「只读」分派）：file-form 走与目录式相同
 *   的读写管线（写回定位 = resolvePostFile 既有产物）。
 * [Phase4-D4f/F2~F4] 全生命周期补齐（架构师授权 2026-09-08）：
 *   F2 创建支持（form 字段 'dir' 缺省 | 'file'，单文件同管线落盘 + slug 双向 409）；
 *   F3 删除解除（supersede B2 规则③：单文件备份 + unlink，backupIds 语义同目录删除）；
 *   F4 封面维持 400（文案改「单文件文章无同目录，请在 image 字段填写 public 路径或外链」）。
 * [状态] ACTIVE
 *
 * 纪律（P5 §3.3）：
 * - 所有 Mizuki 目录写入 = pre_write 备份 + 原子写（同目录临时文件 → rename），
 *   不得裸写覆盖；所有路径解析经 safeJoin（越界 → 403）；
 * - 删除先对文章目录逐文件备份再删目录（可经备份恢复回滚）；
 * - 禁止实现富文本（P8）；operation_log 表由 P6 拦截器接管，本阶段仅 pino 日志。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import {
  ArticlePublishedPayload,
  ContentChangedPayload,
  EVENTS,
  IMPORT_ALLOWED_EXTENSIONS,
  IMPORT_MAX_FILES,
  type ImportPreviewItem,
  type ImportPreviewResponse,
  ImportPreviewResponseSchema,
  PostChangedPayload,
  langCodeSchema,
} from '@mizuki/shared';
import { sha256Text } from '../../common/crypto/hash';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { toMizukiAbs } from '../../common/fs/mizuki-root';
import { assertImageUpload, type UploadedFileLike } from '../../common/http/uploaded-file';
import { logger } from '../../common/logger';
import { type ArticleStatus, deriveStatus, toArticleRow } from '../../common/markdown/article-row';
import { parseMarkdown, stringifyMarkdown } from '../../common/markdown/frontmatter';
import { type MagicFormat } from '../../common/security/magic-sniff';
import { parseOrBadRequest, safeParseIssues } from '../../common/validation/zod-issues';
import { singleSegmentName } from '../../common/validation/segment-name';
import { getAppConfig } from '../../config/app-config';
import { type BackupOptions, BACKUP_OPTIONS, BackupService } from '../../infra/backup/backup.service';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { article } from '../../infra/db/schema';

// ── zod schema（全部输入边界） ──

/** slug：目录名，禁止路径分隔符与 '..'（穿越最小拒绝面单源：common/validation/segment-name） */
export const PostSlugSchema = singleSegmentName({
  max: 200,
  separatorMessage: 'slug 不得包含路径分隔符',
  invalidMessage: 'slug 非法',
});

/**
 * frontmatter 字段（P5 §3.2 逐字 + Phase3-C1 扩展 + [Phase3-C5] lang + [U3-P2/A-GAP-09] 七键）：
 * 23 个已知字段 + 未知字段原样保留（passthrough）。
 * published ⚠ 类型以 Mizuki 为准（可能为日期），故放宽为 boolean | string | Date；
 * date/pubDate 允许 string 或 YAML 解析出的 Date。
 */
const DateLikeSchema = z.union([z.string(), z.date()]);

export const PostFrontmatterSchema = z
  .object({
    title: z.string(),
    published: z.union([z.boolean(), z.string(), z.date()]).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional(),
    author: z.string().optional(),
    // [Phase3-C1/决议 2] 四可删键（裁决级快照 permalink.md / press-key.md / twikoo.md）：
    // - encrypted/password：主题构建期客户端加密所用（bcryptjs 比对 + crypto-js 解密），
    //   Server 仅存储字段、不参与加密；
    // - comment:false：文章级禁用评论，缺失 = 继承全局 commentConfig.enable；
    // - permalink：主题构建期消费（相对 posts 构建路径生成固定链接），Server 不解析 URL；
    // - .nullable()：null 为删键哨兵（见 NULL_DELETE_KEYS / stripNullDeleteKeys），
    //   写入口合并后统一删除值为 null 的可删键（JSON 传输无法表达 undefined）。
    permalink: z.string().nullable().optional(),
    pinned: z.boolean().optional(),
    // [Phase4-D4 / A3] .nullable() 为 C1 null 删键哨兵的**入口通行**前提：
    //   写入口「parse 先于 strip」，null 若被 schema 拒则根本到不了 stripNullDeleteKeys。
    //   lang/draft 于本批纳入 NULL_DELETE_KEYS，故此处补齐可空性（裁定 §4 必核项）。
    draft: z.boolean().nullable().optional(),
    image: z.string().optional(),
    date: DateLikeSchema.optional(),
    pubDate: DateLikeSchema.optional(),
    encrypted: z.boolean().nullable().optional(),
    password: z.string().nullable().optional(),
    comment: z.boolean().nullable().optional(),
    // [Phase3-C5] lang：官方 frontmatter 可选字段（other-structure.md 快照示例 zh-CN，
    // C1 对齐疏漏收口，架构师 2026-08-29 裁决并入 C5）。语义：trim 剪缘空白；空串归一为
    // 未设置（= 站点默认）；BCP-47 简码字符集（字母数字 + 连字符分段）；max(16) 为有意
    // 取舍（'zh-Hant-TW' 等长组合可容，更长拒绝）；不做 enum 化（C2b 过度收窄教训）。
    // 写入口校验（合并整体校验/uploadCover）；读取/公开 API 直走 parseMarkdown 不受影响。
    // 注记：内层 .optional() 承接空串归一出的 undefined；外层 .optional() 使缺键可选
    // （提示词终行缺外层，缺键即 400——e2e ④ 捕获后补齐，语义与裁决意图一致）。
    // [Phase3-C7] 终行上收 shared langCodeSchema()（siteConfig.lang 共用同一裁决口径，
    // 引用不重写；字段面与校验语义零变化）。
    // [Phase4-D4 / A3] .nullable() 加在 posts 引用点而非 shared langCodeSchema() 内部：
    //   该函数被 ADR-013/ADR-020 锚为「引用不重写、语义冻结」的共享终行，
    //   可空性属 posts 写入口机制（C1 删键哨兵），故就地外挂、不动共享语义。
    lang: langCodeSchema().nullable(),
    // [U3-P2/K2] A-GAP-09：主题 content.config.ts 26 字段中面板/服务端此前未知的七键补齐
    //   （updated / priority / sourceLink / licenseName / licenseUrl / passwordHint / alias）。
    //   类型逐字对齐主题：updated 与 date/pubDate 同型（z.date() 可空缺省）；priority 为
    //   z.number()（主题无取值域，故不设 min/max）；其余五键 z.string()。prev* 四键在主题
    //   标注 "For internal use"（构建期回填，非作者字段），刻意不入 schema、不入表单。
    // .nullable() 同 C1/A3 口径：null 为删键哨兵（JSON 传输无法表达 undefined），
    //   parse 先于 strip，nullable 是删键指令的入口通行前提。
    // updated 刻意**不设**删键路径：与 date/pubDate 一致——空值不写键（面板 || undefined），
    //   PATCH 缺键保留存量，避免「清空日期即销毁元数据」的破坏面。
    updated: DateLikeSchema.optional(),
    priority: z.number().nullable().optional(),
    sourceLink: z.string().nullable().optional(),
    licenseName: z.string().nullable().optional(),
    licenseUrl: z.string().nullable().optional(),
    passwordHint: z.string().nullable().optional(),
    alias: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * [Phase4-D4/S5] description 放宽为可选（架构师裁定 supersede B2.1/裁决 8 = P5b，
 * 2026-09-04，授权随批提交 + commit 明文披露）。三层侦查后全链放宽：
 *   ① 写入口 schema（原 PostFrontmatterWriteSchema 对 description 的 trim/min(1)
 *      收紧——拆除，PostFrontmatterWriteSchema 不再存在）；
 *   ② updatePost PATCH 拒空块（拆除）；
 *   ③ 面板必填标记（PostEditPage descriptionError + required 标记，拆除）。
 * PostFrontmatterSchema.description 本就 optional；缺键创建与空串保存均为合法
 * 存储（p5b 双锚已语义翻转改写：①缺 description 创建 201 ②空串保存 200 回读空，
 * 锚数净 0）。读取/列表/sync/盘上存量语义零变化。
 */

/**
 * [Phase3-C1] 可删键集合（决议 2）：JSON 请求体无法表达 undefined，null 即删除指令。
 * [Phase4-D4 / A3] 增补 lang / draft：两者均为官方可选字段（lang 见 C5/C7 裁决、
 *   draft 见 press-file.md 快照），此前可写入但**无法经 API 删除**（null 被 schema 拒、
 *   且不在删键集合内），只能手工删行。增键影响面已核：本集合唯一消费者为
 *   下方 stripNullDeleteKeys，全仓 src 侧无其他引用，config 链（putLang 走 delete
 *   carrier.siteConfig.lang 独立机制）零副作用。
 * [U3-P2/K2] 增补 A-GAP-09 六键（alias / priority / passwordHint / licenseName /
 *   licenseUrl / sourceLink）：均为主题 content.config.ts 的可选字段，此前可经
 *   passthrough 写入但无法经 API 删除（面板清空后键留存，只能手工删行）。
 *   updated 不在此列——日期键沿用 date/pubDate 的「空值不写键」口径，无删键语义。
 * 仅这十二个键参与删键语义；其余字段（含 passthrough 自定义键）合并语义零变化。
 */
const NULL_DELETE_KEYS = [
  'encrypted',
  'password',
  'comment',
  'permalink',
  'lang',
  'draft',
  'alias',
  'priority',
  'passwordHint',
  'licenseName',
  'licenseUrl',
  'sourceLink',
] as const;

/** null 删键哨兵处理：浅拷贝后删除值为 null 的可删键（不原地修改入参，防共享引用污染） */
function stripNullDeleteKeys(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const result = { ...frontmatter };
  for (const key of NULL_DELETE_KEYS) {
    if (result[key] === null) {
      delete result[key];
    }
  }
  return result;
}

/**
 * POST /admin/posts body（[S5] description 可选，写入口与读取面同 schema）。
 * [Phase4-D4f/F2] 增可选 form 字段：'dir' 缺省（目录式 `<slug>/index.md`）|
 * 'file'（单文件 `<slug>.md`）——两形态共用 PostFrontmatterSchema（零改动）。
 */
export const CreatePostBodySchema = z.object({
  slug: PostSlugSchema,
  frontmatter: PostFrontmatterSchema,
  content: z.string(),
  form: z.enum(['dir', 'file']).optional(),
});

/** PATCH /admin/posts/:slug body（frontmatter 为增量合并，合并后整体过 schema） */
export const UpdatePostBodySchema = z
  .object({
    frontmatter: z.record(z.string(), z.unknown()).optional(),
    content: z.string().optional(),
  })
  .refine((value) => value.frontmatter !== undefined || value.content !== undefined, {
    message: 'frontmatter 与 content 至少提供一项',
  });

/** PUT /admin/about body */
export const UpdateAboutBodySchema = z.object({
  content: z.string(),
});

/** 封面上传扩展名白名单（P5 §3.4 最小版本；魔数嗅探以 sharp 可解码校验替代 → sniff:false） */
const COVER_EXTENSIONS: Record<string, MagicFormat> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
};

/** 封面允许格式清单文案（错误信息括号内全文，逐字保留 P5 原文） */
const COVER_ALLOWED_TEXT = 'jpg/jpeg/png/webp/gif';

/** 相对 Mizuki 根的固定路径（POSIX 风格，与 manifest/事件 filePaths 一致） */
const POSTS_REL_DIR = 'src/content/posts';
const ABOUT_REL_PATH = 'src/content/spec/about.md';

/** 对外文章视图 */
export interface PostView {
  slug: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * [Phase4-D4/B2] 盘上文章形态：目录式 `<posts>/<slug>/index.md`（官方 press-folder）与
 * 文件式 `<posts>/<slug>.md`（官方 press-file）。API 写入面（创建/修改/删除/封面）仅目录式；
 * 文件式 = 只读 + 索引同步（规则③④ 400 指引，见各方法内注记）。
 */
type PostForm = 'directory' | 'file';

/**
 * [Phase4-D4/S4/B2b] 对外形态标志（read/list 投影）：'dir' = 目录式、'file' = 文件式。
 * R1 注记：字面量枚举，零 URL/路径面（relPath/fileAbs 绝不外投）；
 * 与写面分派表③④同源（form → source 单向映射，form 为内部权威）。
 */
export type PostSource = 'dir' | 'file';

/** form（内部三态裁决值）→ source（对外投影值） */
function toSource(form: PostForm): PostSource {
  return form === 'directory' ? 'dir' : 'file';
}

/** 盘上扫描/解析结果（内部视图：PostView + 形态 + 相对路径投影源） */
interface ScannedPost extends PostView {
  form: PostForm;
  /** [Phase4-D4/C2] 盘上绝对路径（resolvePostFile 产出；updatePost 写回定位源） */
  fileAbs: string;
  /** 相对 mizukiRoot 的 .md 文件路径（POSIX 风格；article.filePath 与事件 filePaths 的投影源） */
  relPath: string;
}

/** sync 结果统计（pino 日志同步输出） */
export interface SyncResult {
  scanned: number;
  inserted: number;
  updated: number;
  softDeleted: number;
}

@Injectable()
export class PostsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly backup: BackupService,
    private readonly emitter: EventEmitter2,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── 文章 CRUD ──

  /** 文章列表（含 frontmatter 摘要 + 派生 status + [S4] source 形态标志），按 slug 升序 */
  listPosts(): (PostView & { status: ArticleStatus; source: PostSource })[] {
    return this.scanPosts().map(({ slug, frontmatter, content, form }) => ({
      slug,
      frontmatter,
      content,
      status: deriveStatus(frontmatter),
      source: toSource(form),
    }));
  }

  /** 读单篇（frontmatter + 正文 + [S4] source 形态标志）；不存在 → 404 */
  readPost(slug: string): PostView & { source: PostSource } {
    const parsed = this.readPostOrThrow(slug);
    return { slug, frontmatter: parsed.frontmatter, content: parsed.content, source: toSource(parsed.form) };
  }

  /**
   * 创建文章（[Phase4-D4f/F2] 增 form 分派：'dir' 缺省 | 'file'）：
   * 同名目录或同名 `.md` 任一存在 → 409（slug 即 URL 命名空间，两形态共享）；
   * 写入后经统一管线（备份 + 原子写），事件 filePaths 投影实际盘上形态路径。
   */
  async createPost(body: z.infer<typeof CreatePostBodySchema>): Promise<PostView> {
    const slug = validateSlug(body.slug);
    // [Phase4-D4/S5] description 可选（supersede B2.1/裁决 8，原「必填纵深防御」注释随
    // 写入口收紧一并拆除）；[Phase3-C1] 创建体中可删键为 null 等价于缺失（删除指令先于落盘）
    const frontmatter = stripNullDeleteKeys(PostFrontmatterSchema.parse(body.frontmatter));
    const dirAbs = this.postDirAbs(slug);
    if (fs.existsSync(dirAbs)) {
      throw new ConflictException(`文章已存在：${slug}`);
    }
    // [Phase4-D4/B2] 文件形态同名占用同样构成 slug 冲突（slug 即身份，与盘上形态无关）；
    // [Phase4-D4f/F2] 双向检测：dir/file 两分支共用（存在同名目录或同名 .md 均 409）
    const fileFormAbs = this.postFileFormAbs(slug);
    if (fs.existsSync(fileFormAbs)) {
      throw new ConflictException(`文章已存在（文件形态）：${slug}`);
    }
    // [Wave-2/B2] 库内 slug 占用（富文本）必须在落盘前拦截，否则文件已写而索引插入失败
    await this.assertMarkdownSlugFree(slug);
    // [Phase4-D4f/F2] 形态分派：'file' → 单文件 posts/<slug>.md（同管线：safeJoin +
    // zod + preWriteBackup + 原子写 + post.changed/content.changed）；缺省 'dir' 原管线零变化
    const isFileForm = body.form === 'file';
    const fileAbs = isFileForm ? fileFormAbs : this.postFileAbs(slug);
    const relPath = isFileForm ? this.postFileFormRelPath(slug) : this.postRelFilePath(slug);
    if (!isFileForm) {
      fs.mkdirSync(dirAbs, { recursive: true });
    }
    const text = stringifyPostMarkdown(frontmatter, body.content);
    await this.backup.preWriteBackup(fileAbs, `post create: ${slug}`); // 新文件 → 跳过（无物可备）
    this.atomicWrite(fileAbs, text);

    const fileHash = sha256Text(text);
    const articleId = await this.upsertArticleRow(slug, frontmatter, fileHash, relPath);
    this.emitPostWrite(slug, frontmatter, fileHash, false, relPath);
    if (deriveStatus(frontmatter) === 'published') {
      this.emitPublished(articleId, slug, frontmatter);
    }
    logger.info({ slug, status: deriveStatus(frontmatter), form: isFileForm ? 'file' : 'dir' }, '文章创建完成');
    return { slug, frontmatter, content: body.content };
  }

  /** 修改文章：frontmatter 增量合并后整体校验，正文缺省保留原值 */
  async updatePost(slug: string, body: z.infer<typeof UpdatePostBodySchema>): Promise<PostView> {
    const existing = this.readPostOrThrow(slug);
    // [Wave-2/B2] 库内 slug 占用守卫（落盘前；同 createPost）
    await this.assertMarkdownSlugFree(slug);
    // [Phase4-D4/C2] 文件形态编辑解除（产品裁定 supersede B2「文件形态 API 只读」分派，
    // 架构师授权 2026-09-08）：原 file-form 400 拒绝块拆除。file-form 走与目录式完全
    // 相同的读写管线，仅写回定位改用 resolvePostFile 既有产物 existing.fileAbs /
    // existing.relPath（file-form = posts/<slug>.md），杜绝原「写回落目录形态」的
    // 影子分叉（B2 拒绝的真实动因）。删除（规则③）与封面上传（规则④）拒绝保留。
    // [Phase3-C1] PATCH 删键语义（本批唯一合并规则变更，范围严格限四可删键）：
    // incoming 值为 null → 从合并结果删除该键（null 哨兵 = 删除指令，覆盖既有值）；
    // 非 null 行为不变；其余字段（含 passthrough 自定义键）合并语义零变化。
    const mergedRaw =
      body.frontmatter !== undefined ? { ...existing.frontmatter, ...body.frontmatter } : existing.frontmatter;
    const mergedFrontmatter = stripNullDeleteKeys(mergedRaw);
    const frontmatter = parseOrBadRequest(
      PostFrontmatterSchema,
      mergedFrontmatter,
      `frontmatter 校验失败（${slug}）`,
    ) as Record<string, unknown>;
    // [Phase4-D4/S5] 原此处的「PATCH description 拒空块」（B2.1/裁决 8）已随描述可选
    // 裁定拆除——空串现为合法存储值（p5b ② 锚钉版：PATCH description="" → 200 回读空）。
    const content = body.content ?? existing.content;

    // [Phase4-D4/C2] 写回定位：existing.fileAbs 由 resolvePostFile 产出（目录式 =
    // posts/<slug>/index.md，与原 postFileAbs(slug) 同值；文件式 = posts/<slug>.md）。
    const fileAbs = existing.fileAbs;
    await this.backup.preWriteBackup(fileAbs, `post update: ${slug}`);
    const text = stringifyPostMarkdown(frontmatter, content);
    this.atomicWrite(fileAbs, text);

    const fileHash = sha256Text(text);
    const articleId = await this.upsertArticleRow(slug, frontmatter, fileHash, existing.relPath);
    this.emitPostWrite(slug, frontmatter, fileHash, false, existing.relPath);
    if (deriveStatus(frontmatter) === 'published') {
      this.emitPublished(articleId, slug, frontmatter);
    }
    logger.info({ slug, status: deriveStatus(frontmatter) }, '文章修改完成');
    return { slug, frontmatter, content };
  }

  /**
   * 删除文章（[Phase4-D4f/F3] 删除解除，supersede D4c/C2 删除限制项，架构师授权
   * 2026-09-08）：file-form 走单文件删除分支（preWriteBackup 单文件 + unlink，
   * backupIds 语义同目录删除——可经备份恢复回滚）；目录形态原管线零变化。
   */
  async deletePost(slug: string): Promise<{ deleted: true; backupIds: string[] }> {
    const existing = this.readPostOrThrow(slug);
    const backupIds: string[] = [];

    if (existing.form === 'file') {
      // [Phase4-D4f/F3] 单文件分支：先备份后 unlink（先读哈希供删除事件）
      const fileHash = sha256Text(fs.readFileSync(existing.fileAbs, 'utf8'));
      const info = await this.backup.preWriteBackup(existing.fileAbs, `post delete: ${slug}`);
      if (info) {
        backupIds.push(info.id);
      }
      fs.unlinkSync(existing.fileAbs);

      await this.softDeleteArticleRow(slug);
      this.emitPostWrite(slug, existing.frontmatter, fileHash, true, existing.relPath);
      logger.info({ slug, backupIds }, '文章删除完成（单文件已备份，可恢复）');
      return { deleted: true, backupIds };
    }

    const fileHash = sha256Text(fs.readFileSync(this.postFileAbs(slug), 'utf8'));
    const dirAbs = this.postDirAbs(slug);

    for (const name of fs.readdirSync(dirAbs)) {
      const abs = path.join(dirAbs, name);
      if (!fs.statSync(abs).isFile()) {
        continue;
      }
      const info = await this.backup.preWriteBackup(abs, `post delete: ${slug}`);
      if (info) {
        backupIds.push(info.id);
      }
    }
    fs.rmSync(dirAbs, { recursive: true, force: true });

    await this.softDeleteArticleRow(slug);
    this.emitPostWrite(slug, existing.frontmatter, fileHash, true, this.postRelFilePath(slug));
    logger.info({ slug, backupIds }, '文章删除完成（目录已备份，可恢复）');
    return { deleted: true, backupIds };
  }

  /**
   * 封面上传（P5 §3.4）：扩展名白名单 + sharp 可解码校验 + 大小上限（配置）
   *   → sharp 转 JPG（顺带去 EXIF）→ 原子写 cover.jpg → frontmatter.image 更新。
   */
  async uploadCover(slug: string, file: UploadedFileLike): Promise<PostView> {
    const existing = this.readPostOrThrow(slug);
    // [Wave-2/B2] 库内 slug 占用守卫（落盘前；同 createPost）
    await this.assertMarkdownSlugFree(slug);
    // [Phase4-D4/B2] 规则④：文件形态无同名目录可存放 cover.jpg → 400 指引（守卫维持）。
    // [Phase4-D4f/F4] 文案修正：「单文件文章无同目录，请在 image 字段填写 public 路径或外链」
    if (existing.form === 'file') {
      throw new BadRequestException(
        `单文件文章无同目录，请在 image 字段填写 public 路径或外链：${slug}`,
      );
    }
    // 上传前三步校验单源（common/http/uploaded-file）：① 扩展名白名单 ② 大小上限；
    // 封面以 sharp 解码校验替代魔数嗅探（sniff:false，P5 §3.4 最小版本口径）
    assertImageUpload(file, {
      subject: '封面',
      allowedText: COVER_ALLOWED_TEXT,
      limitMb: getAppConfig().uploadLimitMb,
      extensions: COVER_EXTENSIONS,
      sniff: false,
    });
    let jpegBuffer: Buffer;
    try {
      jpegBuffer = await sharp(file.buffer).rotate().jpeg().toBuffer(); // 解码校验 + 转 JPG + 去 EXIF
    } catch {
      throw new BadRequestException('封面文件无法解码为图片（魔数校验失败）');
    }

    const coverAbs = path.join(this.postDirAbs(slug), 'cover.jpg');
    await this.backup.preWriteBackup(coverAbs, `post cover: ${slug}`);
    this.atomicWrite(coverAbs, jpegBuffer);

    // frontmatter.image 更新（随同一次写管线落盘）
    const frontmatter = PostFrontmatterSchema.parse({ ...existing.frontmatter, image: 'cover.jpg' });
    const fileAbs = this.postFileAbs(slug);
    await this.backup.preWriteBackup(fileAbs, `post cover(fm): ${slug}`);
    const text = stringifyPostMarkdown(frontmatter, existing.content);
    this.atomicWrite(fileAbs, text);

    const fileHash = sha256Text(text);
    const articleId = await this.upsertArticleRow(slug, frontmatter, fileHash, this.postRelFilePath(slug));
    this.emitPostWrite(slug, frontmatter, fileHash, false, this.postRelFilePath(slug));
    if (deriveStatus(frontmatter) === 'published') {
      this.emitPublished(articleId, slug, frontmatter);
    }
    logger.info({ slug, cover: 'cover.jpg' }, '封面写入完成（已转 JPG）');
    return { slug, frontmatter, content: existing.content };
  }

  // ── Markdown 通用导入（[U3-P4c/K1~K10] A-GAP-13 ★ 档） ──

  /**
   * [K1] 导入预览（`POST /admin/posts/import/preview`，multipart 字段 `files`）：
   * **纯解析、零落盘、零缓存、无会话态**（同一次请求内的批内 slug 自查除外）。
   *
   * 再裁 A（U3-P4c §0）：YAML 解析 / 键映射 / 校验全部在本方法内完成——浏览器只做
   * File → FormData 的搬运，不复制 YAML 边界口径（BOM / CRLF / 正文分隔线）。
   * 再裁 B：本端点**只读**；提交由面板逐条复用既有 `POST /admin/posts`（`createPost`），
   * 故此处不新增任何写盘路径，也不产生临时文件。
   * [K9] 服务端不信任预览：不缓存、不回查、不「记住」任何 preview 结果——提交阶段
   * 由 `POST /admin/posts` 的管道层完整重跑一遍 schema（无 TOCTOU 面）。
   * [K10] 导入不调用 `POST /admin/posts/sync`：`createPost` 已 upsert 索引并发事件。
   */
  async previewImport(files: UploadedFileLike[]): Promise<ImportPreviewResponse> {
    if (files.length === 0) {
      throw new BadRequestException('缺少上传文件（multipart 字段名：files）');
    }
    // [K2 ①] 服务端独立硬限（FilesInterceptor maxCount 已挡在 multer 层，此为纵深防御）
    if (files.length > IMPORT_MAX_FILES) {
      throw new BadRequestException(`单次导入文件数超限（最多 ${IMPORT_MAX_FILES} 个）`);
    }
    // [K4] 富文本 slug 占用面：一次查询取全量，批内逐条比对（与 createPost 落盘前守卫同源）
    const richTextSlugs = await this.richTextSlugs();
    const seen = new Set<string>();
    const items = files.map((file) => this.previewImportItem(file, richTextSlugs, seen));
    const summary = {
      total: items.length,
      ok: items.filter((item) => item.status === 'ok').length,
      conflict: items.filter((item) => item.status === 'conflict').length,
      error: items.filter((item) => item.status === 'error').length,
    };
    // [I5] 日志只记计数，绝不记 content / frontmatter 全文
    logger.info(summary, 'Markdown 导入预览完成');
    // 契约自校验（shared 单源）：响应形状漂移在此当场炸掉，而不是让面板静默失配
    return ImportPreviewResponseSchema.parse({ items, summary });
  }

  /** [K4] 库内 slug 占用的富文本集合（`article.slug` UNIQUE，富文本与 markdown 共用） */
  private async richTextSlugs(): Promise<Set<string>> {
    const rows = await this.db
      .select({ slug: article.slug })
      .from(article)
      .where(ne(article.sourceType, 'markdown'));
    return new Set(rows.map((row) => row.slug));
  }

  /**
   * [K3/K4] 单文件预览：扩展名 → 空文件 → 日期归一 → frontmatter 校验 → slug 校验
   * → 冲突四格（slug-taken / slug-taken-richtext / duplicate-in-batch / ok）。
   * 条目级校验一律走 `safeParseIssues`（**不抛**）：一个坏文件不得毁整批。
   */
  private previewImportItem(
    file: UploadedFileLike,
    richTextSlugs: Set<string>,
    seen: Set<string>,
  ): ImportPreviewItem {
    const allowed = IMPORT_ALLOWED_EXTENSIONS as readonly string[];
    // [I6] 路径安全：originalname 只用于展示与 slug 派生（basename 后绝无分隔符）
    const name = path.basename(file.originalname);
    const ext = path.extname(name).toLowerCase();
    const stem = ext === '' ? name : name.slice(0, -ext.length);
    const mapped = { renamed: [] as string[], derived: [] as string[], dropped: [] as string[] };
    const issues: ImportPreviewItem['issues'] = [];
    const base = { name, ext, slug: stem, form: 'dir' as const };

    if (!allowed.includes(ext)) {
      return {
        ...base,
        status: 'error',
        code: 'unsupported-extension',
        issues: [
          {
            level: 'error',
            path: 'name',
            message: `扩展名不在白名单：${ext === '' ? '(无)' : ext}（允许 ${allowed.join(' / ')}）`,
          },
        ],
        mapped,
        frontmatter: {},
        content: '',
      };
    }

    const text = file.buffer.toString('utf8');
    if (file.buffer.length === 0 || text.trim() === '') {
      return {
        ...base,
        status: 'error',
        code: 'empty-file',
        issues: [{ level: 'error', path: 'content', message: '文件为空（0 字节或全空白）' }],
        mapped,
        frontmatter: {},
        content: '',
      };
    }

    const parsed = (() => {
      try {
        return parseMarkdown(text);
      } catch {
        // [K4] YAML 语法错误也算「文件本身不可用」：单条 error，不得毁整批（一个坏文件
        // 抛 500 会让同批健康条目全部不可提交）。文案不回显异常正文（可能含文件内容）。
        return null;
      }
    })();
    if (parsed === null) {
      return {
        ...base,
        status: 'error',
        code: 'frontmatter-invalid',
        issues: [
          {
            level: 'error',
            path: 'frontmatter',
            message: 'frontmatter 无法解析（YAML 语法错误或分隔符不完整）',
          },
        ],
        mapped,
        frontmatter: {},
        content: '',
      };
    }
    const mapping = mapImportFrontmatter(parsed.frontmatter, stem, bareLocalDate(new Date()));
    mapped.renamed.push(...mapping.renamed);
    mapped.derived.push(...mapping.derived);
    mapped.dropped.push(...mapping.dropped);

    let status: ImportPreviewItem['status'] = 'ok';
    let code: ImportPreviewItem['code'];
    if (mapping.invalidDateKey !== undefined) {
      status = 'error';
      code = 'date-invalid';
      issues.push({
        level: 'error',
        path: mapping.invalidDateKey,
        message: '日期无法解析为 YYYY-MM-DD（支持日期对象、裸日期或可解析的日期串）',
      });
    } else {
      // [K4] 条目级校验：safeParseIssues 返回 Result，失败只影响本条
      const frontmatterCheck = safeParseIssues(PostFrontmatterSchema, mapping.frontmatter);
      if (!frontmatterCheck.ok) {
        status = 'error';
        code = 'frontmatter-invalid';
        issues.push(
          ...frontmatterCheck.issues.map((issue) => ({
            level: 'error' as const,
            path: issue.path,
            message: issue.message,
          })),
        );
      }
    }

    if (status === 'ok') {
      const slugCheck = safeParseIssues(PostSlugSchema, stem);
      if (!slugCheck.ok) {
        status = 'error';
        code = 'slug-invalid';
        issues.push(
          ...slugCheck.issues.map((issue) => ({
            level: 'error' as const,
            path: issue.path === '' ? 'slug' : `slug.${issue.path}`,
            message: issue.message,
          })),
        );
      }
    }

    if (status === 'ok') {
      // [K4] 冲突四格：盘上（目录式或单文件式）优先于库内富文本，最后才是批内重复
      if (fs.existsSync(this.postDirAbs(stem)) || fs.existsSync(this.postFileFormAbs(stem))) {
        status = 'conflict';
        code = 'slug-taken';
        issues.push({
          level: 'warn',
          path: 'slug',
          message: `slug 已被既有文章占用：${stem}（可改 slug，或先处理该文章）`,
        });
      } else if (richTextSlugs.has(stem)) {
        status = 'conflict';
        code = 'slug-taken-richtext';
        issues.push({
          level: 'warn',
          path: 'slug',
          message: `slug 已被富文本文章占用：${stem}（slug 全局唯一，请改 slug 或先删除该富文本文章）`,
        });
      } else if (seen.has(stem)) {
        status = 'conflict';
        code = 'duplicate-in-batch';
        issues.push({
          level: 'warn',
          path: 'slug',
          message: `同一批内 slug 重复：${stem}（仅首条可提交）`,
        });
      }
    }

    // 批内自查只登记「可能被提交」的 slug（error 条目不参与提交，不得毒化同批健康条目）
    if (status !== 'error') {
      seen.add(stem);
    }

    // [K3] description 缺不派生（主题 `default("")`）——仅提示；同批任何条目都追加在末尾，
    // 保证 schema 的字段级 issues 恒排在前面（前端口径：issues[0] 即首要修复点）
    if (mapping.frontmatter['description'] === undefined) {
      issues.push({
        level: 'warn',
        path: 'description',
        message: '未提供 description（主题默认空串，不自动派生）',
      });
    }

    const item: ImportPreviewItem = {
      ...base,
      status,
      issues,
      mapped,
      frontmatter: mapping.frontmatter,
      content: parsed.content,
    };
    return code === undefined ? item : { ...item, code };
  }

  // ── 索引同步 ──

  /**
   * 重建 article 表 source_type='markdown' 索引（P5 §3.6，幂等）：
   * - 磁盘有、表无 → insert；磁盘有、表有且哈希变化（或行处于软删态）→ update；
   * - 磁盘有、表有且哈希一致 → 零写入（第二次执行不产生任何写的依据）；
   * - 表有、磁盘无 → 标记 deleted_at（软删，回收站语义）。
   */
  async syncIndex(): Promise<SyncResult> {
    const diskPosts = this.scanPosts();
    const rows = await this.db
      .select()
      .from(article)
      .where(eq(article.sourceType, 'markdown'));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const diskSlugs = new Set<string>();
    // [Wave-2/B2] 库内被非 markdown 行占用的 slug：insert 会触发 UNIQUE 违约并中断
    // 整批同步。sync 属「对账」语义而非用户操作，故跳过 + pino warn（不抛错、
    // 不改响应形状）；用户可删除冲突的富文本文章后重新同步。
    const foreignSlugs = new Set(
      (
        await this.db
          .select({ slug: article.slug })
          .from(article)
          .where(ne(article.sourceType, 'markdown'))
      ).map((row) => row.slug),
    );

    let inserted = 0;
    let updated = 0;
    for (const post of diskPosts) {
      diskSlugs.add(post.slug);
      if (foreignSlugs.has(post.slug)) {
        logger.warn(
          { slug: post.slug },
          'sync 跳过：slug 已被富文本文章占用（slug 全局唯一，请删除其一后重新同步）',
        );
        continue;
      }
      // [Phase4-D4/B2] 哈希取实际盘上路径（文件形态 = <slug>.md，禁再走目录形态硬编码）
      const fileAbs = this.resolveWithinRoot(post.relPath);
      const fileHash = sha256Text(fs.readFileSync(fileAbs, 'utf8'));
      const values = toArticleRow(post.slug, post.frontmatter, fileHash, post.relPath);
      const existing = bySlug.get(post.slug);
      if (!existing) {
        await this.db.insert(article).values({ id: nanoid(), slug: post.slug, sourceType: 'markdown', ...values });
        inserted += 1;
      } else if (existing.fileHash !== fileHash || existing.deletedAt !== null) {
        await this.db.update(article).set({ ...values, deletedAt: null }).where(eq(article.id, existing.id));
        updated += 1;
      }
      // 哈希一致且未软删 → 零写入（幂等）
    }

    let softDeleted = 0;
    for (const row of rows) {
      if (!diskSlugs.has(row.slug) && row.deletedAt === null) {
        await this.db
          .update(article)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(article.id, row.id));
        softDeleted += 1;
      }
    }

    const result: SyncResult = { scanned: diskPosts.length, inserted, updated, softDeleted };
    logger.info(result, 'sync 执行完成');
    return result;
  }

  // ── about 页（REQUIREMENTS §6.11，P5 §3.5 补白） ──

  /** 读 about 原文；不存在 → 404 */
  readAbout(): { content: string } {
    const abs = this.aboutFileAbs();
    if (!fs.existsSync(abs)) {
      throw new NotFoundException('about 页尚未创建（PUT /admin/about 可创建）');
    }
    return { content: fs.readFileSync(abs, 'utf8') };
  }

  /** 写 about：pre_write 备份 + 原子写（覆盖不删除）；成功出口发射 content.changed(scope='about') */
  async writeAbout(content: string): Promise<{ content: string }> {
    const abs = this.aboutFileAbs();
    await this.backup.preWriteBackup(abs, 'about update');
    this.atomicWrite(abs, content);
    const payload = ContentChangedPayload.parse({ scope: 'about', filePaths: [ABOUT_REL_PATH] });
    this.emitter.emit(EVENTS.ContentChanged, payload);
    logger.info({ path: ABOUT_REL_PATH }, 'about 写入完成');
    return { content };
  }

  // ── 内部实现 ──

  /**
   * 扫描文章目录（[Phase4-D4/B2] 扩文件形态，双遍扫描按 slug 升序）：
   * - 第一遍目录式：每个含 index.md 的子目录即一篇文章（slug = 目录名）；
   * - 第二遍文件式（规则①）：每个 `.md` 文件即一篇文章，slug = 文件名去 `.md` **直取**，
   *   禁二次 slugify（偏离官方命名即失配）；
   * - 同名冲突（规则②）：目录式优先，文件式跳过 + pino warn。
   */
  private scanPosts(): ScannedPost[] {
    const postsDirAbs = this.resolveWithinRoot(POSTS_REL_DIR);
    if (!fs.existsSync(postsDirAbs)) {
      return [];
    }
    const posts: ScannedPost[] = [];
    const dirSlugs = new Set<string>();
    const entries = fs.readdirSync(postsDirAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const fileAbs = path.join(postsDirAbs, entry.name, 'index.md');
      if (!fs.existsSync(fileAbs)) {
        continue;
      }
      dirSlugs.add(entry.name);
      const parsed = parseMarkdown(fs.readFileSync(fileAbs, 'utf8'));
      posts.push({
        slug: entry.name,
        frontmatter: parsed.frontmatter,
        content: parsed.content,
        form: 'directory',
        fileAbs,
        relPath: `${POSTS_REL_DIR}/${entry.name}/index.md`,
      });
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }
      const slug = entry.name.slice(0, -3); // 规则①：去 .md 直取，禁二次 slugify
      if (slug === '') {
        continue;
      }
      if (dirSlugs.has(slug)) {
        // 规则②：同名冲突目录式优先，文件式跳过 + warn（不静默、不报错）
        logger.warn(
          { slug, file: `${POSTS_REL_DIR}/${entry.name}` },
          '文章同名冲突：目录式优先，文件式跳过（请清理其一以消除歧义）',
        );
        continue;
      }
      const fileAbs = path.join(postsDirAbs, entry.name);
      const parsed = parseMarkdown(fs.readFileSync(fileAbs, 'utf8'));
      posts.push({
        slug,
        frontmatter: parsed.frontmatter,
        content: parsed.content,
        form: 'file',
        fileAbs,
        relPath: `${POSTS_REL_DIR}/${entry.name}`,
      });
    }
    return posts.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /** 读单篇（含 slug 复核 + 存在性检查），不存在 → 404；[B2] 目录式优先、文件式回退 */
  private readPostOrThrow(slug: string): ScannedPost {
    const validated = validateSlug(slug);
    const resolved = this.resolvePostFile(validated);
    if (!resolved) {
      throw new NotFoundException(`文章不存在：${validated}`);
    }
    const parsed = parseMarkdown(fs.readFileSync(resolved.fileAbs, 'utf8'));
    return { slug: validated, frontmatter: parsed.frontmatter, content: parsed.content, ...resolved };
  }

  /**
   * [Phase4-D4/B2] slug → 盘上文件解析（读路径单一裁决点）：
   * 目录式优先（规则②），缺失时文件式回退；两者皆无 → null。
   */
  private resolvePostFile(validated: string): { fileAbs: string; form: PostForm; relPath: string } | null {
    const dirFileAbs = this.postFileAbs(validated);
    if (fs.existsSync(dirFileAbs)) {
      return { fileAbs: dirFileAbs, form: 'directory', relPath: this.postRelFilePath(validated) };
    }
    const fileFormAbs = this.postFileFormAbs(validated);
    if (fs.existsSync(fileFormAbs)) {
      return { fileAbs: fileFormAbs, form: 'file', relPath: `${POSTS_REL_DIR}/${validated}.md` };
    }
    return null;
  }

  /** 写入成功后 upsert 索引行（published 事件需要行 id；未入库的行先入库再发射）
   *
   * [Wave-2/B2] 查询必须限定 sourceType='markdown'：article.slug 为 UNIQUE 列，
   *   若同 slug 已被富文本行占用，原实现会落到 insert → SQLite UNIQUE 违约 →
   *   未捕获异常 → 500，且此时源文件已落盘（半成功）。占用情形改由
   *   assertMarkdownSlugFree 在写盘前拦截为 409（见 createPost/updatePost/uploadCover）。
   */
  private async upsertArticleRow(
    slug: string,
    frontmatter: Record<string, unknown>,
    fileHash: string,
    filePath: string,
  ): Promise<string> {
    const values = toArticleRow(slug, frontmatter, fileHash, filePath);
    const existing = await this.db
      .select()
      .from(article)
      .where(and(eq(article.slug, slug), eq(article.sourceType, 'markdown')));
    const row = existing[0];
    if (row) {
      await this.db.update(article).set({ ...values, deletedAt: null }).where(eq(article.id, row.id));
      return row.id;
    }
    const id = nanoid();
    await this.db.insert(article).values({ id, slug, sourceType: 'markdown', ...values });
    return id;
  }

  /**
   * [Wave-2/B2] slug 占用守卫：`article.slug` 为 UNIQUE 列且富文本与 markdown
   * 共用该列。markdown 侧此前只查文件系统不查库，导致「先建富文本同 slug 文章 →
   * 再建同 slug markdown 文章」必现 500 + 盘上残留孤儿文件。
   * 处置：任何 markdown 写入路径（创建/修改/封面上传）在**落盘之前**调用本守卫，
   * 占用即 409（对外错误码由 500 收敛为 409，属缺陷修复——原路径无成功语义）。
   */
  private async assertMarkdownSlugFree(slug: string): Promise<void> {
    const rows = await this.db
      .select({ id: article.id, sourceType: article.sourceType })
      .from(article)
      .where(eq(article.slug, slug));
    if (rows.some((row) => row.sourceType !== 'markdown')) {
      throw new ConflictException(
        `slug 已被富文本文章占用：${slug}（slug 全局唯一，请改用其他 slug 或先删除该富文本文章）`,
      );
    }
  }

  /** 删除文章 → 索引行软删（回收站语义；文件已备份可恢复） */
  private async softDeleteArticleRow(slug: string): Promise<void> {
    await this.db
      .update(article)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(article.slug, slug));
  }

  /** post.changed + content.changed(scope='post')：写入成功出口恰好一次，payload 先 parse；[B2] filePaths = 实际盘上形态路径 */
  private emitPostWrite(
    slug: string,
    frontmatter: Record<string, unknown>,
    fileHash: string,
    deleted: boolean,
    relPath: string,
  ): void {
    // [Wave-2/B1] filePath 随载荷下发：订阅方（articles）此前只能硬编码目录形态推导，
    // 文件形态（B2）文章会写错索引路径；删除事件无盘上路径可投影，故仅在未删除时携带。
    const postChanged = PostChangedPayload.parse({
      slug,
      frontmatter,
      fileHash,
      deleted,
      ...(deleted ? {} : { filePath: relPath }),
    });
    this.emitter.emit(EVENTS.PostChanged, postChanged);
    const contentChanged = ContentChangedPayload.parse({
      scope: 'post',
      filePaths: [relPath],
    });
    this.emitter.emit(EVENTS.ContentChanged, contentChanged);
  }

  /** article.published：文章进入已发布状态时发射（sourceType='markdown'） */
  private emitPublished(id: string, slug: string, frontmatter: Record<string, unknown>): void {
    const payload = ArticlePublishedPayload.parse({
      id,
      slug,
      sourceType: 'markdown',
      title: typeof frontmatter['title'] === 'string' ? frontmatter['title'] : slug,
    });
    this.emitter.emit(EVENTS.ArticlePublished, payload);
  }

  /**
   * 原子写：同目录临时文件 → rename 覆盖（P5 §3.3；与 P3 写管线第 7 步同款，
   * 单源实现见 common/fs/atomic-write）。
   * 这是统一写管线的组成部分（写前已完成 pre_write 备份），非裸写。
   * ensureDir 保留原实现的「目标目录自动创建」语义（about 页首次写入依赖）。
   */
  private atomicWrite(absPath: string, data: Buffer | string): void {
    atomicWriteFile(absPath, data, { ensureDir: true });
  }

  /** root 内相对路径 → 绝对路径（未配置 400 / 越界 403，单源见 common/fs/mizuki-root） */
  private resolveWithinRoot(rel: string): string {
    return toMizukiAbs(this.options.mizukiRoot, rel);
  }

  private postDirAbs(slug: string): string {
    return this.resolveWithinRoot(`${POSTS_REL_DIR}/${slug}`);
  }

  private postFileAbs(slug: string): string {
    return this.resolveWithinRoot(`${POSTS_REL_DIR}/${slug}/index.md`);
  }

  /** [Phase4-D4/B2] 文件形态绝对路径：<posts>/<slug>.md */
  private postFileFormAbs(slug: string): string {
    return this.resolveWithinRoot(`${POSTS_REL_DIR}/${slug}.md`);
  }

  /** [Phase4-D4f/F2] 文件形态相对路径（POSIX 风格；与 scanPosts/resolvePostFile 投影同值） */
  private postFileFormRelPath(slug: string): string {
    return `${POSTS_REL_DIR}/${slug}.md`;
  }

  /** [Phase4-D4/B2] 目录形态相对路径（POSIX 风格；article.filePath / 事件 filePaths 投影源） */
  private postRelFilePath(slug: string): string {
    return `${POSTS_REL_DIR}/${slug}/index.md`;
  }

  private aboutFileAbs(): string {
    return this.resolveWithinRoot(ABOUT_REL_PATH);
  }
}

// ── 纯工具 ──

/** slug 复核：非法 → 400（控制器管道已校验，此为纵深防御，保持错误形态一致） */
/**
 * [Phase4-D4/S3/B1b] posts 写路径序列化：published 官方形态 = YAML 裸日期
 * （yyyy-mm-dd 无引号；press-file.md 快照 L40-43 + 用户实测证据：裸日期可运行，
 * 面板改写曾引入引号回归——SESSIONS 记录）。
 * [U3-P2/K2] 同一口径扩至 updated：主题 content.config.ts 中 updated 亦为
 * z.date().optional()，带引号的 '2026-05-06' 会以 string 进 astro 校验而被拒
 * （js-yaml 对日期形态字符串恒加引号防 timestamp 误解析——不归一即埋构建期雷）。
 *
 * js-yaml 实证（gray-matter 4 / js-yaml 4，2026-09-04 灰盒）：
 *   - 字符串 '2026-01-02' → 恒带引号 `published: '2026-01-02'`（防 timestamp 误解析）；
 *   - Date 实例 → 恒输出完整 ISO `2026-01-02T00:00:00.000Z`（非裸日期）。
 * 两路皆得不到官方裸形态，故自拼：仅对 frontmatter 块内日期键整行归一——
 * 引号形剥离引号；parseMarkdown 对裸日期的解析产物（Date → UTC 零点 ISO 形）截断为
 * 日期段。其余时间形态与非零点值原样保留；正文区零触碰（仅处理首个 frontmatter 块，
 * 空 frontmatter 直返正文）。重读语义：裸日期经 js-yaml load 解析为 Date——与
 * frontmatter.ts 往返承诺「无引号日期 → Date」及主题/Astro 官方消费一致。
 */
const BARE_DATE_KEYS = ['published', 'updated'] as const;

function stringifyPostMarkdown(frontmatter: Record<string, unknown>, content: string): string {
  const text = stringifyMarkdown(frontmatter, content);
  if (Object.keys(frontmatter).length === 0 || !text.startsWith('---\n')) {
    return text;
  }
  const headEnd = text.indexOf('\n---\n');
  if (headEnd === -1) {
    return text;
  }
  const head = text.slice(4, headEnd);
  const rest = text.slice(headEnd);
  const keyPattern = BARE_DATE_KEYS.join('|');
  const quotedRe = new RegExp(`^(${keyPattern}): '(\\d{4}-\\d{2}-\\d{2})'$`);
  const isoRe = new RegExp(`^(${keyPattern}): (\\d{4}-\\d{2}-\\d{2})T00:00:00(?:\\.\\d+)?Z$`);
  const normalized = head
    .split('\n')
    .map((line) => {
      const quoted = quotedRe.exec(line);
      if (quoted !== null) {
        return `${quoted[1]}: ${quoted[2]}`;
      }
      const iso = isoRe.exec(line);
      if (iso !== null) {
        return `${iso[1]}: ${iso[2]}`;
      }
      return line;
    })
    .join('\n');
  return `---\n${normalized}${rest}`;
}

function validateSlug(slug: string): string {
  return parseOrBadRequest(PostSlugSchema, slug, 'slug 校验失败');
}

// ── [U3-P4c/K3] 导入映射（纯函数；写盘前最后一次可撤销时点，面板必须展示映射结果） ──

/** 服务器本地日期的裸 `YYYY-MM-DD` 形态（导入当日兜底；口径与 BARE_DATE_KEYS 一致） */
function bareLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * [K7] 日期归一：Date（YAML 裸日期解析产物 → UTC 零点）取 ISO 日期段；裸日期串校验
 * 真实性后原样；其余串先 `new Date()` 试解析、成功取**本地**日期段（无偏移串按本地
 * 解析，用 UTC 截断会整体前移一天），失败 → null（→ `date-invalid`）。
 */
function normalizeImportDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      // 形态合法 ≠ 日期真实（2025-13-45 / 2025-02-30 都要拒）
      const probe = new Date(`${trimmed}T00:00:00Z`);
      return !Number.isNaN(probe.getTime()) && probe.toISOString().slice(0, 10) === trimmed
        ? trimmed
        : null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : bareLocalDate(parsed);
  }
  return null;
}

/** [K3] 导入映射结果（四张表：改名 / 派生 / 删除 / 日期是否非法） */
interface ImportMappingResult {
  frontmatter: Record<string, unknown>;
  renamed: string[];
  derived: string[];
  dropped: string[];
  /** 日期源不可解析时所涉键（'published'）；undefined = 日期正常 */
  invalidDateKey?: string;
}

/**
 * [K3] frontmatter 映射表（**最小面**：两处改名 + 两处必要兜底，其余键含未知键原样）：
 * - `published` 三源取值（published 优先 → pubDate → date），归一为裸 `YYYY-MM-DD`；
 * - `pubDate` / `date` 无论是否被采用一律删除（主题 content.config.ts 无此二键）；
 * - `cover` 有而 `image` 缺 → 改名 `image`；两者都有 → 删 `cover`（`image` 为准）；
 * - `title` 缺 → 文件名 stem（**不 slugify**）；
 * - 三源全缺 → 导入当日（本地日期）；
 * - **不派生** description（主题 `optional().default("")`，缺省即空串）。
 * 否决「全量规范化」（tags 字符串切分 / category 取首 / 布尔归一）：没有一条有主题类型
 * 依据，全是猜测式改写用户内容，而导入是一次性、不可逆的动作。
 */
function mapImportFrontmatter(
  raw: Record<string, unknown>,
  fileStem: string,
  today: string,
): ImportMappingResult {
  const out: Record<string, unknown> = { ...raw };
  const renamed: string[] = [];
  const derived: string[] = [];
  const dropped: string[] = [];
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(out, key);

  // ① 日期三源：published 已有则以其为准（不再看 pubDate/date 的值）
  let published: unknown;
  if (has('published')) {
    published = out['published'];
  } else if (has('pubDate')) {
    published = out['pubDate'];
    renamed.push('pubDate→published');
  } else if (has('date')) {
    published = out['date'];
    renamed.push('date→published');
  }

  // ② 非契约日期键一律删除（值已取走 → 值不丢、键不留）
  for (const key of ['pubDate', 'date']) {
    if (has(key)) {
      delete out[key];
      dropped.push(key);
    }
  }

  let invalidDateKey: string | undefined;
  if (published === undefined) {
    out['published'] = today;
    derived.push('published');
  } else {
    const normalized = normalizeImportDate(published);
    if (normalized === null) {
      invalidDateKey = 'published';
      out['published'] = published; // 保留原值供面板展示；提交阶段 schema 会再拦一次
    } else {
      out['published'] = normalized;
    }
  }

  // ③ 封面改名（image 优先；两者都在 → 删 cover）
  if (has('cover')) {
    if (!has('image')) {
      out['image'] = out['cover'];
      renamed.push('cover→image');
    } else {
      dropped.push('cover');
    }
    delete out['cover'];
  }

  // ④ 标题兜底：文件名 stem（去扩展名直取，不 slugify、不做任何字符替换）
  if (!has('title') || out['title'] === undefined) {
    out['title'] = fileStem;
    derived.push('title');
  }

  return {
    frontmatter: out,
    renamed,
    derived,
    dropped,
    ...(invalidDateKey === undefined ? {} : { invalidDateKey }),
  };
}

// deriveStatus / toDateOrNull 已上收 common/markdown/article-row（单源）——
// ⚠️ ADR-025 的 published===false 兼容分支与 pino warn 一并迁至该文件，禁删。
