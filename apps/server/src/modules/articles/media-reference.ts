/**
 * [阶段 P8] articles/media-reference — articles 媒体引用检查器（注册方）
 * [职责] 聚合全部 `article.cover` 非空且未软删行的引用
 *   （refType: 'article-cover'、targetLabel: slug、mediaPath: cover），
 *   经 articles.module.ts 注册进 MediaReferenceRegistry——
 *   P7 注册表第四个注册方就位（P7 §3.4 分工）。
 * [状态] ACTIVE
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, isNotNull, isNull } from 'drizzle-orm';
import type { MediaReference } from '@mizuki/shared';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { article } from '../../infra/db/schema';

@Injectable()
export class ArticlesMediaReferenceContributor {
  readonly name = 'articles';

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async collectReferences(): Promise<MediaReference[]> {
    const rows = await this.db
      .select({ slug: article.slug, cover: article.cover })
      .from(article)
      .where(and(isNotNull(article.cover), isNull(article.deletedAt)));
    return rows
      .filter((row) => typeof row.cover === 'string' && row.cover !== '')
      .map((row) => ({
        refType: 'article-cover',
        targetLabel: row.slug,
        mediaPath: row.cover as string,
      }));
  }
}
