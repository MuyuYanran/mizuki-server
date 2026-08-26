/**
 * [阶段 P5] posts 模块
 * [职责] Markdown 文章 gray-matter 读写与文件管理
 * [阶段 P7] 注册 PostsMediaReferenceContributor（文章封面 image 引用检查器）
 *   进全局注册表（注册方登记，P7 §3.4——注册而非互调）。
 * [状态] ACTIVE
 *
 * 依赖注入：DbModule（@Global，article 表）与 InfraBackupModule（@Global，
 * pre_write/restore）均为全局模块，无需在 imports 重复声明。
 * 分层自检：posts（L2）仅依赖 common/（L0）、infra/（L0）、@mizuki/shared，
 * 不 import 任何其他领域模块（MASTER-PLAN §4）。
 */
import { Module, type OnModuleInit } from '@nestjs/common';
import { MediaReferenceRegistry } from '../../common/registry/media-reference.registry';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostsMediaReferenceContributor } from './media-reference';

@Module({
  controllers: [PostsController],
  providers: [PostsService, PostsMediaReferenceContributor],
})
export class PostsModule implements OnModuleInit {
  constructor(
    private readonly registry: MediaReferenceRegistry,
    private readonly contributor: PostsMediaReferenceContributor,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.contributor);
  }
}
