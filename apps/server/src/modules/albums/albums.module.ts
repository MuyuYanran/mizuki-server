/**
 * [阶段 P7] albums 模块
 * [职责] 相册 CRUD 与 info.json；同时把 AlbumsService 作为
 *   MediaReferenceContributor（name='albums'）注册进全局注册表
 *   （注册方登记，P7 §3.4——注册而非互调，不产生 L2 互 import）。
 * [状态] ACTIVE
 */
import { Module, type OnModuleInit } from '@nestjs/common';
import { MediaReferenceRegistry } from '../../common/registry/media-reference.registry';
import { AlbumsController } from './albums.controller';
import { AlbumsService } from './albums.service';

@Module({
  controllers: [AlbumsController],
  providers: [AlbumsService],
})
export class AlbumsModule implements OnModuleInit {
  constructor(
    private readonly registry: MediaReferenceRegistry,
    private readonly albums: AlbumsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.albums);
  }
}
