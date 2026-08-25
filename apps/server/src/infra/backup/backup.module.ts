/**
 * [阶段 P2] infra/backup/backup.module — 备份基建 @Global 模块
 * [职责] 提供 BackupService 及其配置（BACKUP_OPTIONS），导出供全部
 *   业务模块直接注入（MASTER-PLAN §2 决策 6：pre-write 备份直接调用
 *   infra/backup，共享底层，非模块耦合）。
 * [状态] ACTIVE
 */
import path from 'node:path';
import { Global, Module } from '@nestjs/common';
import { getAppConfig } from '../../config/app-config';
import { resolveDbPath } from '../db/db.module';
import { BACKUP_OPTIONS, BackupService } from './backup.service';

/** apps/server 根（src/infra/backup 向上 3 级，与 infra/db 同层） */
function serverRoot(): string {
  return path.resolve(__dirname, '../../../');
}

@Global()
@Module({
  providers: [
    {
      provide: BACKUP_OPTIONS,
      useFactory: () => {
        const config = getAppConfig();
        return {
          // mizukiRoot 未初始化为空串（BackupService 内部按 400 处理）
          mizukiRoot: config.mizukiRoot,
          // backupDir 相对 apps/server（AppConfig 默认 data/backups）
          backupDir: path.resolve(serverRoot(), config.backupDir),
          dbPath: resolveDbPath(),
        };
      },
    },
    BackupService,
  ],
  exports: [BackupService],
})
export class InfraBackupModule {}
