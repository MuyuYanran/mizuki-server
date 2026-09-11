/**
 * [重构/Wave-1] common/http/uploaded-file — 上传件契约与上传前三步校验
 * [职责]
 *  1. UploadedFileLike：multipart memory storage 的最小结构（原 3 处局部声明：
 *     posts / media / albums——原注释称「避免 L2 互 import」，但纯类型不构成
 *     L2 依赖，shared 已置同类契约，该理由不成立）；
 *  2. 上传三件套的单源校验：① 扩展名白名单 → ② 魔数嗅探一致 → ③ 大小上限
 *     （原 3 处重复：media.upload、albums.uploadImage、posts.uploadCover）。
 * [状态] ACTIVE
 *
 * 安全纪律（顺序不可变）：扩展名先于魔数（先按最小拒绝面拒绝未知类型），
 *   魔数早于大小（伪造件不必进入大小判断）。sharp 解码兜底由调用方负责——
 *   本模块只做「不需要图片库能力」的前三步。
 *
 * 文案逐字保留（对外可见）：subject / allowedText 由调用方传入，不自动拼接
 *   ——现有三处的空格与主体词并不一致（'扩展名不在白名单' vs '封面扩展名不在
 *   白名单'），自动拼接会改变对外提示文本。
 */
import path from 'node:path';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { EXTENSION_FORMAT, sniffImageFormat, type MagicFormat } from '../security/magic-sniff';

/** multipart 上传文件（memory storage）的最小结构（不依赖 @types/multer） */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

export interface ImageUploadGuardOptions {
  /** 错误文案主体词：'文件'（媒体库 / 相册）| '封面'（posts 封面） */
  subject: '文件' | '封面';
  /** 允许格式清单文案（错误信息括号内全文，逐字保留调用点原文） */
  allowedText: string;
  /** 上传上限（MB，来自 config.json uploadLimitMb） */
  limitMb: number;
  /** 扩展名 → 期望格式表（默认 EXTENSION_FORMAT） */
  extensions?: Record<string, MagicFormat>;
  /** 是否执行魔数嗅探（默认 true；posts 封面以 sharp 解码校验替代，传 false） */
  sniff?: boolean;
}

/** 校验产物：扩展名（含点小写）与嗅探出的真实格式 */
export interface PassedImageUpload {
  ext: string;
  format: MagicFormat;
}

/**
 * 上传前三步校验（不通过即抛错：400 / 413）。
 * @see 文件头注释 —— 顺序与文案均属对外可见行为，改动需记裁决。
 */
export function assertImageUpload(
  file: UploadedFileLike,
  options: ImageUploadGuardOptions,
): PassedImageUpload {
  const extensions = options.extensions ?? EXTENSION_FORMAT;
  const prefix = options.subject === '文件' ? '' : options.subject;

  // ① 扩展名白名单
  const ext = path.extname(file.originalname).toLowerCase();
  const expectedFormat = extensions[ext];
  if (!expectedFormat) {
    throw new BadRequestException(
      `${prefix}扩展名不在白名单：${ext || '(空)'}（允许 ${options.allowedText}）`,
    );
  }

  // ② 魔数嗅探：真实类型必须与扩展名一致（文本改名 .png 等伪造件在此拒绝）
  if (options.sniff !== false && sniffImageFormat(file.buffer) !== expectedFormat) {
    throw new BadRequestException('文件内容与扩展名不符（魔数校验失败）');
  }

  // ③ 大小上限
  if (file.buffer.length > options.limitMb * 1024 * 1024) {
    throw new PayloadTooLargeException(`${options.subject}超出上传上限 ${options.limitMb}MB`);
  }

  return { ext, format: expectedFormat };
}
