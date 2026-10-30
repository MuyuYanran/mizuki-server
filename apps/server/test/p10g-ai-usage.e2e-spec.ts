/**
 * [U4-AI3/A] AI 用量台账 e2e（`GET /admin/ai/usage` + 真实上游记账）
 *
 * 覆盖：
 *   ① 空台账：全零且 successRate 为 null（不是 0 —— 「无样本」与「成功率为零」是两件事）；
 *   ② **ping 记账**：scene='ping'，token 三列为 **null**（不读响应体 ⇒ 拿不到 usage，
 *      null 表示未知，不写 0 —— 0 是「确实零消耗」）；
 *   ③ **chat 记账**：scene='chat'，action 透传，token 从上游 usage 帧取值（3+2=5）；
 *   ④ **aborted 与 error 分开**：客户端读流中途 destroy ⇒ status='aborted'，
 *      **不计入错误率**（否则活跃用户的「错误率」会随操作习惯失真）；
 *   ⑤ 参数校验：days 超上限 → 400；
 *   ⑥ 响应体不含 key 明文与宿主机绝对路径（红线 6）。
 *
 * 隔离：假上游与本服务端口都由 listen(0) 临时分配；DB/config 在 mkdtemp 临时域。
 */
import 'reflect-metadata';
import fs from 'node:fs';
import http from 'node:http';
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

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p10g-ai-usage-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');

const API_KEY = 'sk-usage-test-key-zzzz-9999';

/** 假上游模式：正常流 / 挂住不结束（用于构造客户端断连） */
type StubMode = 'normal' | 'holdOpen';

interface UsageViewBody {
  windowDays: number;
  totals: {
    calls: number;
    okCalls: number;
    errorCalls: number;
    abortedCalls: number;
    tokenSamples: number;
    totalTokens: number;
    successRate: number | null;
  };
  byAction: { action: string | null; calls: number; totalTokens: number }[];
  recent: { scene: string; action: string | null; promptTokens: number | null; totalTokens: number | null; status: string }[];
  retainedRows: number;
  keepLimit: number;
}

describe('[U4-AI3/A] AI 用量台账 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  let appPort = 0;
  let stub: http.Server;
  let stubPort = 0;
  let stubMode: StubMode = 'normal';

  async function bootApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BACKUP_OPTIONS)
      .useValue({
        mizukiRoot,
        backupDir: path.join(tmp, 'backups'),
        dbPath: process.env['MIZUKI_DB_PATH'] as string,
      })
      .compile();
    const instance = moduleRef.createNestApplication();
    configureApp(instance);
    await instance.init();
    return instance;
  }

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  const usage = async (query = ''): Promise<UsageViewBody> => {
    const res = await server().get(`/api/v1/admin/ai/usage${query}`);
    expect(res.status).toBe(200);
    return res.body as UsageViewBody;
  };

  beforeAll(async () => {
    delete process.env['MIZUKI_AI_API_KEY'];
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });

    stub = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (stubMode === 'holdOpen') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
          return; // 永不 end：等客户端断连
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"A"}}],"usage":null}\n\n');
        res.write(
          'data: {"choices":[{"delta":{"content":"B"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', () => resolve()));
    const addr = stub.address();
    stubPort = typeof addr === 'object' && addr !== null ? addr.port : 0;

    app = await bootApp();
    await app.listen(0);
    const appAddr = app.getHttpServer().address();
    appPort = typeof appAddr === 'object' && appAddr !== null ? appAddr.port : 0;
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);

    // 配置 AI 指向假上游。三个要点缺一不可：
    //   ① `apiKey` 随 PUT 提交（否则 no_key 早退，压根不发请求 ⇒ 无从记账）；
    //   ② `allowPrivateNetwork: true`（假上游在 127.0.0.1，默认被出站闸拦下 ⇒ 400 blocked）；
    //   ③ `proxy.mode: 'none'`（本机 NO_PROXY 虽含 127.0.0.1，显式直连更稳）。
    const put = await server()
      .put('/api/v1/admin/ai/config')
      .send({
        enabled: true,
        activeProfileId: 'stub',
        profiles: [
          {
            id: 'stub',
            name: 'Stub',
            baseUrl: `http://127.0.0.1:${stubPort}/v1`,
            model: 'stub-model',
            apiKey: API_KEY,
          },
        ],
        proxy: { mode: 'none' },
        allowPrivateNetwork: true,
        maxOutputTokens: 64,
        temperature: 0.1,
        timeoutMs: 5000,
      });
    expect(put.status).toBe(200);
  });

  afterAll(async () => {
    delete process.env['MIZUKI_AI_API_KEY'];
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('① 空台账：全零且 successRate=null', async () => {
    const view = await usage();
    expect(view.totals.calls).toBe(0);
    expect(view.totals.successRate).toBeNull();
    expect(view.recent).toEqual([]);
    expect(view.keepLimit).toBeGreaterThan(0);
  });

  it('② ping 记账：scene=ping 且 token 三列为 null（不写 0）', async () => {
    const ping = await server().post('/api/v1/admin/ai/ping');
    expect(ping.status).toBe(200);

    const view = await usage();
    const row = view.recent.find((r) => r.scene === 'ping');
    expect(row).toBeDefined();
    expect(row?.promptTokens).toBeNull();
    expect(row?.totalTokens).toBeNull();
    expect(row?.status).toBe('ok');
  });

  it('③ chat 记账：scene=chat + action 透传 + token 取自上游 usage', async () => {
    stubMode = 'normal';
    const res = await server()
      .post('/api/v1/admin/ai/chat')
      .send({ action: 'polish', messages: [{ role: 'user', content: '你好' }] });
    expect(res.status).toBe(200);

    const view = await usage();
    const row = view.recent.find((r) => r.scene === 'chat');
    expect(row).toBeDefined();
    expect(row?.action).toBe('polish');
    expect(row?.promptTokens).toBe(3);
    expect(row?.totalTokens).toBe(5); // 3 + 2
    expect(row?.status).toBe('ok');
  });

  it('③ 聚合：按动作分组且 totals 正确', async () => {
    const view = await usage();
    const polish = view.byAction.find((r) => r.action === 'polish');
    expect(polish?.calls).toBe(1);
    expect(polish?.totalTokens).toBe(5);
    expect(view.totals.calls).toBeGreaterThanOrEqual(2);
  });

  it('④ 客户端断连 ⇒ status=aborted，且**不计入错误率**', async () => {
    stubMode = 'holdOpen';
    const before = await usage();

    // 裸 http 客户端读流中途 destroy（supertest 不便精确控制时机）
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: appPort,
          path: '/api/v1/admin/ai/chat',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken ?? ''}`,
          },
        },
        (res) => {
          res.once('data', () => {
            req.destroy(); // 读到首帧就断开
            resolve();
          });
        },
      );
      req.on('error', () => resolve());
      req.end(JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }));
    });

    // 给服务端一点时间走完 finally 记账
    await new Promise((r) => setTimeout(r, 400));

    const after = await usage();
    expect(after.totals.abortedCalls).toBe(before.totals.abortedCalls + 1);
    // 关键：错误数**没有**增加（aborted 不是故障）
    expect(after.totals.errorCalls).toBe(before.totals.errorCalls);
    // 成功率分母不含 aborted ⇒ 值不变
    expect(after.totals.successRate).toBe(before.totals.successRate);
    stubMode = 'normal';
  });

  it('⑤ 参数校验：days 超上限 ⇒ 400；合法 days 生效', async () => {
    const bad = await server().get('/api/v1/admin/ai/usage?days=999');
    expect(bad.status).toBe(400);
    const good = await usage('?days=30');
    expect(good.windowDays).toBe(30);
  });

  it('⑥ 响应零泄漏：不含 key 明文与绝对路径', async () => {
    const res = await server().get('/api/v1/admin/ai/usage');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(text).not.toContain(tmp);
  });
});
