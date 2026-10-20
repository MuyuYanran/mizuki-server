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
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [U3-P3/K3/K4/K5] 任务运行历史 + 任务模板 e2e（supertest）。
 *
 * 覆盖（7 例）：
 *   ① 启动即出行（finished_at=null、exit_code=null）；
 *   ② 退出后更新 finished_at/exit_code + log_text 非空；
 *   ③ :id 详情含 log_text；不存在 → 404；
 *   ④ DELETE 后再取 → 404；
 *   ⑤ 分页倒序（多行，started_at 降序）；
 *   ⑥ log_text 256KB 保尾截断（DB 直预置超长行最稳）；
 *   ⑦ templates 端点 + 越界键（cmd/args/shell）config 解析拒绝。
 *
 * 装配：app A = 假 Mizuki 项目（init/login 拿 token，共享 DB/secret）；
 *   app B = 最小子项目 mini-project（进程任务工作目录，与 p9 spec 同法）。
 */

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const MINI_FIXTURE = path.resolve(__dirname, 'fixtures/mini-project');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p9e-runs-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const miniRoot = path.join(tmp, 'mini');
/**
 * 大输出项目（专用夹具，不动共享 mini-project——它被 p9 / p9b 共用，
 * 改它会破坏既有断言）。build 脚本输出 >256KB，用于验证**写入侧**保尾截断。
 */
const bigRoot = path.join(tmp, 'big');

const sqliteHandles: Database.Database[] = [];

/** 落一个大输出项目（package.json + build 脚本，输出 6000 行 ≈ 数百 KB） */
function makeBigProject(): void {
  fs.mkdirSync(path.join(bigRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(bigRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'mizuki-big-project',
        version: '0.0.0',
        private: true,
        scripts: { build: 'node scripts/build.js' },
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(bigRoot, 'scripts', 'build.js'),
    [
      "import('node:fs').then((fs) => {",
      '  const line = "x".repeat(120) + "\\n";',
      '  for (let i = 1; i <= 6000; i++) {',
      '    fs.writeSync(1, String(i).padStart(6, "0") + line);',
      '  }',
      '});',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(bigRoot, 'package-lock.json'), '{}\n', 'utf8');
}

async function bootApp(root: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BACKUP_OPTIONS)
    .useValue({
      mizukiRoot: root,
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

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface RunListItem {
  id: string;
  task: string;
  commandSnapshot: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  status: string;
}

interface RunDetail extends RunListItem {
  logText: string | null;
}

describe('P9e [U3-P3] 任务运行历史 + 任务模板 e2e', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let appC: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });
    fs.cpSync(MINI_FIXTURE, miniRoot, { recursive: true });
    makeBigProject();

    appA = await bootApp(mizukiRoot);
    accessToken = await initAndLogin(request(appA.getHttpServer()), mizukiRoot);
    appB = await bootApp(miniRoot);
    appC = await bootApp(bigRoot); // 大输出项目（写入侧截断验证）
  }, 60_000);

  afterAll(async () => {
    await appC.close();
    await appB.close();
    await appA.close();
    for (const handle of sqliteHandles) {
      handle.close();
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  const serverB = (): request.SuperTest<request.Test> =>
    withAuth(request(appB.getHttpServer()), () => accessToken);
  const serverC = (): request.SuperTest<request.Test> =>
    withAuth(request(appC.getHttpServer()), () => accessToken);

  it('① 启动即出行：历史列表出现该行，finished_at/exit_code 为空', async () => {
    const started = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    expect(started.status).toBe(201);
    const taskId = started.body.id as string;

    const list = await serverB().get('/api/v1/admin/process/runs');
    expect(list.status).toBe(200);
    const items = list.body.items as RunListItem[];
    const row = items.find((item) => item.id === taskId);
    expect(row).toBeDefined();
    expect(row!.task).toBe('build');
    expect(row!.finishedAt).toBeNull();
    expect(row!.exitCode).toBeNull();
    expect(row!.status).toBe('running');
    // command_snapshot 与 pino plan* 字段同源：{ file, args }
    expect(() => JSON.parse(row!.commandSnapshot) as { file: string; args: string[] }).not.toThrow();

    // 收口（避免用例结束时子进程仍在跑）
    await waitFor(async () => {
      const detail = await serverB().get(`/api/v1/admin/process/runs/${taskId}`);
      return (detail.body as RunDetail).finishedAt !== null;
    });
  }, 60_000);

  it('② 退出后更新 finished_at/exit_code，log_text 非空', async () => {
    const started = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    expect(started.status).toBe(201);
    const taskId = started.body.id as string;

    await waitFor(async () => {
      const detail = await serverB().get(`/api/v1/admin/process/runs/${taskId}`);
      return (detail.body as RunDetail).finishedAt !== null;
    });

    const detail = await serverB().get(`/api/v1/admin/process/runs/${taskId}`);
    expect(detail.status).toBe(200);
    const body = detail.body as RunDetail;
    expect(body.exitCode).toBe(0);
    expect(typeof body.logText).toBe('string');
    expect((body.logText ?? '').length).toBeGreaterThan(0);
    expect(body.logText).toContain('line-2500'); // mini-project build 夹具输出
    expect(body.status).toBe('exited');
  }, 60_000);

  it('③ 详情含 log_text；不存在的 :id → 404', async () => {
    const missing = await serverB().get('/api/v1/admin/process/runs/no-such-run-id');
    expect(missing.status).toBe(404);
  });

  it('④ DELETE 历史后：删除 200，再取 → 404', async () => {
    const started = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    const taskId = started.body.id as string;
    await waitFor(async () => {
      const detail = await serverB().get(`/api/v1/admin/process/runs/${taskId}`);
      return (detail.body as RunDetail).finishedAt !== null;
    });

    const deleted = await serverB().delete(`/api/v1/admin/process/runs/${taskId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);

    const after = await serverB().get(`/api/v1/admin/process/runs/${taskId}`);
    expect(after.status).toBe(404);
    // 再删 → 404
    expect((await serverB().delete(`/api/v1/admin/process/runs/${taskId}`)).status).toBe(404);
  }, 60_000);

  it('⑤ 分页：多行 + started_at 倒序', async () => {
    // 保证至少 3 行
    for (let i = 0; i < 2; i += 1) {
      const started = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
      const taskId = started.body.id as string;
      await waitFor(async () => {
        const detail = await serverB().get(`/api/v1/admin/process/runs/${taskId}`);
        return (detail.body as RunDetail).finishedAt !== null;
      });
    }

    const page = await serverB().get('/api/v1/admin/process/runs?page=1&limit=50');
    expect(page.status).toBe(200);
    expect(page.body.page).toBe(1);
    expect(page.body.limit).toBe(50);
    const items = page.body.items as RunListItem[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    const times = items.map((item) => new Date(item.startedAt).getTime());
    const sortedDesc = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sortedDesc);

    // limit clamp 口径：超 100 → 静默截断至 100
    const clamped = await serverB().get('/api/v1/admin/process/runs?limit=9999');
    expect(clamped.status).toBe(200);
    expect(clamped.body.limit).toBe(100);
  }, 90_000);

  it('⑥ log_text 256KB 保尾截断：写入侧（单源函数）+ 读取侧（详情端点不外溢）', async () => {
    // 写入侧：截断单源（process/log-truncate）——保尾且 ≤256KB
    const { truncateLogText, LOG_TEXT_MAX_BYTES } = await import('../src/modules/process/log-truncate');
    expect(LOG_TEXT_MAX_BYTES).toBe(256 * 1024);
    const big = 'A'.repeat(300 * 1024);
    const truncated = truncateLogText(big);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(256 * 1024);
    expect(truncated.length).toBeGreaterThan(0);
    // 保尾：尾部内容仍在
    expect(truncated.endsWith('A')).toBe(true);
    // 未超限 → 原样返回
    expect(truncateLogText('short')).toBe('short');

    // 读取侧：DB 直预置超长行（绕过写入路径）→ 详情端点仍不外溢
    const sqlite = sqliteHandles[0];
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO task_run (id, task, command_snapshot, started_at, finished_at, exit_code, log_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('big-log-run', 'build', '{}', now, now, 0, big);

    const detail = await serverB().get('/api/v1/admin/process/runs/big-log-run');
    expect(detail.status).toBe(200);
    const logText = (detail.body as RunDetail).logText ?? '';
    expect(Buffer.byteLength(logText, 'utf8')).toBeLessThanOrEqual(256 * 1024);
    expect(logText.length).toBeGreaterThan(0);
  });

  it('⑥b 写入侧保尾截断：真实超长输出任务 → 落库 log_text ≤256KB 且保留尾部', async () => {
    const started = await serverC().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    expect(started.status).toBe(201);
    const taskId = started.body.id as string;

    await waitFor(async () => {
      const detail = await serverC().get(`/api/v1/admin/process/runs/${taskId}`);
      return (detail.body as RunDetail).finishedAt !== null;
    }, 60_000);

    const detail = await serverC().get(`/api/v1/admin/process/runs/${taskId}`);
    const logText = (detail.body as RunDetail).logText ?? '';
    // 写入侧已截断 → 落库值 ≤256KB
    expect(Buffer.byteLength(logText, 'utf8')).toBeLessThanOrEqual(256 * 1024);
    // 保尾：最后一行（006000）在
    expect(logText).toContain('006000');
    // 尾部被保留：原始输出前部（000001）应已被截掉
    expect(logText).not.toContain('000001');
  }, 90_000);

  it('⑦ templates 端点返回配置模板；越界键（cmd/args/shell）config 解析拒绝', async () => {
    // 默认无模板 → items 为空数组
    const empty = await serverB().get('/api/v1/admin/process/templates');
    expect(empty.status).toBe(200);
    expect(Array.isArray(empty.body.items)).toBe(true);

    // 写入合法模板 → 活取可见（getAppConfig 每请求）
    const configPath = process.env['MIZUKI_CONFIG_PATH'] as string;
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        { ...current, tasks: [{ name: '构建产物', task: 'build', description: '出静态产物' }] },
        null,
        2,
      ),
      'utf8',
    );
    const { resetAppConfigCache } = await import('../src/config/app-config');
    resetAppConfigCache();

    const withTemplate = await serverB().get('/api/v1/admin/process/templates');
    expect(withTemplate.status).toBe(200);
    expect(withTemplate.body.items).toEqual([
      { name: '构建产物', task: 'build', description: '出静态产物' },
    ]);

    // 越界键 → config 解析按既有失败语义拒绝（loadAppConfig 抛错）
    const { loadAppConfig } = await import('../src/config/app-config');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        { ...current, tasks: [{ name: '越界', task: 'build', cmd: 'powershell', shell: 'powershell 任意' }] },
        null,
        2,
      ),
      'utf8',
    );
    expect(() => loadAppConfig(configPath)).toThrow();
    resetAppConfigCache();
  });
});
