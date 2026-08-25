import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('P0a 骨架冒烟测试', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /api/v1/system/health → 200 { status: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('启动时迁移自动执行：data/mizuki.db 存在且含 11 张业务表（P0b §6.6）', () => {
    const dbPath = path.resolve(__dirname, '../data/mizuki.db');
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
