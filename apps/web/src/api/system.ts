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

const PATHS = {
  health: '/system/health',
  status: '/system/status',
  detect: '/system/detect',
  init: '/system/init',
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
};
