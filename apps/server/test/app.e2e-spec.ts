import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

// [Phase3-C5] 测试数据目录隔离（REQUIREMENTS-PHASE3 §3.4）：DB/config 落盘 mkdtemp
// 临时域，与仓库真实 apps/server/data/（本地实例数据）零交集；断言语义不变（迁移
// 自动执行 + 11 张业务表），仅落盘点迁移。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-app-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');

describe('P0a 骨架冒烟测试', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // Windows 文件句柄释放延迟：重试清理，最终失败不阻塞套件（.tmpvitest 已 gitignore）
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  it('GET /api/v1/system/health → 200 { status: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('启动时迁移自动执行：注入路径下 mizuki.db 存在且含 11 张业务表（P0b §6.6；[Phase3-C5] 落盘点迁移至临时域）', () => {
    const dbPath = process.env['MIZUKI_DB_PATH'] as string;
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath, { readonly: true });
    try {
      const names = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name)
        .filter((name) => !name.startsWith('sqlite_') && name !== '__drizzle_migrations');
      expect(new Set(names)).toEqual(
        new Set([
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
        ]),
      );
    } finally {
      db.close();
    }
  });
});
