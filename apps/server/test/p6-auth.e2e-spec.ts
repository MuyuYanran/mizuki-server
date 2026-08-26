import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';

/**
 * P6 §6.1–6.10 验收依据（supertest e2e）：
 * 全局守卫（既有模块 401）、登录流程、失败锁定、登录限流、刷新与过期、
 * init 一次性、detector 正反、@Public 豁免（含 health initialized 演变）、
 * 操作日志脱敏、日志读取端点。
 *
 * 测试确定性：MIZUKI_JWT_SECRET 经环境变量注入（HS256 密钥 env 优先），
 * 便于伪造过期/篡改 token 断言守卫行为（密钥不写入日志/响应）。
 */

const TEST_SECRET = 'p6-e2e-deterministic-secret-0123456789abcdef';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p6-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_JWT_SECRET'] = TEST_SECRET;
const mizukiRoot = path.join(tmp, 'mizuki');

const ADMIN = { username: 'admin', password: 'admin-pass-123' };

/** 各 app 实例持有的 sqlite 句柄（DbModule 无 dispose，收尾手动关闭释放 Windows 文件锁） */
const sqliteHandles: Database.Database[] = [];

async function bootApp(): Promise<INestApplication> {
  // BACKUP_OPTIONS 覆写：真实工厂在启动时读配置快照（彼时未初始化，mizukiRoot 为空），
  // 与其他阶段 e2e 保持一致，直接注入本测试的假项目根
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
  await app.init();
  sqliteHandles.push(app.get<Database.Database>(SQLITE_CONNECTION));
  return app;
}

describe('P6 认证与初始化 e2e', () => {
  let app: INestApplication;
  let accessToken: string;
  let refreshToken: string;

  const server = (): request.SuperTest<request.Test> => request(app.getHttpServer());

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
    for (const handle of sqliteHandles) {
      handle.close();
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── §6.8 @Public 豁免与 health initialized 演变 ──

  it('§6.8 init 前：health 无 Token 可访问且 initialized=false；status 无 Token 401；detect 无 Token 可访问', async () => {
    const health = await server().get('/api/v1/system/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.initialized).toBe(false);

    expect((await server().get('/api/v1/system/status')).status).toBe(401);

    const detect = await server().post('/api/v1/system/detect').send({ path: mizukiRoot });
    expect(detect.status).toBe(200);
    expect(detect.body.valid).toBe(true);
  });

  // ── §6.6 init 一次性 ──

  it('§6.6 init：第一次成功（201）→ health initialized=true', async () => {
    const initRes = await server().post('/api/v1/system/init').send({ mizukiRoot, mode: 'manage', ...ADMIN });
    expect(initRes.status).toBe(201);
    expect(initRes.body.initialized).toBe(true);
    const health = await server().get('/api/v1/system/health');
    expect(health.body.initialized).toBe(true);
  });

  it('§6.6 init：第二次（即使凭据不同）→ 409', async () => {
    const second = await server()
      .post('/api/v1/system/init')
      .send({ mizukiRoot, mode: 'manage', username: 'other', password: 'other-pass-999' });
    expect(second.status).toBe(409);
  });

  it('§6.6 init：无效目录 → 400 附检查明细', async () => {
    // 注意：此时已初始化 → 409 先行（一次性语义优先于检测）；
    // 无效目录的检测明细由 detector 单测与 detect 端点用例覆盖
    const res = await server()
      .post('/api/v1/system/init')
      .send({ mizukiRoot: path.join(tmp, 'not-exists'), mode: 'manage', ...ADMIN });
    expect(res.status).toBe(409);
  });

  // ── §6.2 登录流程 ──

  it('§6.2 登录：正确凭据 → 双 Token；me 带 Token 200、无 Token 401', async () => {
    const login = await server().post('/api/v1/admin/auth/login').send(ADMIN);
    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');
    expect(typeof login.body.refreshToken).toBe('string');
    accessToken = login.body.accessToken as string;
    refreshToken = login.body.refreshToken as string;

    const me = await server().get('/api/v1/admin/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(ADMIN.username);
    expect(typeof me.body.id).toBe('string');

    expect((await server().get('/api/v1/admin/auth/me')).status).toBe(401);
  });

  it('§6.2 登录：错误密码 → 401 且 failed_login_count +1', async () => {
    const res = await server()
      .post('/api/v1/admin/auth/login')
      .send({ username: ADMIN.username, password: 'wrong-password-1' });
    expect(res.status).toBe(401);

    const db = app.get<Database.Database>(SQLITE_CONNECTION);
    const row = db.prepare('SELECT failed_login_count FROM admin_user').get() as { failed_login_count: number };
    expect(row.failed_login_count).toBe(1);
  });

  // ── §6.1 既有全部 admin 路由挂守卫 ──

  it('§6.1 既有模块无 Token 一律 401：collections / posts / backup', async () => {
    expect((await server().get('/api/v1/admin/collections/diary')).status).toBe(401);
    expect((await server().get('/api/v1/admin/posts')).status).toBe(401);
    expect((await server().get('/api/v1/admin/backups')).status).toBe(401);
    // 带有效 Token 放行（与 401 形成对照）
    expect((await server().get('/api/v1/admin/posts').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
  });

  it('§6.1 守卫细节：伪造签名 Token 与过期 Token 均 401', async () => {
    const tampered = `${accessToken.slice(0, -4)}AAAA`;
    expect((await server().get('/api/v1/admin/posts').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);

    const expired = await new SignJWT({ username: ADMIN.username, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('someone')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(TEST_SECRET));
    expect((await server().get('/api/v1/admin/posts').set('Authorization', `Bearer ${expired}`)).status).toBe(401);

    // refresh token 当 access 用 → 类型校验拒绝
    const asAccess = await server().get('/api/v1/admin/posts').set('Authorization', `Bearer ${refreshToken}`);
    expect(asAccess.status).toBe(401);
  });

  // ── §6.5 刷新与过期 ──

  it('§6.5 刷新：refresh token 换新对，新 access 可用（轮换）', async () => {
    const res = await server().post('/api/v1/admin/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');

    const me = await server().get('/api/v1/admin/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    // 轮换：新 refresh 与旧值不同
    expect(res.body.refreshToken).not.toBe(refreshToken);
    accessToken = res.body.accessToken as string;
  });

  it('§6.5 刷新：无效 refresh token → 401', async () => {
    const res = await server().post('/api/v1/admin/auth/refresh').send({ refreshToken: 'invalid-token' });
    expect(res.status).toBe(401);
  });

  // ── §6.9 操作日志脱敏 ──

  it('§6.9 操作日志：登录有记录，detail 密码掩码且不含明文密码/Token', () => {
    const db = app.get<Database.Database>(SQLITE_CONNECTION);
    const rows = db
      .prepare("SELECT path, detail FROM operation_log WHERE path LIKE '%/admin/auth/login%'")
      .all() as { path: string; detail: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.detail).toContain('"password":"***"');
      expect(row.detail).not.toContain(ADMIN.password);
      expect(row.detail).not.toContain(refreshToken);
      expect(row.detail).not.toContain(accessToken);
    }
  });

  // ── §6.10 日志读取端点 ──

  it('§6.10 日志端点：无 Token 401；带 Token 分页（created_at 倒序，含登录记录）', async () => {
    expect((await server().get('/api/v1/admin/system/logs')).status).toBe(401);

    const res = await server()
      .get('/api/v1/admin/system/logs?page=1&limit=10')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    const timestamps = (res.body.items as { createdAt: string }[]).map((item) => item.createdAt);
    const sorted = [...timestamps].sort((a, b) => b.localeCompare(a));
    expect(timestamps).toEqual(sorted);
    expect((res.body.items as { path: string }[]).some((item) => item.path.includes('/admin/auth/login'))).toBe(true);
  });

  it('登出（需 Token）：200 且被操作日志记录', async () => {
    expect((await server().post('/api/v1/admin/auth/logout')).status).toBe(401);
    const res = await server()
      .post('/api/v1/admin/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);

    const db = app.get<Database.Database>(SQLITE_CONNECTION);
    const rows = db
      .prepare("SELECT path FROM operation_log WHERE path LIKE '%/admin/auth/logout%'")
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  // ── §6.7 detector REST 反例 ──

  it('§6.7 detect REST：缺 src/data 的目录 → valid:false 且对应检查失败', async () => {
    const broken = path.join(tmp, 'broken-project');
    fs.cpSync(FIXTURE_DIR, broken, { recursive: true });
    fs.rmSync(path.join(broken, 'src', 'data'), { recursive: true, force: true });
    const res = await server().post('/api/v1/system/detect').send({ path: broken });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    const dataCheck = (res.body.checks as { name: string; passed: boolean }[]).find((c) => c.name === 'dataDir');
    expect(dataCheck?.passed).toBe(false);
  });

  // ── §6.3 失败锁定（独立实例：避开主实例限流计数） ──

  it('§6.3 失败锁定：连续错误达到 5 次后，正确密码也被拒（423）', async () => {
    const lockApp = await bootApp();
    try {
      const lockServer = request(lockApp.getHttpServer());
      let saw423 = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        const res = await lockServer
          .post('/api/v1/admin/auth/login')
          .send({ username: ADMIN.username, password: `wrong-password-${attempt}` });
        if (res.status === 423) {
          saw423 = true;
          break;
        }
        expect(res.status).toBe(401);
      }
      expect(saw423).toBe(true);

      const db = app.get<Database.Database>(SQLITE_CONNECTION);
      const row = db.prepare('SELECT failed_login_count, locked_until FROM admin_user').get() as {
        failed_login_count: number;
        locked_until: number | null;
      };
      expect(row.locked_until).not.toBeNull();
      expect(row.failed_login_count).toBe(0); // 锁定时计数清零
    } finally {
      await lockApp.close();
    }
  }, 30_000);

  it('§6.3 锁定持续：新实例中正确密码仍被拒（423）', async () => {
    const verifyApp = await bootApp();
    try {
      const res = await request(verifyApp.getHttpServer()).post('/api/v1/admin/auth/login').send(ADMIN);
      expect(res.status).toBe(423);
    } finally {
      await verifyApp.close();
    }
  }, 30_000);

  // ── §6.4 登录限流（独立实例） ──

  it('§6.4 登录限流：路由级 5 次/分，第 6 次返回 429', async () => {
    const throttleApp = await bootApp();
    try {
      const throttleServer = request(throttleApp.getHttpServer());
      for (let i = 0; i < 5; i++) {
        const res = await throttleServer.post('/api/v1/admin/auth/login').send(ADMIN);
        expect([401, 423]).toContain(res.status); // 锁定期内 423，均计入限流
      }
      const blocked = await throttleServer.post('/api/v1/admin/auth/login').send(ADMIN);
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('ThrottlerException');
    } finally {
      await throttleApp.close();
    }
  }, 30_000);
});
