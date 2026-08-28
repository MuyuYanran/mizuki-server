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
import { resetAppConfigCache } from '../src/config/app-config';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';

/**
 * [Phase2-B2 / T5 manage 菜单收窄] e2e（裁决 7）：
 * manage 模式收窄为「仅隐藏富文本文章」，六类集合菜单保留。
 * 菜单过滤与路由重定向属面板（Vue）行为，无 web 测试基建（人工走查覆盖，
 * 见 SESSIONS B2 报告偏差记录）；本 spec 在服务端语义层固化两点：
 *  1. manage 模式下六类集合 API 可达（集合页可达的数据层保证）；
 *  2. manage 模式下富文本文章 API 同样可达——收窄是纯菜单级隐藏，
 *     服务端不做封禁（裁决 7 语义：隐藏而非禁用）。
 */

const TEST_SECRET = 'p2b-t5-e2e-deterministic-secret-0123456789';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p2b-t5-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
const CONFIG_PATH = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_PATH'] = CONFIG_PATH;
process.env['MIZUKI_JWT_SECRET'] = TEST_SECRET;
const mizukiRoot = path.join(tmp, 'mizuki');

const ADMIN = { username: 'admin', password: 'admin-pass-123' };

const sqliteHandles: Database.Database[] = [];

describe('Phase2-B2 T5 manage 菜单收窄 e2e', () => {
  let app: INestApplication;
  let accessToken: string;

  const server = (): request.SuperTest<request.Test> => request(app.getHttpServer());

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    // manage（仅管理）模式初始化
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mizukiRoot, mode: 'manage' }), 'utf8');
    resetAppConfigCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BACKUP_OPTIONS)
      .useValue({
        mizukiRoot,
        backupDir: path.join(tmp, 'backups'),
        dbPath: process.env['MIZUKI_DB_PATH'] as string,
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sqliteHandles.push(app.get<Database.Database>(SQLITE_CONNECTION));

    await server().post('/api/v1/system/init').send({ mizukiRoot, mode: 'manage', ...ADMIN });
    const login = await server().post('/api/v1/admin/auth/login').send(ADMIN);
    expect(login.status).toBe(200);
    accessToken = login.body.accessToken as string;

    // 确认当前确为 manage 模式（判定源与面板一致）
    const status = await server().get('/api/v1/system/status').set('Authorization', `Bearer ${accessToken}`);
    expect(status.body.mode).toBe('manage');
  });

  afterAll(async () => {
    await app.close();
    for (const handle of sqliteHandles) {
      handle.close();
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('收窄①：manage 模式下集合页可达——六类集合 API 200（菜单保留的数据层保证）', async () => {
    for (const type of ['diary', 'friends', 'projects', 'timeline', 'skills', 'devices']) {
      const res = await server()
        .get(`/api/v1/admin/collections/${type}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
    }
  });

  it('收窄②：manage 模式下富文本 API 仍可达——收窄是菜单级隐藏而非服务端封禁', async () => {
    const res = await server()
      .get('/api/v1/admin/articles')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
  });
});
