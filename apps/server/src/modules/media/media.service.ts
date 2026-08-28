/**
 * [阶段 P7] media/media.service — 上传管线与媒体索引
 * [职责] MASTER-PLAN §7 五件套逐字：① 扩展名白名单 → ② 魔数嗅探（与扩展名
 *   比对一致 + sharp 解码兜底）→ ③ 10MB 上限（413）→ ④ 随机文件名
 *   `<nanoid>.<ext>` 写 `public/images/uploads/` → ⑤ sharp 按原格式重编码
 *   （去 EXIF 与内嵌 payload）并读宽高入索引；删除前经
 *   MediaReferenceRegistry 聚合引用检查（有引用 → 409 + 明细）。
 * [状态] ACTIVE
 *
 * 纪律：路径经 safeJoin；删除前 pre_write 备份；成功出口恰好一次发射
 * media.changed（payload 先过 parse）；media 不认识引用方（注册表反查）。
 */
import { createHash } from 'node:crypto';
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
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import { EVENTS, MediaChangedPayload } from '@mizuki/shared';
import { logger } from '../../common/logger';
import { MediaReferenceRegistry } from '../../common/registry/media-reference.registry';
import { EXTENSION_FORMAT, sniffImageFormat, type MagicFormat } from '../../common/security/magic-sniff';
import { ForbiddenPathError, safeJoin } from '../../common/security/safe-join';
import { getAppConfig } from '../../config/app-config';
import { type BackupOptions, BACKUP_OPTIONS, BackupService } from '../../infra/backup/backup.service';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { mediaFile } from '../../infra/db/schema';

/** multipart 上传文件（memory storage）的最小结构（不依赖 @types/multer；
 * 与 posts 的同构接口各自局部声明，避免 L2 互 import） */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

/** 上传目标目录（相对 Mizuki 根，MASTER-PLAN §7） */
const UPLOADS_REL_DIR = 'public/images/uploads';

/** :id 路径参数校验（nanoid 字符集，拒绝路径分隔符） */
export const MediaIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** 格式 → 输出 mime（索引 mime 列） */
const FORMAT_MIME: Record<MagicFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
};

/** 格式 → 输出扩展名（随机文件名用；jpeg 统一 .jpg） */
const FORMAT_EXT: Record<MagicFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  tiff: 'tiff',
};

/** 对外媒体记录 */
export interface MediaInfo {
  id: string;
  path: string;
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  createdAt: string;
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly backup: BackupService,
    private readonly emitter: EventEmitter2,
    private readonly references: MediaReferenceRegistry,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── 上传管线（§3.1 五件套，顺序不可变） ──

  /** 上传：校验 → 重编码 → 随机名落盘 → 索引入库 → 事件 */
  async upload(file: UploadedFileLike): Promise<MediaInfo> {
    // 1. 扩展名白名单
    const ext = path.extname(file.originalname).toLowerCase();
    const expectedFormat = EXTENSION_FORMAT[ext];
    if (!expectedFormat) {
      throw new BadRequestException(`扩展名不在白名单：${ext || '(空)'}（允许 jpg/jpeg/png/webp/gif/tif/tiff）`);
    }
    // 2. 魔数嗅探：真实类型必须与扩展名一致（文本改名 .png 等伪造件在此拒绝）
    const sniffed = sniffImageFormat(file.buffer);
    if (sniffed !== expectedFormat) {
      throw new BadRequestException('文件内容与扩展名不符（魔数校验失败）');
    }
    // 3. 大小上限（配置，默认 10MB，MASTER-PLAN §7）
    const limitBytes = getAppConfig().uploadLimitMb * 1024 * 1024;
    if (file.buffer.length > limitBytes) {
      throw new PayloadTooLargeException(`文件超出上传上限 ${getAppConfig().uploadLimitMb}MB`);
    }
    // 5. sharp 重编码（按原格式；去 EXIF 与内嵌 payload）+ 宽高读取
    //    （解码失败即兜底拒绝——嗅探通过但内容损坏同样拦截）
    let reencoded: Buffer;
    let width: number;
    let height: number;
    try {
      const image = sharp(file.buffer).rotate(); // rotate：应用 EXIF 方向后再剥离元数据
      const meta = await image.clone().metadata();
      if (!meta.width || !meta.height) {
        throw new Error('无法读取图片尺寸');
      }
      width = meta.width;
      height = meta.height;
      reencoded = await this.reencode(image, expectedFormat);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('图片解码失败，已拒绝（魔数嗅探通过但内容无法解析）');
    }

    // 4. 随机文件名落盘（目录不存在则创建，路径经 safeJoin）
    const fileName = `${nanoid()}.${FORMAT_EXT[expectedFormat]}`;
    const relPath = `${UPLOADS_REL_DIR}/${fileName}`;
    const absPath = this.joinWithinRoot(relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    await this.backup.preWriteBackup(absPath, 'media upload'); // 新文件 → 跳过（无物可备），管线步骤保留
    this.atomicWrite(absPath, reencoded);

    const sha256 = createHash('sha256').update(reencoded).digest('hex');
    const id = nanoid();
    const createdAt = new Date();
    await this.db.insert(mediaFile).values({
      id,
      path: relPath,
      originalName: file.originalname,
      mime: FORMAT_MIME[expectedFormat],
      size: reencoded.length,
      width,
      height,
      sha256,
      createdAt,
    });
    this.emitChanged(relPath, 'save');
    logger.info({ originalName: file.originalname, path: relPath, width, height }, '媒体上传完成（已重编码）');
    return {
      id,
      path: relPath,
      originalName: file.originalname,
      mime: FORMAT_MIME[expectedFormat],
      size: reencoded.length,
      width,
      height,
      sha256,
      createdAt: createdAt.toISOString(),
    };
  }

  /** 媒体列表（新 → 旧） */
  async list(): Promise<MediaInfo[]> {
    const rows = await this.db.select().from(mediaFile).orderBy(desc(mediaFile.createdAt));
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      originalName: row.originalName,
      mime: row.mime,
      size: row.size,
      width: row.width,
      height: row.height,
      sha256: row.sha256,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** 删除：引用检查（注册表聚合）→ 409 + 明细；无引用 → 备份 → 删文件与行 → 事件 */
  async delete(id: string): Promise<{ deleted: true; path: string }> {
    const rows = await this.db.select().from(mediaFile).where(eq(mediaFile.id, id));
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`媒体不存在：${id}`);
    }

    // 删除前聚合引用检查（MASTER-PLAN §2 决策 6：同步反查走注册表）
    const refs = await this.references.collectAll();
    const referencing = refs.filter((ref) => ref.mediaPath === row.path);
    if (referencing.length > 0) {
      logger.warn({ path: row.path, referenceCount: referencing.length }, '媒体删除被拒：存在引用');
      throw new ConflictException({
        message: `媒体被 ${referencing.length} 处内容引用，禁止删除`,
        detail: {
          references: referencing.map((ref) => ({ refType: ref.refType, targetLabel: ref.targetLabel })),
        },
      });
    }

    const absPath = this.joinWithinRoot(row.path);
    if (fs.existsSync(absPath)) {
      await this.backup.preWriteBackup(absPath, 'media delete'); // 删除前备份（可回滚）
      fs.rmSync(absPath);
    }
    await this.db.delete(mediaFile).where(eq(mediaFile.id, id));
    this.emitChanged(row.path, 'delete');
    logger.info({ path: row.path }, '媒体删除完成（删前已备份）');
    return { deleted: true, path: row.path };
  }

  // ── 内部实现 ──

  /** 按原格式重编码（默认参数即剥离全部元数据） */
  private async reencode(image: ReturnType<typeof sharp>, format: MagicFormat): Promise<Buffer> {
    switch (format) {
      case 'jpeg':
        return image.jpeg().toBuffer();
      case 'png':
        return image.png().toBuffer();
      case 'webp':
        return image.webp().toBuffer();
      case 'gif':
        return image.gif().toBuffer();
      case 'tiff':
        return image.tiff().toBuffer();
    }
  }

  /** media.changed：成功出口恰好一次，payload 先过 parse */
  private emitChanged(relPath: string, op: 'save' | 'delete'): void {
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

  /** 原子写：同目录临时文件 → rename（统一写管线第 7 步模式） */
  private atomicWrite(absPath: string, data: Buffer): void {
    const tmp = path.join(path.dirname(absPath), `.tmp-${nanoid(8)}`);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, absPath);
  }
}
