/**
 * [阶段 P0b] infra/db/migrate — 启动自动迁移
 * [职责] runMigrations(dbPath)：用 drizzle-orm/better-sqlite3/migrator 的 migrate()
 *   对目标库执行 apps/server/drizzle/ 下的迁移；幂等（重复执行不报错）。
 *   执行过程经 pino 打日志（开始 / 完成 / 失败）。
 * [状态] ACTIVE
 *
 * 说明：migrate() 会在库中维护 __drizzle_migrations 记账表（迁移簿记，
 * 非 11 张业务表之一，见 ADR-002）。
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { logger } from '../../common/logger';

/** 迁移产物目录：apps/server/drizzle（src 与 dist 下相对层级一致，均为 infra/db 向上 3 级） */
export function migrationsFolder(): string {
  return path.resolve(__dirname, '../../../drizzle');
}

/**
 * 对目标 SQLite 库执行迁移（幂等）。
 * @param dbPath 数据库文件绝对路径（目录不存在时自动创建）
 */
export function runMigrations(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  try {
    const db = drizzle(sqlite);
    logger.info({ dbPath }, '迁移执行开始');
    migrate(db, { migrationsFolder: migrationsFolder() });
    logger.info({ dbPath }, '迁移执行完成');
  } catch (error) {
    logger.error({ dbPath, err: error }, '迁移执行失败');
    throw error;
  } finally {
    sqlite.close();
  }
}
