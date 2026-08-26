/**
 * [阶段 P5] posts 模块
 * [职责] Markdown 文章 gray-matter 读写与文件管理
 * [状态] ACTIVE
 *
 * 依赖注入：DbModule（@Global，article 表）与 InfraBackupModule（@Global，
 * pre_write/restore）均为全局模块，无需在 imports 重复声明。
 * 分层自检：posts（L2）仅依赖 common/（L0）、infra/（L0）、@mizuki/shared，
 * 不 import 任何其他领域模块（MASTER-PLAN §4）。
 */
import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
