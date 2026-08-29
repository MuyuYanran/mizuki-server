import 'reflect-metadata';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
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
import { ProcessManagerService } from '../src/modules/process/process-manager.service';
import { EVENTS, ProcessFinishedPayload } from '../../../packages/shared/src/events';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * P9 §6.1–6.6 验收依据（supertest e2e）：
 * 启停 + SSE（slow）、优雅停机（slow）、白名单拒绝、process.finished 断言、
 * 环形缓冲 ≤2000 保留最新、端口检测、守卫 401。
 *
 * 装配：app A = 假 Mizuki 项目（init/login 拿 token，共享 DB/secret）；
 * app B = 最小子项目 mini-project（进程任务工作目录，§2 授权夹具）。
 */

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const MINI_FIXTURE = path.resolve(__dirname, 'fixtures/mini-project');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p9-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const miniRoot = path.join(tmp, 'mini');

/** process.finished 测试订阅者（注册在 app B，P9 §6.4） */
class ProcessFinishedSubscriber {
  static received: ProcessFinishedPayload[] = [];

  @OnEvent(EVENTS.ProcessFinished)
  onFinished(payload: unknown): void {
    ProcessFinishedSubscriber.received.push(ProcessFinishedPayload.parse(payload));
  }
}

const sqliteHandles: Database.Database[] = [];

async function bootApp(root: string, extraProviders: unknown[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    providers: [...extraProviders],
  })
    .overrideProvider(BACKUP_OPTIONS)
    .useValue({ mizukiRoot: root, backupDir: path.join(tmp, 'backups'), dbPath: process.env['MIZUKI_DB_PATH'] as string })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  sqliteHandles.push(app.get<Database.Database>(SQLITE_CONNECTION));
  return app;
}

/** pid 存活探测（process.kill(pid, 0)：抛错即已退出） */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** SSE 收集器：原始 http 连接 + Bearer 头，解析 `data:` 事件 */
function collectSse(port: number, urlPath: string, token: string): {
  events: { data: { type: string; line?: string; exitCode?: number } }[];
  closed: Promise<void>;
  destroy: () => void;
} {
  const events: { data: { type: string; line?: string; exitCode?: number } }[] = [];
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let remainder = '';
  const req = http.get(
    { host: '127.0.0.1', port, path: urlPath, headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } },
    (res) => {
      res.on('data', (chunk: Buffer) => {
        remainder += chunk.toString('utf8');
        const blocks = remainder.split('\n\n');
        remainder = blocks.pop() ?? '';
        for (const block of blocks) {
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) {
              try {
                events.push({ data: JSON.parse(line.slice(5).trim()) });
              } catch {
                // 忽略非 JSON 心跳行
              }
            }
          }
        }
      });
      res.on('end', () => resolveClosed());
    },
  );
  req.on('error', () => resolveClosed());
  return {
    events,
    closed,
    destroy: () => req.destroy(),
  };
}

describe('P9 进程管理 e2e', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let accessToken: string;
  let bPort: number;

  beforeAll(async () => {
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });
    fs.cpSync(MINI_FIXTURE, miniRoot, { recursive: true });
    ProcessFinishedSubscriber.received = [];

    appA = await bootApp(mizukiRoot);
    accessToken = await initAndLogin(request(appA.getHttpServer()), mizukiRoot);

    appB = await bootApp(miniRoot, [ProcessFinishedSubscriber]);
    await appB.listen(0);
    const address = appB.getHttpServer().address();
    bPort = typeof address === 'object' && address !== null ? address.port : 0;
  }, 60_000);

  afterAll(async () => {
    await appB.close();
    await appA.close();
    for (const handle of sqliteHandles) {
      handle.close();
    }
    // Windows 下子进程（npm 等）句柄释放有延迟：重试清理，最终失败不阻塞套件
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

  it('§6.6/守卫：无 Token 访问任务端点 → 401', async () => {
    expect((await request(appB.getHttpServer()).post('/api/v1/admin/process/tasks').send({ task: 'dev' })).status).toBe(401);
  });

  it('§6.3 白名单拒绝：注入串与未知任务 → 400', async () => {
    for (const evil of ['install;rm -rf /', 'shell', 'arbitrary', 'dev && echo pwned']) {
      const res = await serverB().post('/api/v1/admin/process/tasks').send({ task: evil });
      expect(res.status).toBe(400);
    }
    expect((await serverB().post('/api/v1/admin/process/tasks').send({})).status).toBe(400);
  });

  it('§6.3 白名单四项均可启动并可停止', async () => {
    const ids: string[] = [];
    for (const task of ['install', 'dev', 'build', 'preview'] as const) {
      const res = await serverB().post('/api/v1/admin/process/tasks').send({ task });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('running');
      expect(res.body.pid).toBeGreaterThan(0);
      ids.push(res.body.id as string);
    }
    for (const id of ids) {
      const stopped = await serverB().delete(`/api/v1/admin/process/tasks/${id}`);
      expect(stopped.status).toBe(200);
    }
    await waitFor(async () => {
      const statuses = await Promise.all(
        ids.map(async (id) => (await serverB().get(`/api/v1/admin/process/tasks/${id}`)).body.status as string),
      );
      return statuses.every((status) => status !== 'running');
    });
  }, 60_000);

  it('§6.1 启停 + SSE：dev 任务收到日志事件，停止后非 running', async () => {
    const started = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'dev' });
    expect(started.status).toBe(201);
    const taskId = started.body.id as string;

    const sse = collectSse(bPort, `/api/v1/admin/process/tasks/${taskId}/logs`, accessToken);
    try {
      await waitFor(() => sse.events.some((event) => event.data.type === 'log'));
      const firstLog = sse.events.find((event) => event.data.type === 'log');
      expect(typeof firstLog?.data.line).toBe('string');

      const stopped = await serverB().delete(`/api/v1/admin/process/tasks/${taskId}`);
      expect(stopped.status).toBe(200);
      // SSE 收到 exit 事件后流关闭
      await waitFor(() => sse.events.some((event) => event.data.type === 'exit'));
      await waitFor(async () => (await serverB().get(`/api/v1/admin/process/tasks/${taskId}`)).body.status !== 'running');
    } finally {
      sse.destroy();
    }
  }, 60_000);

  it('§6.4 process.finished：自然退出（build，exitCode=0）与被 kill 均发射', async () => {
    // 自然退出
    const build = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    expect(build.status).toBe(201);
    await waitFor(async () => (await serverB().get(`/api/v1/admin/process/tasks/${build.body.id}`)).body.status !== 'running');
    await waitFor(() =>
      ProcessFinishedSubscriber.received.some((event) => event.task === 'build' && event.exitCode === 0),
    );
    const natural = ProcessFinishedSubscriber.received.find((event) => event.task === 'build' && event.exitCode === 0);
    expect(natural).toBeDefined();
    expect(natural!.durationMs).toBeGreaterThanOrEqual(0);

    // 被 kill（dev 长驻任务）
    const dev = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'dev' });
    await waitFor(async () => (await serverB().get(`/api/v1/admin/process/tasks/${dev.body.id}`)).body.pid > 0);
    await serverB().delete(`/api/v1/admin/process/tasks/${dev.body.id}`);
    await waitFor(() => ProcessFinishedSubscriber.received.some((event) => event.task === 'dev'));
    const killed = ProcessFinishedSubscriber.received.filter((event) => event.task === 'dev');
    expect(killed.length).toBeGreaterThanOrEqual(1);
    expect(typeof killed[0]!.exitCode).toBe('number');
    expect(killed[0]!.durationMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('§6.5 环形缓冲：>2000 行输出 → 缓冲 ≤2000 且保留最新行', async () => {
    const build = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    expect(build.status).toBe(201);
    const taskId = build.body.id as string;
    await waitFor(async () => (await serverB().get(`/api/v1/admin/process/tasks/${taskId}`)).body.status === 'exited');

    // 终态任务的 SSE 回放整个缓冲后发 exit 并关闭
    const sse = collectSse(bPort, `/api/v1/admin/process/tasks/${taskId}/logs`, accessToken);
    await sse.closed;
    const logLines = sse.events.filter((event) => event.data.type === 'log').map((event) => event.data.line);
    expect(logLines.length).toBeLessThanOrEqual(2000);
    expect(logLines.length).toBeGreaterThanOrEqual(1900); // 2500 行 + npm 头行，截断后应接近 2000
    expect(logLines[logLines.length - 1]).toBe('line-2500'); // 最新行保留
    expect(sse.events.some((event) => event.data.type === 'exit')).toBe(true);
  }, 60_000);

  it('§6.6 端口检测：占用端口 inUse=true，空闲端口 false', async () => {
    const probePortNumber = 24681;
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(probePortNumber, resolve));
    try {
      const busy = await serverB().get(`/api/v1/admin/process/ports/${probePortNumber}`);
      expect(busy.status).toBe(200);
      expect(busy.body.inUse).toBe(true);
      expect(busy.body.port).toBe(probePortNumber);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    const free = await serverB().get(`/api/v1/admin/process/ports/${probePortNumber}`);
    expect(free.status).toBe(200);
    expect(free.body.inUse).toBe(false);
    // 非法端口参数 400
    expect((await serverB().get('/api/v1/admin/process/ports/99999')).status).toBe(400);
  });

  it('§6.2 优雅停机：app.close() 后子进程全部退出、无孤儿', async () => {
    const appC = await bootApp(miniRoot);
    const manager = appC.get(ProcessManagerService);
    const cServer = withAuth(request(appC.getHttpServer()), () => accessToken);

    const started = await cServer.post('/api/v1/admin/process/tasks').send({ task: 'dev' });
    expect(started.status).toBe(201);
    const taskId = started.body.id as string;
    const pid = started.body.pid as number;
    await waitFor(() => pidAlive(pid));

    await appC.close(); // 触发 OnApplicationShutdown（与 SIGTERM 入口同一钩子链）

    expect(manager.getTask(taskId).status).not.toBe('running');
    await waitFor(() => !pidAlive(pid), 10_000);
    // 停机后拒绝新任务（C3 起 startTask 含解析链，为异步 Promise 拒绝）
    await expect(manager.startTask('dev')).rejects.toThrow();
  }, 60_000);
});
