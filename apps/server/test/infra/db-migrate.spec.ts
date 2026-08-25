import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infra/db/migrate';

/** 11 张业务表（MASTER-PLAN §3 / P0b 提示词 §6.1 逐字核对） */
const EXPECTED_BUSINESS_TABLES = new Set([
  'admin_user',
  'article',
  'article_content',
  'category',
  'tag',
  'article_tag',
  'comment',
  'operation_log',
  'backup_record',
  'media_file',
  'site_setting',
]);

function readTableNames(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
  } finally {
    db.close();
  }
}

describe('P0b 启动迁移建表（§6.1）', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-mig-'));
    dbPath = path.join(dir, 'mizuki.db');
  });

  it('runMigrations 后 sqlite_master 恰好含 11 张业务表', () => {
    runMigrations(dbPath);

    const names = readTableNames(dbPath).filter((name) => !name.startsWith('sqlite_'));
    // __drizzle_migrations 是 drizzle migrator 的迁移记账表（非业务表，见 ADR-002）
    const business = names.filter((name) => name !== '__drizzle_migrations');

    expect(new Set(business)).toEqual(EXPECTED_BUSINESS_TABLES);
    expect(business).toHaveLength(11);
    // 迁移记账表存在，证明走的是 drizzle migrator 而非手工建表
    expect(names).toContain('__drizzle_migrations');
  });

  it('重复执行不报错（幂等）', () => {
    runMigrations(dbPath);
    expect(() => runMigrations(dbPath)).not.toThrow();
    // 幂等执行后表集合不变
    const business = readTableNames(dbPath).filter(
      (name) => !name.startsWith('sqlite_') && name !== '__drizzle_migrations',
    );
    expect(new Set(business)).toEqual(EXPECTED_BUSINESS_TABLES);
  });
});
