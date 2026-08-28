/**
 * [阶段 P7] albums/albums.service — 相册目录与 info.json 管理
 * [职责] REQUIREMENTS §6.9 逐字：目录 `public/images/albums/<相册名>/`，
 *   info.json（zod 校验）+ 图片文件；相册列表/创建/修改/删除、
 *   图片上传（非 JPG 自动转 JPG，复用 §3.1 白名单+魔数+上限校验）、图片删除；
 *   相册删除与图片删除前经注册表引用检查（409 + 明细）。
 * [状态] ACTIVE
 *
 * 事件：相册元数据写入成功发射 content.changed（scope='album'）；
 * 相册图片保存/删除发射 media.changed（path 为相册图片相对路径）。
 * 贡献者：本服务实现 MediaReferenceContributor（name='albums'）——
 * info.json 无封面字段、相册图片暂不被其他内容引用，collectReferences
 * 返回空数组（机制占位，取舍见交付报告，§3.4 授权记录）。
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
  PayloadTooLargeException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import { ContentChangedPayload, EVENTS, MediaChangedPayload, type MediaReference, type MediaReferenceContributor } from '@mizuki/shared';
import { logger } from '../../common/logger';
import { MediaReferenceRegistry } from '../../common/registry/media-reference.registry';
import { EXTENSION_FORMAT, sniffImageFormat } from '../../common/security/magic-sniff';
import { ForbiddenPathError, safeJoin } from '../../common/security/safe-join';
import { getAppConfig } from '../../config/app-config';
import { type BackupOptions, BACKUP_OPTIONS, BackupService } from '../../infra/backup/backup.service';

/** multipart 上传文件（memory storage）的最小结构（不依赖 @types/multer；
 * 与 posts 的同构接口各自局部声明，避免 L2 互 import） */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

/** 相册根目录（相对 Mizuki 根，REQUIREMENTS §6.9） */
const ALBUMS_REL_DIR = 'public/images/albums';

/** 相册名：目录名单段，禁路径分隔符与 '..' */
export const AlbumNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^\\/]+$/, '相册名不得包含路径分隔符')
  .refine((value) => !value.includes('..') && value !== '.', '相册名非法');

/** 相册内图片文件名（同相册名规则；实际产物恒为 .jpg） */
export const AlbumImageNameSchema = AlbumNameSchema;

/**
 * info.json 公共字段（本地/外链两模式共用）。
 * [Phase3-C2a/ADR-017 对齐] 官方 special-gallery §通用字段说明（裁决级供料）：
 *   hidden/layout/columns 收紧入共享面；columns 默认 3 的语义由消费方处理（schema 不填充默认值）。
 */
const AlbumInfoBaseFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string().optional(),
  location: z.string().optional(),
  tags: z.array(z.string()).optional(),
  layout: z.enum(['grid', 'masonry']).optional(),
  columns: z.number().int().min(1).max(6).optional(),
  hidden: z.boolean().optional(),
} as const;

/**
 * [R2-14 + Phase3-C2a 收紧] 外链照片：官方 special-gallery §外链模式详解照片字段表
 * 逐字 14 字段（src 必填，其余可选）。settings 从 B2 自由 record 收紧为官方
 * settings 示例四子键（aperture/shutter/iso/focal 均为 string）。
 * .strict()：photos 为收紧面——未知子字段拒绝（不依赖 stripUnknown 剥离）。
 */
export const ExternalPhotoSchema = z
  .object({
    id: z.string().optional(),
    src: z.string().min(1),
    thumbnail: z.string().optional(),
    alt: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    date: z.string().optional(),
    location: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    camera: z.string().optional(),
    lens: z.string().optional(),
    settings: z
      .object({
        aperture: z.string().optional(),
        shutter: z.string().optional(),
        iso: z.string().optional(),
        focal: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ExternalPhoto = z.infer<typeof ExternalPhotoSchema>;

/** 本地模式 info.json（mode 缺省或 "local"，其余与现状逐字一致） */
export const AlbumInfoLocalSchema = z.object({
  ...AlbumInfoBaseFields,
  mode: z.literal('local').optional(),
});
export type AlbumInfoLocal = z.infer<typeof AlbumInfoLocalSchema>;

/** 外链模式 info.json（R2-14：mode:"external" + cover + photos[]） */
export const AlbumInfoExternalSchema = z.object({
  ...AlbumInfoBaseFields,
  mode: z.literal('external'),
  cover: z.string().min(1),
  photos: z.array(ExternalPhotoSchema),
});
export type AlbumInfoExternal = z.infer<typeof AlbumInfoExternalSchema>;

/**
 * info.json 双模式 schema（union：external 在前——local parse 会剥离未知键，
 * 顺序颠倒会把外链 info.json 误判为本地并丢掉 cover/photos）。
 * 读取/写入统一走此 schema；mode 判定由 raw.mode 驱动。
 */
export const AlbumInfoSchema = z.union([AlbumInfoExternalSchema, AlbumInfoLocalSchema]);
export type AlbumInfo = z.infer<typeof AlbumInfoSchema>;

/** 外链照片数组下标路由参数（:index，非负整数字符串 → number） */
export const ExternalPhotoIndexSchema = z
  .string()
  .regex(/^\d+$/, '外链照片下标须为非负整数')
  .transform((value) => Number(value));

/** POST /admin/albums body */
export const CreateAlbumBodySchema = z.object({
  name: AlbumNameSchema,
  info: AlbumInfoSchema,
});

/** PATCH /admin/albums/:id body（增量合并后按目标 mode 整体校验；mode 变更即模式切换） */
export const UpdateAlbumBodySchema = z
  .object({
    ...AlbumInfoBaseFields,
    title: z.string().min(1).optional(),
    mode: z.enum(['local', 'external']).optional(),
    cover: z.string().min(1).optional(),
    photos: z.array(ExternalPhotoSchema).optional(),
    hidden: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个待修改字段' });

/** 对外相册视图 */
export interface AlbumView {
  name: string;
  info: AlbumInfo;
  images: string[];
}

@Injectable()
export class AlbumsService implements MediaReferenceContributor {
  readonly name = 'albums';

  constructor(
    private readonly backup: BackupService,
    private readonly emitter: EventEmitter2,
    private readonly references: MediaReferenceRegistry,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── MediaReferenceContributor（P7 §3.4：albums 注册位） ──

  /**
   * info.json 无封面字段（REQUIREMENTS §6.9 字段表无 cover），相册图片
   * 当前不被其他内容模块引用 → 返回空数组。机制占位：后续如需「相册封面」
   * 概念（如 info.json 扩展 cover 字段），在此聚合即可，消费方零改动。
   */
  async collectReferences(): Promise<MediaReference[]> {
    return [];
  }

  // ── 相册 CRUD ──

  /** 相册列表（按名称升序；无 info.json 的目录跳过并告警） */
  list(): AlbumView[] {
    const rootAbs = this.albumsDirAbs();
    if (!fs.existsSync(rootAbs)) {
      return [];
    }
    const albums: AlbumView[] = [];
    for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const info = this.tryReadInfo(entry.name);
      if (!info) {
        logger.warn({ album: entry.name }, '相册缺少合法 info.json，列表跳过');
        continue;
      }
      albums.push({ name: entry.name, info, images: this.listImages(entry.name) });
    }
    return albums.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * [Phase3-C2a] 公开相册列表：隐藏过滤（官方 hidden 语义——true 为隐藏，
   * 不出现在列表页；文件仍保留、知道直接链接仍可访问，非访问控制）。
   * 管理端列表不过滤（albums.controller 仍走 list()，管理员可见全部）。
   */
  listPublic(): AlbumView[] {
    return this.list().filter((album) => album.info.hidden !== true);
  }

  /** 创建相册：目录已存在 → 409；写 info.json 后发射 content.changed（info 可为本地或外链模式） */
  async create(body: z.infer<typeof CreateAlbumBodySchema>): Promise<AlbumView> {
    const name = AlbumNameSchema.parse(body.name);
    const info = AlbumInfoSchema.parse(body.info);
    const dirAbs = this.albumDirAbs(name);
    if (fs.existsSync(dirAbs)) {
      throw new ConflictException(`相册已存在：${name}`);
    }
    fs.mkdirSync(dirAbs, { recursive: true });
    const infoAbs = path.join(dirAbs, 'info.json');
    await this.backup.preWriteBackup(infoAbs, `album create: ${name}`); // 新文件 → 跳过
    this.atomicWrite(infoAbs, JSON.stringify(info, null, 2));
    this.emitAlbumChanged(name);
    logger.info({ album: name, mode: info.mode ?? 'local' }, '相册创建完成');
    return { name, info, images: [] };
  }

  /**
   * 修改相册元信息：增量合并 → 按目标 mode 整体校验 → 备份 → 原子写 → 事件。
   * [R2-14] mode 变更即模式切换，精确规则：
   * - local → external：本地照片目录须为空（否则 409，错误信息含现存本地照片数）；
   * - external → local：photos 数组须为空（否则 409）。
   */
  async update(name: string, patch: z.infer<typeof UpdateAlbumBodySchema>): Promise<AlbumView> {
    const validatedName = AlbumNameSchema.parse(name);
    const existing = this.readInfoOrThrow(validatedName);
    const existingMode = existing.mode ?? 'local';
    const targetMode = patch.mode ?? existingMode;
    if (patch.mode !== undefined && patch.mode !== existingMode) {
      this.assertModeSwitch(validatedName, existingMode, targetMode);
    }
    const mergedRaw: Record<string, unknown> = { ...existing, ...patch };
    if (targetMode === 'external') {
      // 切换（或维持）外链模式：photos 允许缺省为空数组（切换后经外链照片 CRUD 增补）
      mergedRaw['photos'] ??= [];
      mergedRaw['mode'] = 'external';
    }
    const merged = (
      targetMode === 'external' ? AlbumInfoExternalSchema : AlbumInfoLocalSchema
    ).parse(mergedRaw) as AlbumInfo;
    const infoAbs = path.join(this.albumDirAbs(validatedName), 'info.json');
    await this.backup.preWriteBackup(infoAbs, `album update: ${validatedName}`);
    this.atomicWrite(infoAbs, JSON.stringify(merged, null, 2));
    this.emitAlbumChanged(validatedName);
    logger.info({ album: validatedName, mode: merged.mode ?? 'local' }, '相册元信息更新完成');
    return { name: validatedName, info: merged, images: this.listImages(validatedName) };
  }

  /** [R2-14] 模式切换精确规则（双向 409 拒绝条件） */
  private assertModeSwitch(name: string, from: 'local' | 'external', to: 'local' | 'external'): void {
    if (from === 'local' && to === 'external') {
      const count = this.listImages(name).length;
      if (count > 0) {
        throw new ConflictException(`本地照片目录非空（现存 ${count} 张本地照片），禁止切换为外链模式`);
      }
      return;
    }
    if (from === 'external' && to === 'local') {
      const count = (this.readInfoOrThrow(name) as AlbumInfoExternal).photos.length;
      if (count > 0) {
        throw new ConflictException(`外链 photos 数组非空（现存 ${count} 条外链照片），禁止切换为本地模式`);
      }
    }
  }

  // ── [R2-14] 外链照片 CRUD（仅外链模式相册；按数组下标定位） ──

  /** 追加一条外链照片 → 返回更新后相册视图 */
  async addExternalPhoto(name: string, photoInput: unknown): Promise<AlbumView> {
    const validatedName = AlbumNameSchema.parse(name);
    const external = this.readExternalOrThrow(validatedName);
    const photo = ExternalPhotoSchema.parse(photoInput);
    const photos = [...external.photos, photo];
    await this.writeExternalPhotos(validatedName, photos);
    logger.info({ album: validatedName, index: external.photos.length }, '外链照片已追加');
    return this.buildView(validatedName);
  }

  /** 修改外链照片字段（:index 数组下标，增量合并） */
  async updateExternalPhoto(name: string, index: number, patchInput: unknown): Promise<AlbumView> {
    const validatedName = AlbumNameSchema.parse(name);
    const external = this.readExternalOrThrow(validatedName);
    const existing = external.photos[index];
    if (!existing) {
      throw new NotFoundException(`外链照片不存在：${validatedName}/photos/${index}`);
    }
    const patch = ExternalPhotoSchema.partial().parse(patchInput);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('至少提供一个待修改字段');
    }
    const merged = ExternalPhotoSchema.parse({ ...existing, ...patch });
    const photos = [...external.photos];
    photos[index] = merged;
    await this.writeExternalPhotos(validatedName, photos);
    logger.info({ album: validatedName, index }, '外链照片字段已更新');
    return this.buildView(validatedName);
  }

  /** 删除外链照片（:index 数组下标） */
  async deleteExternalPhoto(name: string, index: number): Promise<AlbumView> {
    const validatedName = AlbumNameSchema.parse(name);
    const external = this.readExternalOrThrow(validatedName);
    if (!external.photos[index]) {
      throw new NotFoundException(`外链照片不存在：${validatedName}/photos/${index}`);
    }
    const photos = external.photos.filter((_, i) => i !== index);
    await this.writeExternalPhotos(validatedName, photos);
    logger.info({ album: validatedName, index }, '外链照片已删除');
    return this.buildView(validatedName);
  }

  /** 外链 photos 数组整体写回（备份 + 原子写 + 事件；await 保证响应前落盘） */
  private async writeExternalPhotos(name: string, photos: ExternalPhoto[]): Promise<void> {
    const infoAbs = path.join(this.albumDirAbs(name), 'info.json');
    const existing = this.readInfoOrThrow(name) as AlbumInfoExternal;
    const merged: AlbumInfoExternal = { ...existing, photos };
    await this.backup.preWriteBackup(infoAbs, `album photos: ${name}`);
    this.atomicWrite(infoAbs, JSON.stringify(merged, null, 2));
    this.emitAlbumChanged(name);
  }

  /** 删除相册：引用检查 → 逐文件备份 → 删目录 → 事件 */
  async delete(name: string): Promise<{ deleted: true }> {
    const validatedName = AlbumNameSchema.parse(name);
    const dirAbs = this.albumDirAbs(validatedName);
    if (!fs.existsSync(dirAbs)) {
      throw new NotFoundException(`相册不存在：${validatedName}`);
    }
    await this.assertNoReferences(`${ALBUMS_REL_DIR}/${validatedName}/`);

    for (const file of fs.readdirSync(dirAbs)) {
      const abs = path.join(dirAbs, file);
      if (fs.statSync(abs).isFile()) {
        await this.backup.preWriteBackup(abs, `album delete: ${validatedName}`);
      }
    }
    fs.rmSync(dirAbs, { recursive: true, force: true });
    this.emitAlbumChanged(validatedName);
    logger.info({ album: validatedName }, '相册删除完成（文件已备份，可恢复）');
    return { deleted: true };
  }

  // ── 相册图片 ──

  /**
   * 上传图片：§3.1 校验复用 + 原格式落盘。
   * [B2 裁决 2] 移除「非 JPG 强转 JPG」：png/webp/gif/avif 按原格式落盘
   * （EXIF 保留由用户自主决定）；解码兜底保留，损坏图片仍拒绝。
   */
  async uploadImage(name: string, file: UploadedFileLike): Promise<{ name: string; path: string }> {
    const validatedName = AlbumNameSchema.parse(name);
    const dirAbs = this.albumDirAbs(validatedName);
    if (!fs.existsSync(dirAbs)) {
      throw new NotFoundException(`相册不存在：${validatedName}`);
    }

    // §3.1 校验复用：扩展名白名单 → 魔数嗅探 → 大小上限
    // [Phase3-C2a/ADR-017] 白名单 +bmp+tiff/tif（svg 维持排除）
    const ext = path.extname(file.originalname).toLowerCase();
    const expectedFormat = EXTENSION_FORMAT[ext];
    if (!expectedFormat) {
      throw new BadRequestException(`扩展名不在白名单：${ext || '(空)'}（允许 jpg/jpeg/png/gif/webp/avif/bmp/tiff）`);
    }
    if (sniffImageFormat(file.buffer) !== expectedFormat) {
      throw new BadRequestException('文件内容与扩展名不符（魔数校验失败）');
    }
    const limitBytes = getAppConfig().uploadLimitMb * 1024 * 1024;
    if (file.buffer.length > limitBytes) {
      throw new PayloadTooLargeException(`文件超出上传上限 ${getAppConfig().uploadLimitMb}MB`);
    }

    // 解码兜底（仅校验，不转码）：嗅探通过但内容损坏在此拒绝。
    // [Phase3-C2a/ADR-017] bmp 跳过 sharp probe——sharp 0.35 预编译版无法解码 bmp
    // （能力层不支持），bmp 原格式直落盘；非图像伪造已由魔数嗅探在上一步拒绝。
    // tiff 维持可 probe（B4 已证支持）。
    if (expectedFormat !== 'bmp') {
      try {
        await sharp(file.buffer).metadata();
      } catch {
        throw new BadRequestException('图片解码失败，已拒绝');
      }
    }

    // 文件名：`<原名><原扩展名>`（原格式落盘）；同名冲突追加随机后缀
    const base = sanitizeFileBase(path.basename(file.originalname, path.extname(file.originalname)));
    let fileName = `${base}${ext}`;
    if (fs.existsSync(path.join(dirAbs, fileName))) {
      fileName = `${base}-${nanoid(6)}${ext}`;
      logger.info({ album: validatedName, fileName }, '相册图片同名冲突，使用随机后缀');
    }
    const relPath = `${ALBUMS_REL_DIR}/${validatedName}/${fileName}`;
    const absPath = this.joinWithinRoot(relPath);
    await this.backup.preWriteBackup(absPath, `album image: ${validatedName}/${fileName}`); // 新文件 → 跳过
    this.atomicWrite(absPath, file.buffer);
    this.emitImageChanged(relPath, 'save');
    logger.info({ album: validatedName, fileName, format: expectedFormat }, '相册图片保存完成（原格式落盘）');
    return { name: fileName, path: relPath };
  }

  /** 删除相册内单张图片：引用检查 → 备份 → 删除 → 事件 */
  async deleteImage(name: string, imageName: string): Promise<{ deleted: true }> {
    const validatedName = AlbumNameSchema.parse(name);
    const validatedImage = AlbumImageNameSchema.parse(imageName);
    const dirAbs = this.albumDirAbs(validatedName);
    if (!fs.existsSync(dirAbs)) {
      throw new NotFoundException(`相册不存在：${validatedName}`);
    }
    const relPath = `${ALBUMS_REL_DIR}/${validatedName}/${validatedImage}`;
    const absPath = this.joinWithinRoot(relPath);
    if (!fs.existsSync(absPath)) {
      throw new NotFoundException(`相册图片不存在：${validatedName}/${validatedImage}`);
    }
    // 相册图片互相引用按相册贡献者检查（当前贡献者为空集，见 collectReferences）
    const refs = await this.references.collectAll();
    const referencing = refs.filter((ref) => ref.mediaPath === relPath);
    if (referencing.length > 0) {
      throw new ConflictException({
        message: `相册图片被 ${referencing.length} 处内容引用，禁止删除`,
        detail: {
          references: referencing.map((ref) => ({ refType: ref.refType, targetLabel: ref.targetLabel })),
        },
      });
    }
    await this.backup.preWriteBackup(absPath, `album image delete: ${relPath}`);
    fs.rmSync(absPath);
    this.emitImageChanged(relPath, 'delete');
    logger.info({ album: validatedName, image: validatedImage }, '相册图片删除完成（已备份）');
    return { deleted: true };
  }

  // ── 内部实现 ──

  /** 引用检查：目标前缀下的路径出现在任一引用 → 409 + 明细 */
  private async assertNoReferences(pathPrefix: string): Promise<void> {
    const refs = await this.references.collectAll();
    const referencing = refs.filter((ref) => ref.mediaPath.startsWith(pathPrefix));
    if (referencing.length > 0) {
      logger.warn({ pathPrefix, referenceCount: referencing.length }, '相册删除被拒：存在引用');
      throw new ConflictException({
        message: `相册被 ${referencing.length} 处内容引用，禁止删除`,
        detail: {
          references: referencing.map((ref) => ({ refType: ref.refType, targetLabel: ref.targetLabel })),
        },
      });
    }
  }

  /** content.changed（scope='album'）：相册元数据写入成功出口 */
  private emitAlbumChanged(name: string): void {
    const payload = ContentChangedPayload.parse({
      scope: 'album',
      filePaths: [`${ALBUMS_REL_DIR}/${name}/info.json`],
    });
    this.emitter.emit(EVENTS.ContentChanged, payload);
  }

  /** media.changed：相册图片保存/删除成功出口 */
  private emitImageChanged(relPath: string, op: 'save' | 'delete'): void {
    const payload = MediaChangedPayload.parse({ path: relPath, op });
    this.emitter.emit(EVENTS.MediaChanged, payload);
  }

  private requireRoot(): string {
    if (this.options.mizukiRoot === '') {
      throw new BadRequestException('Mizuki 项目根目录未配置（请先完成初始化）');
    }
    return path.resolve(this.options.mizukiRoot);
  }

  private joinWithinRoot(rel: string): string {
    try {
      return safeJoin(this.requireRoot(), rel);
    } catch (error) {
      if (error instanceof ForbiddenPathError) {
        throw new ForbiddenException(`路径越界，已拒绝：${rel}`);
      }
      throw error;
    }
  }

  private albumsDirAbs(): string {
    return this.joinWithinRoot(ALBUMS_REL_DIR);
  }

  private albumDirAbs(name: string): string {
    return this.joinWithinRoot(`${ALBUMS_REL_DIR}/${name}`);
  }

  private readInfoOrThrow(name: string): AlbumInfo {
    const info = this.tryReadInfo(name);
    if (!info) {
      if (!fs.existsSync(this.albumDirAbs(name))) {
        throw new NotFoundException(`相册不存在：${name}`);
      }
      throw new BadRequestException(`相册 info.json 缺失或损坏：${name}`);
    }
    return info;
  }

  private tryReadInfo(name: string): AlbumInfo | undefined {
    try {
      const raw: unknown = JSON.parse(
        fs.readFileSync(path.join(this.albumDirAbs(name), 'info.json'), 'utf8'),
      );
      const parsed = AlbumInfoSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** [R2-14] 读取外链模式 info.json；相册不存在/损坏由 readInfoOrThrow 报错，非外链模式 → 409 */
  private readExternalOrThrow(name: string): AlbumInfoExternal {
    const info = this.readInfoOrThrow(name);
    if ((info.mode ?? 'local') !== 'external') {
      throw new ConflictException(`相册「${name}」非外链模式，禁止外链照片操作`);
    }
    return info as AlbumInfoExternal;
  }

  /** 对外相册视图组装（外链照片 CRUD 等写操作后的统一返回出口） */
  private buildView(name: string): AlbumView {
    return { name, info: this.readInfoOrThrow(name), images: this.listImages(name) };
  }

  /** 相册内图片文件名列表（排除 info.json，升序） */
  private listImages(name: string): string[] {
    const dirAbs = this.albumDirAbs(name);
    if (!fs.existsSync(dirAbs)) {
      return [];
    }
    return fs
      .readdirSync(dirAbs, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'info.json')
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  /** 原子写：同目录临时文件 → rename（统一写管线第 7 步模式） */
  private atomicWrite(absPath: string, data: string | Buffer): void {
    const tmp = path.join(path.dirname(absPath), `.tmp-${nanoid(8)}`);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, absPath);
  }
}

// ── 纯工具 ──

/** 原文件名主干清洗：去路径成分与危险字符，保底 'image' */
function sanitizeFileBase(base: string): string {
  const cleaned = base.replace(/[\\/]/g, '_').replace(/\.\./g, '_').trim();
  return cleaned === '' ? 'image' : cleaned;
}
