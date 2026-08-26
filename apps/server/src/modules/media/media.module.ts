/**
 * [阶段 P7] media 模块
 * [职责] 上传管线（魔数嗅探 + sharp 重编码）与媒体索引
 * [状态] ACTIVE
 *
 * 依赖注入：DbModule / InfraBackupModule 为 @Global；
 * MediaReferenceRegistryModule 为 @Global（app.module.ts 注册）。
 * 分层：media（L2）仅依赖 L0，引用检查一律经注册表（不 import 其他 L2）。
 */
import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
