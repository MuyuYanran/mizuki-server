/**
 * [阶段 P2] backup/backup.controller — 备份与恢复 REST 接口
 * [职责] 调用 infra/backup 的 BackupService（唯一备份实现），提供
 *   POST/GET /admin/backups、POST /admin/backups/:id/restore、
 *   DELETE /admin/backups/:id（MASTER-PLAN §5 逐字）。
 * [状态] ACTIVE
 *
 * - body 一律过 ZodValidationPipe（P1 管道）；
 * - 恢复必须显式 confirm: true（REQUIREMENTS §3 侵入式操作铁律）；
 * - REST scope（full/data/content/db）→ 记录层 scope 映射见 BackupService。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BackupService, type BackupRecordInfo, type RestBackupScope } from '../../infra/backup/backup.service';

const CreateBackupBody = z.object({
  scope: z.enum(['full', 'data', 'content', 'db']),
  note: z.string().optional(),
});
type CreateBackupBodyDto = z.infer<typeof CreateBackupBody>;

/** 恢复确认 body：confirm 必须为字面量 true（缺失 / 其他值一律 400） */
const RestoreBody = z.object({ confirm: z.literal(true) });
type RestoreBodyDto = z.infer<typeof RestoreBody>;

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/backups')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @ApiOperation({ summary: '创建备份（body：scope full/data/content/db + 可选 note）' })
  @Post()
  async create(@Body(new ZodValidationPipe(CreateBackupBody)) body: CreateBackupBodyDto): Promise<BackupRecordInfo> {
    const scope: RestBackupScope = body.scope;
    if (scope === 'db') {
      return this.backupService.dbBackup(body.note);
    }
    return this.backupService.manualBackup(scope, body.note);
  }

  @ApiOperation({ summary: '备份记录列表' })
  @Get()
  async list(): Promise<BackupRecordInfo[]> {
    return this.backupService.listBackups();
  }

  @ApiOperation({ summary: '恢复备份（侵入式：必须显式携带 confirm: true，否则 400；恢复前自动做安全备份）' })
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RestoreBody)) body: RestoreBodyDto,
  ): Promise<{ id: string; restoredFiles: number; safetyBackupId?: string }> {
    if (body.confirm !== true) {
      // 双保险：管道已保证 confirm === true，此处显式拒绝以防管道被绕过
      throw new BadRequestException('恢复操作必须显式携带 confirm: true');
    }
    return this.backupService.restore(id);
  }

  @ApiOperation({ summary: '删除备份记录' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.backupService.deleteBackup(id);
    return { deleted: true };
  }
}
