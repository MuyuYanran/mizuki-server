/**
 * [阶段 P4] collections 模块 — 六类集合 CRUD（L2）
 * [职责] 装配动态控制器与 CRUD 编排服务；依赖 data-files（L1 引擎）。
 *   禁止依赖其他 L2 模块（eslint-plugin-boundaries 强制）。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { DataFilesModule } from '../data-files/data-files.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

@Module({
  imports: [DataFilesModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
})
export class CollectionsModule {}
