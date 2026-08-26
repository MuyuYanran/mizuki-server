/**
 * [阶段 P8] articles 模块
 * [职责] 富文本文章 + 统一索引 + 公开混合列表/详情；
 *   订阅 post.changed（索引增量）与 article.published（缓存失效）由
 *   ArticlesService 的 @OnEvent 完成（provider 装配即生效）；
 *   ArticlesMediaReferenceContributor 经 onModuleInit 注册进全局注册表
 *   （P7 §3.4 第四个注册方）。
 * [状态] ACTIVE
 */
import { Module, type OnModuleInit } from '@nestjs/common';
import { MediaReferenceRegistry } from '../../common/registry/media-reference.registry';
import { ArticlesController, PublicArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { ArticlesMediaReferenceContributor } from './media-reference';

@Module({
  controllers: [ArticlesController, PublicArticlesController],
  providers: [ArticlesService, ArticlesMediaReferenceContributor],
})
export class ArticlesModule implements OnModuleInit {
  constructor(
    private readonly registry: MediaReferenceRegistry,
    private readonly contributor: ArticlesMediaReferenceContributor,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.contributor);
  }
}
