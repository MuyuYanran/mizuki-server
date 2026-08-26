/**
 * [P10d] dashboard 聚合查询（仪表盘统计卡片数据源）
 * [职责] 并行调用多个端点聚合仪表盘所需数据（system/status、posts list、
 *   collections diary/friends、albums、backups list、operation_log）。
 *   不实现 SSE 实时刷新（ADR-008），进入页面拉取 + 手动刷新。
 * [状态] ACTIVE
 *
 * 不调 detect：detect 需 mizukiRoot 路径参数，前端无该信息（config.json 不
 * 经端点暴露）；仪表盘以 status.mode 表示运行模式，检测明细留给初始化向导。
 */
import { request } from './http';
import { systemApi, type SystemStatus } from './system';
import { postsApi } from './posts';
import { collectionsApi } from './collections';
import { albumsApi, type AlbumView } from './albums';
import { backupsApi, type BackupRecordInfo } from './backups';

/** 操作日志条目（与后端 getLogs items 对齐） */
export interface OperationLogItem {
  id: string;
  userId: string | null;
  method: string;
  path: string;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

/** 操作日志分页响应 */
export interface OperationLogsPage {
  page: number;
  limit: number;
  total: number;
  items: OperationLogItem[];
}

/** 仪表盘聚合数据 */
export interface DashboardData {
  status: SystemStatus | null;
  postCount: number;
  draftCount: number;
  diaryCount: number;
  friendsCount: number;
  albumCount: number;
  albums: AlbumView[];
  recentBackups: BackupRecordInfo[];
  recentLogs: OperationLogItem[];
}

/** 读取操作日志（对接 P6 GET /admin/system/logs） */
export function fetchRecentLogs(limit = 10): Promise<OperationLogsPage> {
  return request<OperationLogsPage>('GET', `/admin/system/logs?limit=${limit}`);
}

/**
 * 聚合仪表盘数据：并行调用多个端点，任一失败用降级值兜底
 * （不阻塞整体展示——单端点失败不应让整个仪表盘空白）。
 * 不实现 SSE 实时刷新（ADR-008）。
 */
export async function fetchDashboardData(): Promise<DashboardData> {
  const [status, posts, diary, friends, albums, recentBackups, logs] = await Promise.all([
    systemApi.status().catch(() => null),
    postsApi.list().catch(() => []),
    collectionsApi.list<unknown[]>('diary').catch(() => []),
    collectionsApi.list<unknown[]>('friends').catch(() => []),
    albumsApi.list().catch(() => []),
    backupsApi.list().catch(() => []),
    fetchRecentLogs(10).catch(() => ({ page: 1, limit: 10, total: 0, items: [] })),
  ]);

  const postList = posts as { status?: string }[];
  return {
    status,
    postCount: postList.length,
    draftCount: postList.filter((p) => p.status === 'draft').length,
    diaryCount: (diary as unknown[]).length,
    friendsCount: (friends as unknown[]).length,
    albumCount: albums.length,
    albums,
    recentBackups,
    recentLogs: logs.items,
  };
}
