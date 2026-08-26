/**
 * [P10d] backups 端点客户端（备份创建/列表/恢复/删除）
 * [职责] 封装 POST/GET /admin/backups、POST /admin/backups/:id/restore、
 *   DELETE /admin/backups/:id；复用 src/api/http.ts 的 401 自动 refresh。
 * [状态] ACTIVE
 *
 * 后端契约（P2 backup.controller，只读引用）：
 * - POST /admin/backups（body { scope, note? }）→ BackupRecordInfo；
 * - GET /admin/backups → BackupRecordInfo[]；
 * - POST /admin/backups/:id/restore（body { confirm: true }）→ { id, restoredFiles, safetyBackupId? };
 * - DELETE /admin/backups/:id → { deleted: true }。
 *
 * 恢复语义：前端必须显式 confirm（此处封装已带 confirm: true）；
 * 覆盖前自动快照由后端写管线完成（前端在恢复对话框说明该机制）。
 */
import { request } from './http';

/** 备份记录（与后端 BackupRecordInfo 对齐） */
export interface BackupRecordInfo {
  id: string;
  scope: string;
  fileCount: number;
  sizeBytes: number;
  note: string | null;
  createdAt: string;
  manifestPath: string;
}

/** 恢复结果 */
export interface RestoreResult {
  id: string;
  restoredFiles: number;
  safetyBackupId?: string;
}

/** 备份 scope（full = data ∪ content，见 ADR-003） */
export type BackupScope = 'full' | 'data' | 'content' | 'db';

export const backupsApi = {
  list(): Promise<BackupRecordInfo[]> {
    return request<BackupRecordInfo[]>('GET', '/admin/backups');
  },

  create(scope: BackupScope, note?: string): Promise<BackupRecordInfo> {
    return request<BackupRecordInfo>('POST', '/admin/backups', { scope, note });
  },

  /** 恢复：封装已带 confirm: true（前端二次确认后调用） */
  restore(id: string): Promise<RestoreResult> {
    return request<RestoreResult>(
      'POST',
      `/admin/backups/${encodeURIComponent(id)}/restore`,
      { confirm: true },
    );
  },

  remove(id: string): Promise<{ deleted: true }> {
    return request<{ deleted: true }>('DELETE', `/admin/backups/${encodeURIComponent(id)}`);
  },
};
