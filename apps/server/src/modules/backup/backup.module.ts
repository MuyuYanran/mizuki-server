/**
 * [阶段 P2] backup 模块 — 备份 REST API 层
 * [职责] 装配 BackupController（BackupService 由 infra/backup 的
 *   @Global InfraBackupModule 提供，直接注入）。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';

@Module({
  controllers: [BackupController],
})
export class BackupModule {}
