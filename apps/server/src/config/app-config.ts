/**
 * [阶段 P0b] config/app-config — 配置加载
 * [职责] 读取并 zod 校验 data/config.json（REQUIREMENTS §6.1）：
 *   - 数据库可用之前即需读取（同步 fs.readFileSync + JSON.parse）；
 *   - 文件存在但非法 → 启动即失败（错误信息含字段路径）；
 *   - 文件不存在 → 返回默认值（不阻塞启动，health 冒烟测试须仍通过）。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../common/logger';

/** 配置 schema（字段基线见 P0b 提示词 §3.1，扩展须记 ADR） */
export const AppConfigSchema = z.object({
  /** Mizuki 项目根路径，未初始化时为空串 */
  mizukiRoot: z.string().default(''),
  /** 对应 REQUIREMENTS §3 三模式：仅管理 / 新增文件 / 覆盖文件 */
  mode: z.enum(['manage', 'additive', 'overwrite']).default('manage'),
  /** 备份目录（相对 apps/server） */
  backupDir: z.string().default('data/backups'),
  /** 上传上限 MB（与 MASTER-PLAN §7 的 10MB 一致） */
  uploadLimitMb: z.number().int().positive().default(10),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** 默认配置文件位置：apps/server/data/config.json（src 与 dist 下相对层级一致） */
export function defaultConfigPath(): string {
  return path.resolve(__dirname, '../../data/config.json');
}

/**
 * 加载并校验配置。
 * @param configPath 显式路径（测试注入用），缺省为 data/config.json
 * @throws 配置文件存在但未通过校验时抛错（含字段路径），启动即失败
 */
export function loadAppConfig(configPath: string = defaultConfigPath()): AppConfig {
  if (!fs.existsSync(configPath)) {
    logger.info({ configPath }, 'config.json 不存在，使用默认配置');
    return AppConfigSchema.parse({});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `config.json 解析失败（${configPath}）: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = AppConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    const message = `config.json 校验失败（${configPath}）: ${detail}`;
    logger.error({ configPath }, message);
    throw new Error(message);
  }
  logger.info({ configPath }, 'config.json 加载成功');
  return parsed.data;
}

// ── 进程内单例 ──

let cached: AppConfig | undefined;

/** 进程内单例获取（首次调用时加载） */
export function getAppConfig(): AppConfig {
  cached ??= loadAppConfig();
  return cached;
}

/** 仅供测试重置单例使用 */
export function resetAppConfigCache(): void {
  cached = undefined;
}
