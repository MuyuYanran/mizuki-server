/**
 * [阶段 P0b] infra/db/db.module — 数据库 @Global 模块
 * [职责] 提供 better-sqlite3 实例与 drizzle 实例（DI token 导出），
 *   应用启动时（DI 实例化阶段）自动执行迁移。
 * [状态] ACTIVE
 */
import path from 'node:path';
import { Global, Module } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { runMigrations } from './migrate';

/** better-sqlite3 原生实例 DI token */
export const SQLITE_CONNECTION = Symbol('SQLITE_CONNECTION');

/** drizzle 实例 DI token（含 schema，供类型化查询） */
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

/** 数据库文件位置：apps/server/data/mizuki.db（可用 MIZUKI_DB_PATH 覆盖，测试用） */
export function resolveDbPath(): string {
  return process.env['MIZUKI_DB_PATH'] ?? path.resolve(__dirname, '../../../data/mizuki.db');
}

@Global()
@Module({
  providers: [
    {
      provide: SQLITE_CONNECTION,
      useFactory: (): Database.Database => {
        const dbPath = resolveDbPath();
        // 启动时自动执行迁移（幂等）
        runMigrations(dbPath);
        return new Database(dbPath);
      },
    },
    {
      provide: DRIZZLE_DB,
      useFactory: (sqlite: Database.Database): DrizzleDb => drizzle(sqlite, { schema }),
      inject: [SQLITE_CONNECTION],
    },
  ],
  exports: [SQLITE_CONNECTION, DRIZZLE_DB],
})
export class DbModule {}
