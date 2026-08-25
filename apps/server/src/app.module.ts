import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DbModule } from './infra/db/db.module';
import { InfraBackupModule } from './infra/backup/backup.module';
import { SystemModule } from './modules/system/system.module';
import { AuthModule } from './modules/auth/auth.module';
import { DataFilesModule } from './modules/data-files/data-files.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { PostsModule } from './modules/posts/posts.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { AlbumsModule } from './modules/albums/albums.module';
import { MediaModule } from './modules/media/media.module';
import { ProcessModule } from './modules/process/process.module';
import { BackupModule } from './modules/backup/backup.module';
import { SettingsModule } from './modules/settings/settings.module';

/**
 * [阶段 P0a] 应用根模块
 * [职责] 注册全部业务模块（顺序与阶段对应），装配统一应用配置入口
 * [状态] ACTIVE
 */
@Module({
  imports: [
    // [P1] 全局限流：60 次/分钟/IP（登录 5 次/分独立限流在 P6 auth 挂载时启用）
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    // [P0b] 事件总线（跨模块异步交互唯一通道，事件目录见 @mizuki/shared EVENTS）
    EventEmitterModule.forRoot(),
    // [P0b] 数据库 @Global 模块（better-sqlite3 + drizzle，启动自动迁移）
    DbModule,
    // [P2] 备份基建 @Global 模块（唯一备份实现，业务模块直接注入）
    InfraBackupModule,
    // [P0a] 健康检查与 Mizuki 探测
    SystemModule,
    // [P6] 认证（登录 / JWT 双 Token / me）
    AuthModule,
    // [P3] TS 数据文件引擎（ts-morph）
    DataFilesModule,
    // [P4] 集合注册表与动态 CRUD
    CollectionsModule,
    // [P5] Markdown 文章读写
    PostsModule,
    // [P8] 富文本文章与统一索引
    ArticlesModule,
    // [P7] 相册 CRUD 与 info.json
    AlbumsModule,
    // [P7] 媒体上传管线与索引
    MediaModule,
    // [P9] 白名单子进程任务 + SSE 日志
    ProcessModule,
    // [P2] 备份 REST API
    BackupModule,
    // [P8] 站点设置与 Mizuki config 接管
    SettingsModule,
  ],
  providers: [
    // [P1] 全局 ThrottlerGuard（配合上方 ThrottlerModule 的 60 次/分/IP 配置）
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
