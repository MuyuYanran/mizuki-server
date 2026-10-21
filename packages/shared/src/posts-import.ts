/**
 * [U3-P4c/K5] shared/posts-import — Markdown 通用导入预览契约（A-GAP-13 ★ 档）
 * [职责] 导入预览（只读端点 `POST /admin/posts/import/preview`）的**响应契约**与
 *   **三道上限常量**单源：
 *   ① 服务端（apps/server/src/modules/posts）用它构造/自校验响应；
 *   ② 面板（apps/web）用它做「选文件阶段」的本地预检与零本地类型复制（U3-P4a/K3 同款纪律）。
 * [状态] ACTIVE
 *
 * 再裁 A（U3-P4c §0）：YAML 解析 / 键映射 / 校验全部在服务端（gray-matter 唯一解析面）；
 *   本文件只描述**结果**，不含任何解析逻辑，也不含任何「只收已解析 JSON」的入口——
 *   浏览器只做 File → FormData 的搬运。
 *
 * 再裁 B：提交阶段零新端点。`frontmatter` + `content` 随预览回传，面板逐条复用既有
 *   `POST /admin/posts`；故本契约必须携带这两段（浏览器不得自行切 YAML）。
 *
 * 纪律：本文件只放常量、schema 与纯类型（与 shared 其余文件同规），不引入任何 IO。
 */
import { z } from 'zod';

/**
 * [K2 ①] 单次导入文件数上限：30。
 * 依据是全局限流 60 次/分钟/IP（`apps/server/src/app.module.ts`）：一次导入最多
 * 1 次 preview + 30 次 create = 31 次请求，留 29 次余量给面板其它请求。
 * 面板在选文件阶段据此拒绝（不进网络）；服务端另有独立的 FilesInterceptor maxCount。
 */
export const IMPORT_MAX_FILES = 30;

/**
 * [K2 ②] 单文件字节上限：65536（UTF-8）。由 multer `limits.fileSize` 在请求层执行
 * （超出 → 413，见 e2e p5g 上限例），本常量同时供面板预检复用。
 */
export const IMPORT_MAX_FILE_BYTES = 65536;

/** [K2 ③] 扩展名白名单（大小写不敏感；比对前统一小写） */
export const IMPORT_ALLOWED_EXTENSIONS = ['.md', '.markdown'] as const;

/** 映射变更徽标：改名（`pubDate→published` / `cover→image`） */
export const IMPORT_MAPPED_KINDS = ['renamed', 'derived', 'dropped'] as const;

/**
 * [K4] 逐条状态与错误码。
 * - `ok` / `conflict` / `error` 三态：冲突是「可换 slug 解决」，错误是「文件本身不可用」；
 * - `duplicate-in-batch` 仅对**同批第 2 条起**的重复 slug 生效（首条仍按自身情形判定）。
 */
export const ImportPreviewStatusSchema = z.enum(['ok', 'conflict', 'error']);
export const ImportPreviewCodeSchema = z.enum([
  'unsupported-extension',
  'empty-file',
  'frontmatter-invalid',
  'date-invalid',
  'slug-invalid',
  'slug-taken',
  'slug-taken-richtext',
  'duplicate-in-batch',
]);

/** 条目级问题（与提交阶段 400 的 `detail.issues` 同形：path 为点号拼接字段路径） */
export const ImportIssueSchema = z
  .object({
    level: z.enum(['warn', 'error']),
    path: z.string(),
    message: z.string(),
  })
  .strict();

/** 映射变更留痕（K3 表逐项对齐；键名即产出键/入参键的裸名） */
export const ImportMappedSchema = z
  .object({
    renamed: z.array(z.string()),
    derived: z.array(z.string()),
    dropped: z.array(z.string()),
  })
  .strict();

/** 单文件预览结果（K5 逐键契约） */
export const ImportPreviewItemSchema = z
  .object({
    /** 原文件名 basename（仅展示与 slug 派生，**绝不**参与路径拼接） */
    name: z.string(),
    /** 小写扩展名（'.md' | '.markdown'；非白名单时为原扩展名小写形） */
    ext: z.string(),
    /** 建议 slug（= 文件名 stem；面板可改，服务端提交时另行权威校验） */
    slug: z.string(),
    /** 本批固定目录式（K6：官方文档明示单文件方案会让 RSS 本地图片路径失效） */
    form: z.literal('dir'),
    status: ImportPreviewStatusSchema,
    code: ImportPreviewCodeSchema.optional(),
    issues: z.array(ImportIssueSchema),
    mapped: ImportMappedSchema,
    /** 映射后、可直接提交的 frontmatter（面板必须展示，K8 硬要求） */
    frontmatter: z.record(z.string(), z.unknown()),
    /** 已剥离 frontmatter 块的正文（浏览器不得自行切分，再裁 A） */
    content: z.string(),
  })
  .strict();

/** 预览响应：逐条结果 + 计数汇总（不做整批回滚，K4） */
export const ImportPreviewResponseSchema = z
  .object({
    items: z.array(ImportPreviewItemSchema),
    summary: z
      .object({
        total: z.number().int(),
        ok: z.number().int(),
        conflict: z.number().int(),
        error: z.number().int(),
      })
      .strict(),
  })
  .strict();

export type ImportPreviewStatus = z.infer<typeof ImportPreviewStatusSchema>;
export type ImportPreviewCode = z.infer<typeof ImportPreviewCodeSchema>;
export type ImportIssue = z.infer<typeof ImportIssueSchema>;
export type ImportMapped = z.infer<typeof ImportMappedSchema>;
export type ImportPreviewItem = z.infer<typeof ImportPreviewItemSchema>;
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;
