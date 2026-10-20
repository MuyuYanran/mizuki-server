/**
 * [P10a] System 端点客户端（健康检查 / 状态 / 目录检测 / 一次性初始化）
 */
import { request } from './http';

export interface HealthInfo {
  status: string;
  service: string;
  uptime: number;
  initialized: boolean;
}

export interface SystemStatus {
  initialized: boolean;
  mode: string;
  version: string;
  uptime: number;
}

export interface DetectCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DetectResult {
  valid: boolean;
  checks: DetectCheck[];
  packageManager: 'pnpm' | 'yarn' | 'npm';
}

export type RunMode = 'manage' | 'additive' | 'overwrite';

export interface InitPayload {
  mizukiRoot: string;
  mode: RunMode;
  username: string;
  password: string;
}

/**
 * [U3-P3/K1] 目录浏览结果（初始化向导点选器）
 * 后端契约：GET /admin/system/browse-dirs?path=<绝对路径>
 *   - 不传 path → 根列表（Windows 盘符 / POSIX '/'）
 *   - 传 path → 该目录的子目录列表 + parent
 */
export interface BrowseDirItem {
  name: string;
  isMizuki: boolean;
}

export interface BrowseDirsResult {
  parent: string | null;
  items: BrowseDirItem[];
  truncated: boolean;
}

const PATHS = {
  health: '/system/health',
  status: '/system/status',
  detect: '/system/detect',
  init: '/system/init',
  browseDirs: '/admin/system/browse-dirs',
} as const;

export const systemApi = {
  health(): Promise<HealthInfo> {
    return request<HealthInfo>('GET', PATHS.health);
  },
  status(): Promise<SystemStatus> {
    return request<SystemStatus>('GET', PATHS.status);
  },
  detect(path: string): Promise<DetectResult> {
    return request<DetectResult>('POST', PATHS.detect, { path });
  },
  init(payload: InitPayload): Promise<{ initialized: boolean }> {
    return request<{ initialized: boolean }>('POST', PATHS.init, payload);
  },
  /**
   * [U3-P3/K1] 浏览目录：path 省略时取根列表。
   * 该端点为 @Public（向导 pre-auth 流程），但系统已初始化 → 409。
   */
  browseDirs(path?: string): Promise<BrowseDirsResult> {
    const query = path === undefined || path === '' ? '' : `?path=${encodeURIComponent(path)}`;
    return request<BrowseDirsResult>('GET', `${PATHS.browseDirs}${query}`);
  },
};
