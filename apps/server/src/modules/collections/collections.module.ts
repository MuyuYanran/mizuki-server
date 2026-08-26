/**
 * [阶段 P4] collections 模块 — 六类集合 CRUD（L2）
 * [职责] 装配动态控制器与 CRUD 编排服务；依赖 data-files（L1 引擎）。
 *   禁止依赖其他 L2 模块（eslint-plugin-boundaries 强制）。
 * [阶段 P7] 注册 CollectionsMediaReferenceContributor（diary images /
 *   projects image / devices image 的媒体引用检查器）进全局注册表
 *   （注册方登记，P7 §3.4——注册而非互调）。
 * [状态] ACTIVE
 */
import { Module, type OnModuleInit } from '@nestjs/common';
import { MediaReferenceRegistry } from '../../common/registry/media-reference.registry';
import { DataFilesModule } from '../data-files/data-files.module';
import { CollectionsController } from './collections.controller';
import { CollectionsMediaReferenceContributor } from './media-reference';
import { CollectionsService } from './collections.service';
import { PublicCollectionsController } from './public-collections.controller';

@Module({
  imports: [DataFilesModule],
  // [P8] 追加公开集合只读控制器（/public/collections/:type，@Public）
  controllers: [CollectionsController, PublicCollectionsController],
  providers: [CollectionsService, CollectionsMediaReferenceContributor],
})
export class CollectionsModule implements OnModuleInit {
  constructor(
    private readonly registry: MediaReferenceRegistry,
    private readonly contributor: CollectionsMediaReferenceContributor,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.contributor);
  }
}
