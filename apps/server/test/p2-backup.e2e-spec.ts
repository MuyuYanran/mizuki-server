import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OnEvent } from '@nestjs/event-emitter';
import Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { BackupCompletedPayload, EVENTS } from '../../../packages/shared/src/events';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * P2 §6.5 / §6.6 验收依据（supertest e2e）：
 * POST 创建（full/data/content/db）→ GET 列表 → restore 无 confirm 400 / 有 confirm 成功
 * → DELETE 后列表不再包含；@OnEvent 订阅者收到 backup.completed 且 payload 过 zod parse；
 * mizukiRoot 未配置时创建文件备份 400。
 * [P6 守卫适配] beforeAll 中 init + login 取得 access token，
 * 全部请求经 withAuth 代理自动附加（适配方式见 P6 交付报告 §6.11）。
 */

// DB 隔离：指向临时文件（DbModule 工厂实例化时读取）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p2-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');

/** 测试事件订阅者（@OnEvent，P2 §6.6 断言要求） */
class BackupEventSubscriber {
  static received: { id: string; scope: string; fileCount: number }[] = [];
  @OnEvent(EVENTS.BackupCompleted)
  onBackupCompleted(payload: unknown): void {
    BackupEventSubscriber.received.push(BackupCompletedPayload.parse(payload));
  }
}

describe('P2 备份 REST API e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  const mizukiRoot = path.join(tmp, 'mizuki');
  const diaryPath = path.join(mizukiRoot, 'src', 'data', 'diary.ts');
  const originalContent = 'export const diaryData = [1];\n';
  const createdIds: Record<string, string> = {};
  /** 各 app 实例持有的 sqlite 句柄（DbModule 无 dispose，测试收尾手动关闭以释放 Windows 文件锁） */
  const sqliteHandles: Database.Database[] = [];

  beforeAll(async () => {
    fs.mkdirSync(path.join(mizukiRoot, 'src', 'data'), { recursive: true });
    fs.mkdirSync(path.join(mizukiRoot, 'src', 'content', 'posts', 'hello'), { recursive: true });
    fs.writeFileSync(diaryPath, originalContent);
    fs.writeFileSync(path.join(mizukiRoot, 'src', 'content', 'posts', 'hello', 'index.md'), 'hello\n');
    // [P6] init 检测所需的四项结构补齐（package.json 含 astro + astro.config.mjs）
    fs.writeFileSync(
      path.join(mizukiRoot, 'package.json'),
      JSON.stringify({ name: 'mizuki-p2-e2e', dependencies: { astro: '^5.0.0' } }),
    );
    fs.writeFileSync(path.join(mizukiRoot, 'astro.config.mjs'), 'export default {};\n');

    BackupEventSubscriber.received = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [BackupEventSubscriber],
    })
      .overrideProvider(BACKUP_OPTIONS)
      .useValue({ mizukiRoot, backupDir: path.join(tmp, 'backups'), dbPath: process.env['MIZUKI_DB_PATH'] as string })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sqliteHandles.push(app.get<Database.Database>(SQLITE_CONNECTION));
    // [P6] 守卫适配：初始化 + 登录取得 access token
    accessToken = await initAndLogin(server(), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    for (const handle of sqliteHandles) {
      handle.close();
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** [P6] 全部请求自动附加认证头 */
  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  it('POST /admin/backups full → 201，记录层 scope=manual', async () => {
    const res = await server().post('/api/v1/admin/backups').send({ scope: 'full' });
    expect(res.status).toBe(201);
    expect(res.body.scope).toBe('manual');
    expect(res.body.fileCount).toBe(2); // diary.ts + index.md
    createdIds['full'] = res.body.id;
  });

  it('POST /admin/backups data → 201', async () => {
    const res = await server().post('/api/v1/admin/backups').send({ scope: 'data' });
    expect(res.status).toBe(201);
    expect(res.body.scope).toBe('manual');
    createdIds['data'] = res.body.id;
  });

  it('POST /admin/backups content → 201', async () => {
    const res = await server().post('/api/v1/admin/backups').send({ scope: 'content' });
    expect(res.status).toBe(201);
    createdIds['content'] = res.body.id;
  });

  it('POST /admin/backups db → 201，记录层 scope=db', async () => {
    const res = await server().post('/api/v1/admin/backups').send({ scope: 'db' });
    expect(res.status).toBe(201);
    expect(res.body.scope).toBe('db');
    createdIds['db'] = res.body.id;
  });

  it('POST 非法 scope → 400（zod 管道）', async () => {
    const res = await server().post('/api/v1/admin/backups').send({ scope: 'evil' });
    expect(res.status).toBe(400);
    expect(res.body.detail.issues.length).toBeGreaterThan(0);
  });

  it('GET /admin/backups → 列表含全部 4 条创建记录', async () => {
    const res = await server().get('/api/v1/admin/backups');
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((r) => r.id);
    for (const key of ['full', 'data', 'content', 'db']) {
      expect(ids).toContain(createdIds[key]);
    }
  });

  it('§6.6 事件：@OnEvent 订阅者收到 backup.completed，payload 过 parse', () => {
    expect(BackupEventSubscriber.received.length).toBeGreaterThanOrEqual(4);
    for (const payload of BackupEventSubscriber.received) {
      expect(typeof payload.id).toBe('string');
      expect(typeof payload.scope).toBe('string');
      expect(typeof payload.fileCount).toBe('number');
    }
  });

  it('POST :id/restore 不带 confirm → 400', async () => {
    const res = await server()
      .post(`/api/v1/admin/backups/${createdIds['data']}/restore`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST :id/restore confirm:false → 400', async () => {
    const res = await server()
      .post(`/api/v1/admin/backups/${createdIds['data']}/restore`)
      .send({ confirm: false });
    expect(res.status).toBe(400);
  });

  it('POST :id/restore {confirm:true} → 200 且源文件恢复原始内容', async () => {
    fs.writeFileSync(diaryPath, 'export const diaryData = [TAMPERED];\n'); // 篡改
    const res = await server()
      .post(`/api/v1/admin/backups/${createdIds['data']}/restore`)
      .send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdIds['data']);
    expect(fs.readFileSync(diaryPath, 'utf8')).toBe(originalContent);
  });

  it('POST :id/restore 不存在的备份 → 404', async () => {
    const res = await server()
      .post('/api/v1/admin/backups/not-exists/restore')
      .send({ confirm: true });
    expect(res.status).toBe(404);
  });

  it('DELETE :id → 200，列表不再包含', async () => {
    const res = await server().delete(`/api/v1/admin/backups/${createdIds['db']}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    const list = await server().get('/api/v1/admin/backups');
    const ids = (list.body as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(createdIds['db']);
  });

  it('mizukiRoot 未配置 → POST data 备份 400 + 明确错误信息', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BACKUP_OPTIONS)
      .useValue({ mizukiRoot: '', backupDir: path.join(tmp, 'backups-empty'), dbPath: process.env['MIZUKI_DB_PATH'] as string })
      .compile();
    const bareApp = moduleRef.createNestApplication();
    configureApp(bareApp);
    await bareApp.init();
    sqliteHandles.push(bareApp.get<Database.Database>(SQLITE_CONNECTION));
    try {
      // [P6] 守卫适配：同库已初始化，登录取得 token（secret 经共享配置文件一致）
      const bareToken = await initAndLogin(request(bareApp.getHttpServer()), mizukiRoot);
      const res = await request(bareApp.getHttpServer())
        .post('/api/v1/admin/backups')
        .set('Authorization', `Bearer ${bareToken}`)
        .send({ scope: 'data' });
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain('未配置');
    } finally {
      await bareApp.close();
    }
  });
});
