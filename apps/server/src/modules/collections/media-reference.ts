/**
 * [阶段 P7] collections/media-reference — collections 媒体引用检查器（注册方）
 * [职责] 聚合六类集合对媒体的引用（P7 §3.4 分工）：
 *   - diary `images[]`（imageDir: public/images/diary）
 *   - projects `image`（无 imageDir 配置：值含路径则视为相对根，否则仅文件名原样上报）
 *   - devices（grouped）`image`（imageDir: public/images/device）
 *   经 collections.module.ts 注册进 MediaReferenceRegistry；
 *   只读（DataFileService.readCollection），不产生 L2 互 import。
 * [状态] ACTIVE
 */
import { Injectable } from '@nestjs/common';
import type { MediaReference } from '@mizuki/shared';
import { normalizeUserPath } from '../../common/fs/posix';
import { logger } from '../../common/logger';
import { DataFileService } from '../data-files/data-file.service';
import { currentThemeKind, getRegistryTable } from './registry';

type Item = Record<string, unknown>;

@Injectable()
export class CollectionsMediaReferenceContributor {
  readonly name = 'collections';

  constructor(private readonly dataFiles: DataFileService) {}

  async collectReferences(): Promise<MediaReference[]> {
    const refs: MediaReference[] = [];
    // [T2] 按当前主题档位遍历（mizuki → Mizuki 表；shirone → Shirone 表，
    //   避免去读 Mizuki 独有的 diary.ts 而产生无效告警；
    //   unknown → 空表 —— 主题未识别/包模式时没有可读的数据文件，遍历自然为空）
    for (const def of getRegistryTable(currentThemeKind())) {
      try {
        const value = this.dataFiles.readCollection(def.file, def.varName);
        if (def.type === 'diary') {
          for (const item of asItems(value)) {
            const images = item['images'];
            if (Array.isArray(images)) {
              for (const image of images) {
                if (typeof image === 'string' && image !== '') {
                  refs.push(reference('diary-image', String(item['id'] ?? ''), image, def.imageDir));
                }
              }
            }
          }
        } else if (def.type === 'projects') {
          for (const item of asItems(value)) {
            const image = item['image'];
            if (typeof image === 'string' && image !== '') {
              refs.push(reference('project-image', String(item['id'] ?? ''), image, def.imageDir));
            }
          }
        } else if (def.type === 'devices') {
          const grouped = value as Record<string, unknown>;
          for (const [group, items] of Object.entries(grouped)) {
            for (const item of asItems(items)) {
              const image = item['image'];
              if (typeof image === 'string' && image !== '') {
                refs.push(reference('device-image', `${group}/${String(item['name'] ?? '')}`, image, def.imageDir));
              }
            }
          }
        }
      } catch (error) {
        // 单集合读取失败不阻塞聚合（注册表对贡献者亦有兜底，双层防御）
        logger.warn({ err: error, type: def.type }, 'collections 引用检查：单集合读取失败（跳过）');
      }
    }
    return refs;
  }
}

// ── 纯工具 ──

function asItems(value: unknown): Item[] {
  return Array.isArray(value) ? (value as Item[]) : [];
}

/** 构造引用：纯文件名且注册表项配置了 imageDir → 归一到 `<imageDir>/<文件名>` */
function reference(refType: string, targetLabel: string, value: string, imageDir?: string): MediaReference {
  const posix = normalizeUserPath(value);
  const mediaPath = !posix.includes('/') && imageDir ? `${imageDir}/${posix}` : posix;
  return { refType, targetLabel, mediaPath };
}
