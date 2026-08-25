/**
 * [阶段 P0b] Drizzle 配置（drizzle-kit）
 * [职责] schema 指向 infra/db/schema.ts，迁移产物输出 apps/server/drizzle/，
 *   dialect sqlite，db 文件 apps/server/data/mizuki.db（不进 git）。
 * [状态] ACTIVE
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infra/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './data/mizuki.db',
  },
});
