import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import Database from 'better-sqlite3';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';

/**
 * [阶段 P11 §6.1] 全新链路回归：init → 登录 → 面板核心 API 立即可用
 *
 * 背景（§6.1 冒烟实测发现）：BACKUP_OPTIONS 原为启动时快照（useFactory 读
 * getAppConfig 一次），init 向导运行期写入 config.json 后 provider 值不变，
 * collections/posts/albums 等「Mizuki 项目根目录未配置」400 直到进程重启
 * ——违反验收「登录 → 面板可用，全程无人工改码」。修复：mizukiRoot 改为
 * getter 活取值（backup.module.ts）。
 *
 * 本用例与 P6 的关键差异：**不覆写 BACKUP_OPTIONS**，走真实工厂，
 * 固化「init 后无需重启即可用」的生产行为。
 */

const TEST_SECRET = 'p11-fresh-chain-secret-0123456789abcdef';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p11-fresh-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_JWT_SECRET'] = TEST_SECRET;
const mizukiRoot = path.join(tmp, 'mizuki');

const ADMIN = { username: 'admin', password: 'fresh-chain-pass-123' };

describe('P11 全新链路：init → 登录 → 面板核心 API（无重启）', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // DbModule 无 dispose：手动关闭 sqlite 句柄释放 Windows 文件锁
    try {
      app.get<Database.Database>(SQLITE_CONNECTION).close();
    } catch {
      /* app 已关闭时忽略 */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> => request(app.getHttpServer());

  it('init 前：collections 无 Token → 401（守卫生效先于业务校验）', async () => {
    expect((await server().get('/api/v1/admin/collections/diary')).status).toBe(401);
  });

  it('POST /system/init → 201（config.json 由服务写入，mizukiRoot 生效）', async () => {
    const res = await server()
      .post('/api/v1/system/init')
      .send({ mizukiRoot, mode: 'manage', ...ADMIN });
    expect(res.status).toBe(201);
    expect(res.body.initialized).toBe(true);
  });

  it('POST /admin/auth/login → 200 双 Token', async () => {
    const res = await server().post('/api/v1/admin/auth/login').send(ADMIN);
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    accessToken = res.body.accessToken;
  });

  it('init 后无重启：GET /admin/collections/diary → 200 返回 fixture 数据（BACKUP_OPTIONS 活取值）', async () => {
    const res = await server()
      .get('/api/v1/admin/collections/diary')
      .set('Authorization', `Bearer ${accessToken}`);
    // 修复前：400「Mizuki 项目根目录未配置」
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('init 后无重启：GET /admin/posts → 200 数组（data-files 引擎同链路）', async () => {
    const res = await server()
      .get('/api/v1/admin/posts')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
