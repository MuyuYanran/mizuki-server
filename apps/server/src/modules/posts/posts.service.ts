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
  ForbiddenException,
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
  // [T4-3] Shirone 档写入口面 + null 删键集。⚠ **不是**构造面 schema：
  // 构造面带 19 个 .default() 与 1 个 .transform()，直接当写入口会把默认值物化进用户文件、
  // 并把 YAML 数字口令静默改写成字符串（逐条理由见该文件头）。
  SHIRONE_NULL_DELETE_KEYS,
  ShironePostFrontmatterWriteSchema,
} from '@mizuki/shared';
import { sha256Text } from '../../common/crypto/hash';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { toMizukiAbs } from '../../common/fs/mizuki-root';
import { assertImageUpload, type UploadedFileLike } from '../../common/http/uploaded-file';
import { logger } from '../../common/logger';
import { type ArticleStatus, deriveStatus, toArticleRow } from '../../common/markdown/article-row';
import { parseMarkdown, stringifyMarkdown } from '../../common/markdown/frontmatter';
import { type MagicFormat } from '../../common/security/magic-sniff';
// [T4-3] 主题档位现探：与 collections/registry.ts 同款（不注入 provider、不缓存）
// [T4-4] 逻辑路径 → 物理落点映射（local ⇒ 代码仓；external+path 源 ⇒ 内容仓）
import { resolveContentLogicalPath, resolveContentSubdirTarget } from '../../common/theme/content-source';
import { resolvePostsWriteTarget } from '../../common/theme/posts-write-target';
import { ThemeAdapter } from '../../common/theme/theme-adapter';
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
 * 23 个已知字段 + 未知字段原样保留（`.loose()`，zod 4 之前写作 `.passthrough()`）。
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
  .loose();

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

/** null 删键哨兵处理：浅拷贝后删除值为 null 的可删键（不原地修改入参，防共享引用污染）。
 * [T4-3] 删键集改为**参数化**（原来硬绑 `NULL_DELETE_KEYS`）：Mizuki 12 键 / Shirone 16 键，
 * 由 `postsFrontmatterFace()` 现探决定。语义零变化——同一循环、同一浅拷贝、同一「只删 null」。
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
 * [T4-3b → T4-4] 写盘前的**持久性闸门**（ADR-028 §21.7 / §25）。
 *
 * 【T4-3b 时的语义】内容分离下代码仓的 `src/content/posts` 是**物化副本**，
 * Shirone 档的 `content:sync` 用 `copyFileSync` + `prune` 默认 true ⇒ 写进去
 * 要么被裁剪删掉、要么被内容仓的版本覆盖。当时**没有**路径跟随能力，
 * 故 external 档一律拒绝，把「静默丢」变成「带指路牌的拒绝」。
 *
 * 【T4-4 起的语义】**外部 path 源已经能真正写入内容仓了**（`resolveContentLogicalPath`），
 * 故 external + path 源从「拒绝」升级为「放行 + 写入内容仓」。仍然拒绝的只剩三种
 * **结构性不可写**：
 *   - `content-source-git`：工作副本每次 sync 被 `checkout --force` + `clean -ffdx`；
 *   - `content-mount-disabled`：`mounts.content` 被显式关闭 ⇒ 该挂载点不参与同步，是死路；
 *   - `mounts-invalid` / `manifest-unsupported-version`：连真实落点都无法确定，不许猜。
 *
 * 【判据来源唯一】这里不再自己算，而是**复用** `resolveContentSubdirTarget(root, 'posts')`
 * —— 与 `resolveLogicalWrite` 消费同一个函数，两处判据不会劈叉（劈叉由
 * `resolveLogicalWrite` 的 error 分支兜底暴露）。
 *
 * 【为什么是 403 而不是 400/409】不是「请求体写错了」，也不是「和现有资源冲突」，
 * 而是**当前部署形态下这个操作不可能成功** —— 语义上「禁止在此落点写」。
 *
 * 【只拦写路径】`listPosts` / `getPost` / `scanPosts` / 导入**预览**一律不受影响。
 */
function assertPostsWritable(operation: string): void {
  const root = getAppConfig().mizukiRoot;

  // Mizuki 两档（legacy / HEAD）走 T4-3b 的判定：HEAD 是 junction 写穿，天然持久；
  // 只有它的两个早退子情形（sync 关闭 / 无内容目录）才拒绝。
  const target = resolvePostsWriteTarget(root);
  if (!target.ok && target.form !== 'shirone') {
    logger.warn(
      { operation, reason: target.reason, materialization: target.materialization },
      'posts 写入被拒绝：当前主题形态下写代码仓不持久',
    );
    throw new ForbiddenException({
      message: target.message,
      detail: { reason: target.reason, materialization: target.materialization, themeKind: target.form },
    });
  }
  if (target.ok) {
    for (const note of target.notes) {
      logger.warn({ operation, note }, 'posts 写入口径提醒');
    }
  }

  // [T4-4] Shirone 档：交给寻址底座 —— external + path 源**放行**，三种结构性不可写才拒
  const subdir = resolveContentSubdirTarget(root, 'posts');
  if (!subdir.ok) {
    logger.warn(
      { operation, reason: subdir.reason },
      'posts 写入被拒绝：内容源配置下无法确定安全落点',
    );
    throw new ForbiddenException({
      message: subdir.message,
      detail: { reason: subdir.reason },
    });
  }
}

/**
 * [T4-3] posts frontmatter「主题面」—— 当前主题档位对应的**唯一**写入口契约。
 *
 * [为什么需要这一层] T4-3 之前本模块把 `PostFrontmatterSchema` 当「唯一 schema」硬写在 5 个消费点上。
 * Shirone 档进入后，同一份文件面在三个维度上分叉：
 *   ① **写入口 schema**：Shirone 用 `posts-frontmatter-shirone-write.ts` 的**写入口面**，
 *      **不是** T4-2 那份构造面（构造面带 19 个 `.default()` + 1 个 `.transform()` + 必填
 *      `published: z.date()`；读写不对称——读路径走裸 `parseMarkdown`、写路径走 `parse()`，
 *      于是构造面当写入口会：把 19 个默认键**物化进用户文件**、把 `password: 12345` 静默改写成
 *      `"12345"`、把 `series` 剪缘、并用 `z.date()` 拒掉 YAML 里的字符串日期）；
 *   ② **null 删键集**：Mizuki 12 / Shirone 16（Shirone 独有 8 键在 Mizuki 面根本不存在）；
 *   ③ **可纳管扩展名**：Mizuki 仅 `.md`，Shirone 为 `.md` + `.mdx`。
 *
 * [不缓存] 主题可在运行期被替换（面板改 mizukiRoot / 用户换主题），每次调用现探——
 * 与 `collections/registry.ts` 的主题判档同款，不新增失效缓存这条失效面。
 *
 * [unknown 档兜底] 主题根缺失/非主题目录 ⇒ 能力面为 `unknown`（`extensions: []`、
 * `frontmatterSchemaId: ''`）。此时回落 **Mizuki 面 + `.md`**：本模块全部调用点都在 Mizuki
 * 行为上验证过，回落即「零行为变化」；若误用 Shirone 面，其必填 `published` 会在非 Shirone
 * 目录上凭空产生 400，属更坏的失败方式。
 */
interface PostsFrontmatterFace {
  schemaId: string;
  writeSchema: z.ZodType<Record<string, unknown>>;
  nullDeleteKeys: readonly string[];
  extensions: readonly string[];
}

function postsFrontmatterFace(): PostsFrontmatterFace {
  const appConfig = getAppConfig();
  const { capabilities } = new ThemeAdapter().resolve(appConfig.mizukiRoot, appConfig.mode);
  const { frontmatterSchemaId, extensions } = capabilities.posts;
  if (frontmatterSchemaId === 'shirone-posts') {
    return {
      schemaId: frontmatterSchemaId,
      writeSchema: ShironePostFrontmatterWriteSchema,
      nullDeleteKeys: SHIRONE_NULL_DELETE_KEYS,
      extensions: extensions.length > 0 ? extensions : ['.md'],
    };
  }
  return {
    schemaId: frontmatterSchemaId,
    writeSchema: PostFrontmatterSchema,
    nullDeleteKeys: NULL_DELETE_KEYS,
    extensions: extensions.length > 0 ? extensions : ['.md'],
  };
}

/**
 * [T4-3] 目录式 `index` 文件探测：按扩展名**优先级**（`.md` 先于 `.mdx`）取第一个存在的。
 * 两文件同时存在属用户侧歧义：按「先到先得」取 `.md` 并 warn（不静默、不报错），
 * 与 `scanPosts` 既有的「同名冲突目录式优先」同款处置口径。
 */
function findIndexFile(
  dirAbs: string,
  extensions: readonly string[],
): { name: string; fileAbs: string } | null {
  let picked: { name: string; fileAbs: string } | null = null;
  for (const ext of extensions) {
    const name = `index${ext}`;
    const fileAbs = path.join(dirAbs, name);
    if (!fs.existsSync(fileAbs)) {
      continue;
    }
    if (picked) {
      logger.warn(
        { dir: path.basename(dirAbs), picked: picked.name, ignored: name },
        '文章目录内 index 文件同名冲突（多扩展名）：按扩展名优先级取首个，请清理其余以消除歧义',
      );
      continue;
    }
    picked = { name, fileAbs };
  }
  return picked;
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
    // [T4-3b] 持久性闸门置于**最前**：连 slug 与 frontmatter 都还没校验就先拦，
    // 免得用户对着一条「frontmatter 校验失败」反复改，却在改对之后才发现根本写不进去。
    assertPostsWritable('createPost');
    const slug = validateSlug(body.slug);
    // [Phase4-D4/S5] description 可选（supersede B2.1/裁决 8，原「必填纵深防御」注释随
    // 写入口收紧一并拆除）；[Phase3-C1] 创建体中可删键为 null 等价于缺失（删除指令先于落盘）
    const face = postsFrontmatterFace();
    // [T4-3] 写入口改用**主题面**，并以 parseOrBadRequest 取代裸 `.parse()`：
    // 管道层已用 PostFrontmatterSchema（`.loose()`，接受任意 Shirone 键）验过一遍，
    // 此处失败只可能因为「主题面比管道更严」（Shirone 必填 published、seriesOrder 必须整数…）。
    // 裸 `.parse()` 会让这种失败抛 ZodError → 500；换 parseOrBadRequest → 400 + issues，
    // 与全仓错误形状一致。Mizuki 档两面同 schema ⇒ 行为逐位不变。
    const frontmatter = stripNullDeleteKeys(
      parseOrBadRequest(face.writeSchema, body.frontmatter, 'frontmatter 校验失败'),
      face.nullDeleteKeys,
    );
    const dirAbs = this.postDirAbs(slug);
    if (fs.existsSync(dirAbs)) {
      throw new ConflictException(`文章已存在：${slug}`);
    }
    // [Phase4-D4/B2] 文件形态同名占用同样构成 slug 冲突（slug 即身份，与盘上形态无关）；
    // [Phase4-D4f/F2] 双向检测：dir/file 两分支共用（存在同名目录或同名 .md 均 409）
    // [T4-3] 文件形态占用改为**按主题面全部扩展名**检测：Shirone 档 `.md` 与 `.mdx` 同为
    // 文件形态的合法盘上形态，只查 `.md` 会漏判 ⇒ 绕过 409 后在同一 slug 上出现两个文件。
    const occupiedExt = face.extensions.find((ext) => fs.existsSync(this.postFileFormAbs(slug, ext)));
    if (occupiedExt !== undefined) {
      throw new ConflictException(`文章已存在（文件形态）：${slug}`);
    }
    // [Wave-2/B2] 库内 slug 占用（富文本）必须在落盘前拦截，否则文件已写而索引插入失败
    await this.assertMarkdownSlugFree(slug);
    // [Phase4-D4f/F2] 形态分派：'file' → 单文件 posts/<slug>.md（同管线：safeJoin +
    // zod + preWriteBackup + 原子写 + post.changed/content.changed）；缺省 'dir' 原管线零变化
    // [T4-3] 创建的落盘扩展名**恒取面内首个**（Mizuki `.md` / Shirone 亦 `.md`）——即「新建默认 .md」，
    // 不做创建期扩展名开关（那属面板面 T6）；日后编辑既有 `.mdx` 一律**保留盘上原扩展名**。
    const createExt = face.extensions[0] ?? '.md';
    const isFileForm = body.form === 'file';
    // [T4-4] 创建是**写路径** ⇒ 用无降级的映射（写侧不许落回代码仓副本）
    const fileAbs = this.resolveLogicalWrite(
      isFileForm ? `${POSTS_REL_DIR}/${slug}${createExt}` : `${POSTS_REL_DIR}/${slug}/index.md`,
    );
    const relPath = isFileForm ? this.postFileFormRelPath(slug, createExt) : this.postRelFilePath(slug);
    if (!isFileForm) {
      fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
    }
    const text = stringifyPostMarkdown(frontmatter, body.content);
    await this.backupBeforePostWrite(fileAbs, `post create: ${slug}`); // 新文件 → 跳过（无物可备）
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
    // [T4-3b] 闸门在 `readPostOrThrow` **之前**：读文章本身安全，但若注定写不进去，
    // 让用户先看到「写不进」而不是先看到一篇内容、改完才被拒。
    assertPostsWritable('updatePost');
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
    // [T4-3] 写入口与删键集一律走**主题面**；写回定位 `existing.fileAbs` 本就带盘上原扩展名，
    // 故 `.mdx` 文章保存后**不会**被改写成 `.md`（扩展名只由 createPost 新建时决定）。
    const face = postsFrontmatterFace();
    const mergedRaw =
      body.frontmatter !== undefined ? { ...existing.frontmatter, ...body.frontmatter } : existing.frontmatter;
    const mergedFrontmatter = stripNullDeleteKeys(mergedRaw, face.nullDeleteKeys);
    const frontmatter = parseOrBadRequest(
      face.writeSchema,
      mergedFrontmatter,
      `frontmatter 校验失败（${slug}）`,
    );
    // [Phase4-D4/S5] 原此处的「PATCH description 拒空块」（B2.1/裁决 8）已随描述可选
    // 裁定拆除——空串现为合法存储值（p5b ② 锚钉版：PATCH description="" → 200 回读空）。
    const content = body.content ?? existing.content;

    // [Phase4-D4/C2] 写回定位：existing.fileAbs 由 resolvePostFile 产出（目录式 =
    // posts/<slug>/index.md，与原 postFileAbs(slug) 同值；文件式 = posts/<slug>.md）。
    const fileAbs = existing.fileAbs;
    await this.backupBeforePostWrite(fileAbs, `post update: ${slug}`);
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
    // [T4-3b] 删除同样受闸门约束：外部内容源下删代码仓副本没有意义（下次 sync 又回来），
    // 而在内容仓未接通前，一条「已删除」的成功回执会是彻底的谎言。
    assertPostsWritable('deletePost');
    const existing = this.readPostOrThrow(slug);
    const backupIds: string[] = [];

    if (existing.form === 'file') {
      // [Phase4-D4f/F3] 单文件分支：先备份后 unlink（先读哈希供删除事件）
      const fileHash = sha256Text(fs.readFileSync(existing.fileAbs, 'utf8'));
      const info = await this.backupBeforePostWrite(existing.fileAbs, `post delete: ${slug}`);
      if (info) {
        backupIds.push(info.id);
      }
      fs.unlinkSync(existing.fileAbs);

      await this.softDeleteArticleRow(slug);
      this.emitPostWrite(slug, existing.frontmatter, fileHash, true, existing.relPath);
      logger.info({ slug, backupIds }, '文章删除完成（单文件已备份，可恢复）');
      return { deleted: true, backupIds };
    }

    // [T4-3] 哈希取自 `existing.fileAbs`（原为 `postFileAbs(slug)` 恒指 `index.md`）：
    // 目录式 `.mdx` 文章在旧写法下会 ENOENT 抛 500，删不掉也报错不明。
    const fileHash = sha256Text(fs.readFileSync(existing.fileAbs, 'utf8'));
    const dirAbs = this.postDirAbs(slug);

    for (const name of fs.readdirSync(dirAbs)) {
      const abs = path.join(dirAbs, name);
      if (!fs.statSync(abs).isFile()) {
        continue;
      }
      const info = await this.backupBeforePostWrite(abs, `post delete: ${slug}`);
      if (info) {
        backupIds.push(info.id);
      }
    }
    fs.rmSync(dirAbs, { recursive: true, force: true });

    await this.softDeleteArticleRow(slug);
    // [T4-3] 事件路径投影改用 `existing.relPath`：原 `postRelFilePath(slug)` 恒指 `index.md`，
    // 对目录式 `.mdx` 文章会下发**错误**路径，订阅方（articles 索引）据此写错 filePath。
    this.emitPostWrite(slug, existing.frontmatter, fileHash, true, existing.relPath);
    logger.info({ slug, backupIds }, '文章删除完成（目录已备份，可恢复）');
    return { deleted: true, backupIds };
  }

  /**
   * 封面上传（P5 §3.4）：扩展名白名单 + sharp 可解码校验 + 大小上限（配置）
   *   → sharp 转 JPG（顺带去 EXIF）→ 原子写 cover.jpg → frontmatter.image 更新。
   */
  async uploadCover(slug: string, file: UploadedFileLike): Promise<PostView> {
    // [T4-3b] 封面上传会往目录里写 `cover.jpg` 并改 frontmatter ⇒ 同属写路径
    assertPostsWritable('uploadCover');
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
    await this.backupBeforePostWrite(coverAbs, `post cover: ${slug}`);
    this.atomicWrite(coverAbs, jpegBuffer);

    // frontmatter.image 更新（随同一次写管线落盘）
    // [T4-3] 这里**刻意不换主题面**：入参不是作者输入，而是**盘上既有内容**。用 Shirone 写入口面
    // （必填 published / seriesOrder 必须整数）去校验，会让「本来能跑的老文件」因一次封面上传变成
    // 400 —— 元操作不得引入新的校验闸门。此处只把**删键集**切到主题面，image 之外的键一个不动。
    const face = postsFrontmatterFace();
    const frontmatter = stripNullDeleteKeys(
      PostFrontmatterSchema.parse({ ...existing.frontmatter, image: 'cover.jpg' }),
      face.nullDeleteKeys,
    );
    // [T4-3] 写回定位改用 `existing.fileAbs`：原 `postFileAbs(slug)` 恒指 `index.md`，
    // 碰上目录式 `.mdx` 文章会在同目录**新建一个 index.md**（正文分身），属真写坏。
    const fileAbs = existing.fileAbs;
    await this.backupBeforePostWrite(fileAbs, `post cover(fm): ${slug}`);
    const text = stringifyPostMarkdown(frontmatter, existing.content);
    this.atomicWrite(fileAbs, text);

    const fileHash = sha256Text(text);
    const articleId = await this.upsertArticleRow(slug, frontmatter, fileHash, existing.relPath);
    this.emitPostWrite(slug, frontmatter, fileHash, false, existing.relPath);
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
      // [T4-3] 校验面随主题走：Shirone 档用写入口面 ⇒ 缺 `published` 的条目在此判 error。
      // 这是**有意收紧**——上游 Shirone 的 postsCollection 里 `published: z.date()` 必填，
      // 缺键的文件进仓后构建期即坏；在导入预览拦下比让用户构建失败更便宜。
      const frontmatterCheck = safeParseIssues(postsFrontmatterFace().writeSchema, mapping.frontmatter);
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
      // [T4-4] 读侧用逻辑映射（external ⇒ 内容仓；git ⇒ 降级代码仓副本），与 scanPosts 同源
      const fileAbs = this.resolveLogicalRead(post.relPath);
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
   * - 第一遍目录式：每个含 `index.<ext>` 的子目录即一篇文章（slug = 目录名）；
   * - 第二遍文件式（规则①）：每个 `<slug>.<ext>` 文件即一篇文章，slug = 文件名去扩展名 **直取**，
   *   禁二次 slugify（偏离官方命名即失配）；
   * - 同名冲突（规则②）：目录式优先，文件式跳过 + pino warn。
   * [T4-3] `<ext>` 为**主题面扩展名集**（Mizuki：`.md`；Shirone：`.md` + `.mdx`，按优先级排序）。
   */
  private scanPosts(): ScannedPost[] {
    // [T4-4] 扫描根随主题落点：external + path 源 ⇒ 内容仓（真源）；git 源 ⇒ 降级到代码仓副本
    const postsDirAbs = this.resolveLogicalRead(POSTS_REL_DIR);
    if (!fs.existsSync(postsDirAbs)) {
      return [];
    }
    // [T4-3] 扩展名随主题面（Mizuki `.md` / Shirone `.md`+`.mdx`）；盘上原扩展名一路带进 relPath，
    // 使 article.filePath / 事件 filePaths / 写回定位三处同源，再无第二个「恒 .md」的隐式假设。
    const { extensions } = postsFrontmatterFace();
    const posts: ScannedPost[] = [];
    const dirSlugs = new Set<string>();
    const fileSlugs = new Set<string>();
    const entries = fs.readdirSync(postsDirAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const indexFile = findIndexFile(path.join(postsDirAbs, entry.name), extensions);
      if (!indexFile) {
        continue;
      }
      dirSlugs.add(entry.name);
      const parsed = parseMarkdown(fs.readFileSync(indexFile.fileAbs, 'utf8'));
      posts.push({
        slug: entry.name,
        frontmatter: parsed.frontmatter,
        content: parsed.content,
        form: 'directory',
        fileAbs: indexFile.fileAbs,
        relPath: `${POSTS_REL_DIR}/${entry.name}/${indexFile.name}`,
      });
    }
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const ext = extensions.find((candidate) => entry.name.endsWith(candidate));
      if (ext === undefined) {
        continue;
      }
      const slug = entry.name.slice(0, -ext.length); // 规则①：去扩展名直取，禁二次 slugify
      if (slug === '') {
        continue;
      }
      if (dirSlugs.has(slug) || fileSlugs.has(slug)) {
        // 规则②：同名冲突目录式优先，文件式跳过 + warn（不静默、不报错）；
        // [T4-3] 新增第二条冲突面：同 slug 的 `.md` 与 `.mdx` 同时存在（Shirone 档才可能），
        // 按扩展名优先级取先到者，后来者跳过 + 同一 warn 处置。
        logger.warn(
          { slug, file: `${POSTS_REL_DIR}/${entry.name}` },
          '文章同名冲突：目录式 / 高优先级扩展名优先，本条跳过（请清理其一以消除歧义）',
        );
        continue;
      }
      fileSlugs.add(slug);
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
    // [T4-3] 目录式 index 文件与文件形态单文件**都**按主题面扩展名集探测：
    // 原实现硬写 `index.md` / `<slug>.md`，Shirone 档的 `.mdx` 文章会一律「不存在」（404），
    // 且 `.md` 分支的 relPath 走字面量拼接、与 scanPosts 的投影各写一份。
    const { extensions } = postsFrontmatterFace();
    const dirAbs = this.postDirAbs(validated);
    const indexFile = fs.existsSync(dirAbs) ? findIndexFile(dirAbs, extensions) : null;
    if (indexFile) {
      return {
        fileAbs: indexFile.fileAbs,
        form: 'directory',
        relPath: `${POSTS_REL_DIR}/${validated}/${indexFile.name}`,
      };
    }
    for (const ext of extensions) {
      const fileAbs = this.postFileFormAbs(validated, ext);
      if (fs.existsSync(fileAbs)) {
        return { fileAbs, form: 'file', relPath: `${POSTS_REL_DIR}/${validated}${ext}` };
      }
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

  /**
   * [T4-4 → 跨根备份] 写前备份。
   *
   * T4-4 时这里对「目标在主题根之外」做的是**跳过 + warn**，因为当时 `BackupService`
   * 的监狱只有单根。本轮 `infra/backup` 已升级为**闭集双根**（theme / content），
   * 内容仓文件同样有 `pre_write` 快照 ⇒ 本方法收窄为**纯转发**，不再有降级分支。
   *
   * 唯一仍需处理的边界：目标既不在主题根、也不在当前解析出的内容仓根内
   * （配置在**两次调用之间**被改掉，属竞态）。此时 `preWriteBackup` 会抛 400 ——
   * 让它抛：写盘无备份是数据安全缺口，必须让调用方知道，不得静默。
   */
  private async backupBeforePostWrite(
    abs: string,
    note: string,
  ): Promise<Awaited<ReturnType<BackupService['preWriteBackup']>>> {
    return this.backup.preWriteBackup(abs, note);
  }

  /**
   * root 内相对路径 → 绝对路径（未配置 400 / 越界 403，单源见 common/fs/mizuki-root）。
   * [T4-4] 保留给**非内容**路径（about 页不在 posts 路径跟随范围内）。
   */
  private resolveWithinRoot(rel: string): string {
    return toMizukiAbs(this.options.mizukiRoot, rel);
  }

  /**
   * [T4-4] **逻辑内容路径 → 物理绝对路径**（读侧，带降级）。
   *
   * 逻辑路径恒为 `src/content/...`（索引与事件口径不随部署漂移，见 content-source 的 [T4-4] 段）。
   * 物理落点由 `resolveContentLogicalPath` 映射：local ⇒ 代码仓；external+path 源 ⇒ 内容仓。
   *
   * **[读侧为什么要降级而不是拒绝]** git 源下映射会被拒（写必丢），但代码仓里的
   * `src/content/posts` **正是上次同步物化下来的副本** —— 读它完全安全且是唯一可读的。
   * 同理 `mounts` 写坏时也该尽量读出盘上现状，而不是把整个列表变成 403。
   * 唯一的代价是「读到的可能是陈旧副本」，由 `lastReadDegraded` 记录并在日志里可见。
   */
  private resolveLogicalRead(rel: string): string {
    const resolution = resolveContentLogicalPath(this.options.mizukiRoot, rel);
    if (resolution.ok) {
      return resolution.abs;
    }
    logger.warn(
      { rel, reason: resolution.reason },
      '文章逻辑路径映射被拒：读侧降级到代码仓物化副本（写侧仍会被闸门拒绝）',
    );
    return this.resolveWithinRoot(rel);
  }

  /**
   * [T4-4] **逻辑内容路径 → 物理绝对路径**（写侧，无降级）。
   *
   * 写侧不降级：降级写进代码仓副本正是 T4-3b 要拦的静默丢数据。
   * 走到这里时 `assertPostsWritable` 已经放行（两者消费同一个 `resolveContentSubdirTarget`），
   * 故映射理论上必成功；失败说明两处判据劈叉，属**编程错误**，直接 403 暴露而非静默。
   */
  private resolveLogicalWrite(rel: string): string {
    const resolution = resolveContentLogicalPath(this.options.mizukiRoot, rel);
    if (resolution.ok) {
      return resolution.abs;
    }
    logger.error(
      { rel, reason: resolution.reason },
      '文章写入路径映射失败：闸门已放行但映射被拒（判据劈叉，属缺陷）',
    );
    throw new ForbiddenException({
      message: `文章写入落点无法确定：${resolution.message}`,
      detail: { reason: resolution.reason },
    });
  }

  private postDirAbs(slug: string): string {
    return this.resolveLogicalRead(`${POSTS_REL_DIR}/${slug}`);
  }

  private postFileAbs(slug: string): string {
    return this.resolveLogicalRead(`${POSTS_REL_DIR}/${slug}/index.md`);
  }

  /** [Phase4-D4/B2] 文件形态绝对路径：<posts>/<slug><ext>（[T4-3] ext 由主题面注入，缺省 `.md`） */
  private postFileFormAbs(slug: string, ext = '.md'): string {
    return this.resolveLogicalRead(`${POSTS_REL_DIR}/${slug}${ext}`);
  }

  /** [Phase4-D4f/F2] 文件形态相对路径（POSIX 风格；与 scanPosts/resolvePostFile 投影同值） */
  private postFileFormRelPath(slug: string, ext = '.md'): string {
    return `${POSTS_REL_DIR}/${slug}${ext}`;
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
