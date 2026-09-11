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
import { atomicWriteFile } from '../common/fs/atomic-write';
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
  /** [P6] JWT HS256 密钥（init 时生成并持久化，保证重启后 refresh token 仍有效；
   *   环境变量 MIZUKI_JWT_SECRET 优先，见 ADR-005） */
  jwtSecret: z.string().optional(),
  /** [B2/裁决 6] Swagger 文档挂载开关（默认 true；公网部署建议置 false，见 README） */
  swagger: z.boolean().default(true),
  /**
   * [Wave-2/B3] CORS 白名单扩展条目（默认空数组）。
   * 修复前：该键未纳入 schema，而 zod 对象默认 strip 未声明键 → getAppConfig()
   *   永远取不到它，app.setup.ts 的 CORS 扩展通道是**恒不生效的死代码**
   *   （注释承诺与实现背离，运维配置静默失效且无告警）。
   * 修复后：纳入 schema 并作为 app.setup 的附加白名单生效。
   * `.catch([])`：写错形态（如给字符串）时回落空数组，不因配置写法错误导致
   *   启动失败——与「配置非法即启动失败」的既有取舍的唯一例外，理由是该键
   *   此前被完全忽略，升级不应因历史脏写法阻断启动。
   */
  corsOrigins: z.array(z.string()).catch([]),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * 默认配置文件位置：apps/server/data/config.json（src 与 dist 下相对层级一致）。
 * 可用环境变量 MIZUKI_CONFIG_PATH 覆盖（测试注入钩子，与 P0b 的
 * MIZUKI_DB_PATH 同模式，见 ADR-005）。
 */
export function defaultConfigPath(): string {
  return process.env['MIZUKI_CONFIG_PATH'] ?? path.resolve(__dirname, '../../data/config.json');
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

/**
 * [B2/裁决 4] config.json 合并持久化（原 auth.service 内私有实现上收共享）：
 * 读取现有配置 → 合并 patch → 原子写（临时文件 + rename）。不重置进程内缓存，
 * 调用方随后调用 resetAppConfigCache() 使变更随下一次 getAppConfig() 活取生效，
 * 进程不重启（P11 坑 5「活取值」先例）。
 */
export function mergeAndPersistConfig(patch: Record<string, unknown>): void {
  const configPath = defaultConfigPath();
  let current: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        current = raw as Record<string, unknown>;
      }
    } catch {
      logger.warn({ configPath }, 'config.json 解析失败，按空配置合并写入');
    }
  }
  const next = { ...current, ...patch };
  // 原子写单源（common/fs/atomic-write）：目录自动创建 + 临时文件失败清理
  atomicWriteFile(configPath, JSON.stringify(next, null, 2), { ensureDir: true });
  logger.info({ configPath, keys: Object.keys(patch) }, 'config.json 已更新');
}
