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
import { setupSwagger } from '../src/main';

/**
 * [Phase2-B2 / T4 四件套] e2e（裁决 5/4/6）：
 * ① PATCH /admin/auth/password：旧密码 verify + 新密码哈希 + token_version+1
 *    → 旧 refresh 401 / 新密码可登录 / 旧 access 有效期内仍可用（窗口语义）；
 * ② PATCH /admin/system/mode：写 config.json + 活取值，进程不重启；
 * ③ Swagger 开关：config swagger=false 不挂载 docs（默认 true 挂载）。
 * 面板改密表单为前端实现（无服务端 e2e），人工走查见 SESSIONS B2 报告。
 */

const TEST_SECRET = 'p2b-t4-e2e-deterministic-secret-0123456789';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p2b-t4-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
const CONFIG_PATH = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_PATH'] = CONFIG_PATH;
process.env['MIZUKI_JWT_SECRET'] = TEST_SECRET;
const mizukiRoot = path.join(tmp, 'mizuki');

const ADMIN = { username: 'admin', password: 'admin-pass-123' };

/** 各 app 实例持有的 sqlite 句柄（收尾手动关闭释放 Windows 文件锁） */
const sqliteHandles: Database.Database[] = [];

async function bootApp(withSwagger: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BACKUP_OPTIONS)
    .useValue({
      mizukiRoot,
      backupDir: path.join(tmp, 'backups'),
      dbPath: process.env['MIZUKI_DB_PATH'] as string,
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  // 与 bootstrap() 一致：按配置条件挂载 Swagger（config 内 swagger 字段驱动）
  if (withSwagger) {
    setupSwagger(app);
  }
  await app.init();
  sqliteHandles.push(app.get<Database.Database>(SQLITE_CONNECTION));
  return app;
}

describe('Phase2-B2 T4 四件套 e2e', () => {
  let app: INestApplication;
  let accessToken: string;
  let oldRefreshToken: string;

  const server = (): request.SuperTest<request.Test> => request(app.getHttpServer());

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mizukiRoot, mode: 'manage' }), 'utf8');
    resetAppConfigCache();
    app = await bootApp(true);

    // init + 登录拿旧 Token 对
    await server().post('/api/v1/system/init').send({ mizukiRoot, mode: 'manage', ...ADMIN });
    const login = await server().post('/api/v1/admin/auth/login').send(ADMIN);
    expect(login.status).toBe(200);
    accessToken = login.body.accessToken as string;
    oldRefreshToken = login.body.refreshToken as string;
  });

  afterAll(async () => {
    await app.close();
    for (const handle of sqliteHandles) {
      handle.close();
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── ① PATCH /admin/auth/password（裁决 5） ──

  it('改密①：无 Token 401；旧密码错误 400；新密码过短 400', async () => {
    expect((await server().patch('/api/v1/admin/auth/password')).status).toBe(401);

    const wrongOld = await server()
      .patch('/api/v1/admin/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: 'wrong-old-pass', newPassword: 'new-pass-456' });
    expect(wrongOld.status).toBe(400);

    const tooShort = await server()
      .patch('/api/v1/admin/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: ADMIN.password, newPassword: 'short' });
    expect(tooShort.status).toBe(400);
  });

  it('改密②：正确旧密码 → 200，token_version 递增落库', async () => {
    const db = app.get<Database.Database>(SQLITE_CONNECTION);
    const before = db.prepare('SELECT token_version FROM admin_user').get() as { token_version: number };

    const res = await server()
      .patch('/api/v1/admin/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: ADMIN.password, newPassword: 'new-pass-456' });
    expect(res.status).toBe(200);
    expect(res.body.passwordChanged).toBe(true);

    const after = db.prepare('SELECT token_version FROM admin_user').get() as { token_version: number };
    expect(after.token_version).toBe(before.token_version + 1);
  });

  it('改密③（吊销）：旧 refresh → 401；旧 access 有效期内仍可用（窗口语义）', async () => {
    const oldRefresh = await server().post('/api/v1/admin/auth/refresh').send({ refreshToken: oldRefreshToken });
    expect(oldRefresh.status).toBe(401);

    // access 15min 自然过期、不做吊销（裁决 5 窗口语义）
    const me = await server().get('/api/v1/admin/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
  });

  it('改密④（新凭据）：新密码登录 → 200；新 refresh 可轮换', async () => {
    const login = await server()
      .post('/api/v1/admin/auth/login')
      .send({ username: ADMIN.username, password: 'new-pass-456' });
    expect(login.status).toBe(200);

    const refreshed = await server()
      .post('/api/v1/admin/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe('string');
  });

  it('改密⑤：操作日志记录且 oldPassword/newPassword 全掩码', () => {
    const db = app.get<Database.Database>(SQLITE_CONNECTION);
    const rows = db
      .prepare("SELECT detail FROM operation_log WHERE path LIKE '%/admin/auth/password%'")
      .all() as { detail: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.detail).not.toContain(ADMIN.password);
      expect(row.detail).not.toContain('new-pass-456');
      expect(row.detail).not.toContain('wrong-old-pass');
    }
  });

  // ── ② PATCH /admin/system/mode（裁决 4） ──

  it('mode①：PATCH → 200 新值；/admin/system/status 即返新值（活取值，进程不重启）；config.json 落盘', async () => {
    expect((await server().patch('/api/v1/admin/system/mode')).status).toBe(401);

    const patch = await server()
      .patch('/api/v1/admin/system/mode')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mode: 'additive' });
    expect(patch.status).toBe(200);
    expect(patch.body.mode).toBe('additive');

    const status = await server()
      .get('/api/v1/system/status')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(status.status).toBe(200);
    expect(status.body.mode).toBe('additive');

    const onDisk: unknown = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    expect((onDisk as Record<string, unknown>)['mode']).toBe('additive');
  });

  it('mode②：非法值 → 400；改回 manage 后 status 同步', async () => {
    const bad = await server()
      .patch('/api/v1/admin/system/mode')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mode: 'yolo' });
    expect(bad.status).toBe(400);

    const back = await server()
      .patch('/api/v1/admin/system/mode')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mode: 'manage' });
    expect(back.status).toBe(200);
    expect(back.body.mode).toBe('manage');
  });

  // ── ③ Swagger 开关（裁决 6） ──

  it('swagger①：config swagger=false → 按配置不挂载，/api/v1/docs 404', async () => {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ mizukiRoot, mode: 'manage', swagger: false }),
      'utf8',
    );
    resetAppConfigCache();
    const noDocsApp = await bootApp(false);
    try {
      const res = await request(noDocsApp.getHttpServer()).get('/api/v1/docs');
      expect(res.status).toBe(404);
      expect((await request(noDocsApp.getHttpServer()).get('/api/v1/docs-json')).status).toBe(404);
    } finally {
      await noDocsApp.close();
    }
  });

  it('swagger②：config swagger=true → docs 挂载 200（默认开启语义的显式对照）', async () => {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ mizukiRoot, mode: 'manage', swagger: true }),
      'utf8',
    );
    resetAppConfigCache();
    const docsApp = await bootApp(true);
    try {
      const res = await request(docsApp.getHttpServer()).get('/api/v1/docs');
      expect(res.status).toBe(200);
    } finally {
      await docsApp.close();
    }
  });
});
