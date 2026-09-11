/**
 * [阶段 P7] posts/media-reference — posts 媒体引用检查器（注册方）
 * [职责] 聚合各文章 frontmatter `image`（封面）对媒体的引用，
 *   经 posts.module.ts 注册进 MediaReferenceRegistry（P7 §3.4 分工）。
 *   只读扫描，不修改任何文件；不产生 L2 互 import（不依赖 media/albums）。
 * [状态] ACTIVE
 *
 * 路径口径：image 值含 '/' 视为相对 Mizuki 根（规范化为 POSIX）；
 * 否则视为相对文章目录（`src/content/posts/<slug>/<值>`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { MediaReference } from '@mizuki/shared';
import { normalizeUserPath } from '../../common/fs/posix';
import { logger } from '../../common/logger';
import { parseMarkdown } from '../../common/markdown/frontmatter';
import { type BackupOptions, BACKUP_OPTIONS } from '../../infra/backup/backup.service';

const POSTS_REL_DIR = 'src/content/posts';

@Injectable()
export class PostsMediaReferenceContributor {
  readonly name = 'posts';

  constructor(@Inject(BACKUP_OPTIONS) private readonly options: BackupOptions) {}

  async collectReferences(): Promise<MediaReference[]> {
    if (this.options.mizukiRoot === '') {
      return [];
    }
    const postsDir = path.join(path.resolve(this.options.mizukiRoot), 'src', 'content', 'posts');
    if (!fs.existsSync(postsDir)) {
      return [];
    }
    const refs: MediaReference[] = [];
    for (const entry of fs.readdirSync(postsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const fileAbs = path.join(postsDir, entry.name, 'index.md');
      if (!fs.existsSync(fileAbs)) {
        continue;
      }
      try {
        const parsed = parseMarkdown(fs.readFileSync(fileAbs, 'utf8'));
        const image = parsed.frontmatter['image'];
        if (typeof image === 'string' && image !== '') {
          refs.push({
            refType: 'post-cover',
            targetLabel: entry.name,
            mediaPath: normalizeMediaPath(image, `${POSTS_REL_DIR}/${entry.name}`),
          });
        }
      } catch (error) {
        logger.warn({ err: error, slug: entry.name }, 'posts 引用检查：单篇解析失败（跳过）');
      }
    }
    return refs;
  }
}

/** 相对 Mizuki 根的路径规范化（无前缀 '/' 时按相对文章目录解析） */
function normalizeMediaPath(value: string, postRelDir: string): string {
  const posix = normalizeUserPath(value);
  if (posix.includes('/')) {
    return posix;
  }
  return `${postRelDir}/${posix}`;
}
