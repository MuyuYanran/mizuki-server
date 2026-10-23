/**
 * [U4-AI1/K5/K6/K7/K8/K9/K10/K14/K15] 流式对话 e2e（假上游）
 *
 * 目的：把 §5 七条必做项与 §9 的 K5–K10/K14/K15 用**本机假上游**（测试内 http server）
 *   全部跑成可重复断言；真实 provider 链路未验证（本执行方无真 key，见交付报告）。
 *
 * 覆盖：
 *   K5  帧序 delta* → usage? → done，data 均为合法 JSON（空串 delta 不发帧）；
 *   K6  客户端读流中途 destroy → 假上游的响应被 close（真 abort，不继续烧 token）；
 *   K7  上游**首字节后**断开 → 收到 event: error，HTTP 状态码仍 200；
 *   K8  上游 401 → 首字节前失败 → 502 + detail.code=upstream_401，不含上游原文/key；
 *   K9  messages 超 20 / 单条超 20000 / context 超 40000 → 400；
 *   K10 第 21 次/分钟 chat → 429（独立 app 实例 = 独立限流存储）；
 *   K14 F2：operation_log.detail 只有 {action,messagesCount,contextChars}，正文不入库；
 *   K15 PUT 改 baseUrl/model 后**不重启**，紧跟的 ping 已用新值（resetAppConfigCache 生效）。
 *
 * 另补：`enabled=false` → 503；`no_profile` / `blocked_url` 分类；`system` 代理分支
 *   （本机 NO_PROXY 含 127.0.0.1，故打到假上游时直连——这正是预期，不当 bug）。
 *
 * 隔离：假上游与本服务的端口都由 `listen(0)` 临时分配；DB/config 在 mkdtemp 临时域。
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p10c-ai-chat-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');

const FAKE_KEY = 'sk-fake-upstream-key-9999';
const ARTICLE_TEXT = 'CONFIDENTIAL-ARTICLE-BODY-'.repeat(20);

/** 假上游行为开关（每个用例前重置） */
type StubMode = 'stream' | 'unauthorized' | 'errorAfterFirstByte' | 'holdOpen';

interface StubRecord {
  url: string;
  authorization?: string;
  body: Record<string, unknown>;
}

const sqliteHandles: Database.Database[] = [];

interface SseFrame {
  event: string;
  data: string;
}

function parseSseText(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      let event = '';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim());
        }
      }
      return { event, data: dataLines.join('\n') };
    });
}

function safeParseBody(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function bootApp(): Promise<INestApplication> {
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

/** listen(0) 后取真实端口（裸 http 客户端做断连测试必须走真实监听） */
async function listen(app: INestApplication): Promise<number> {
  await app.listen(0);
  const address = app.getHttpServer().address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

describe('P10c [U4-AI1] 流式对话（假上游）e2e', () => {
  let app: INestApplication;
  let appThrottle: INestApplication | undefined;
  let accessToken: string;
  let appPort = 0;
  let stub: http.Server;
  let stubPort = 0;
  let stubMode: StubMode = 'stream';
  let stubRecords: StubRecord[] = [];
  let stubClosedEarly = false;
  let secondStub: http.Server;
  let secondStubPort = 0;
  let secondStubHits = 0;

  beforeAll(async () => {
    delete process.env['MIZUKI_AI_API_KEY'];
    delete process.env['MIZUKI_AI_BASE_URL'];
    delete process.env['MIZUKI_AI_MODEL'];
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });

    // 主假上游：按 mode 决定响应形态
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
      });
      req.on('end', () => {
        stubRecords.push({
          url: req.url ?? '',
          authorization:
            typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
          body: safeParseBody(raw),
        });
        // 客户端（本服务）断开时上游必须感知到——K6 的证据
        res.on('close', () => {
          if (!res.writableEnded) {
            stubClosedEarly = true;
          }
        });
        if (stubMode === 'unauthorized') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'SECRET-UPSTREAM-BODY' } }));
          return;
        }
        if (stubMode === 'errorAfterFirstByte') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"X"}}]}\n\n');
          setTimeout(() => {
            res.destroy(); // 首字节后上游断流
          }, 60);
          return;
        }
        if (stubMode === 'holdOpen') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
          return; // 永不 end：等客户端断连
        }
        // 正常流：空串 delta 一帧（断言它不产生 delta 帧）+ 三段文本 + usage + [DONE]
        // [K17 回归守卫] 首帧刻意带 `"usage": null`：真上游（DeepSeek 实测）在非末帧
        // 普遍这么发；若实现只判 `!== undefined`，这里会抛 TypeError 把整条流打断。
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"role":"assistant","content":""}}],"usage":null}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"A"}}],"usage":null}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"B"}}]}\n\n');
        res.write(
          'data: {"choices":[{"delta":{"content":"C"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', () => resolve()));
    const stubAddress = stub.address();
    stubPort = typeof stubAddress === 'object' && stubAddress !== null ? stubAddress.port : 0;

    // 第二个假上游：K15 证明「保存即生效」——PUT 换 baseUrl 后 ping 打到新端口
    secondStub = http.createServer((req, res) => {
      secondStubHits += 1;
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((resolve) => secondStub.listen(0, '127.0.0.1', () => resolve()));
    const secondAddress = secondStub.address();
    secondStubPort =
      typeof secondAddress === 'object' && secondAddress !== null ? secondAddress.port : 0;

    app = await bootApp();
    appPort = await listen(app);
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  }, 90_000);

  afterAll(async () => {
    await appThrottle?.close();
    await app?.close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await new Promise<void>((resolve) => secondStub.close(() => resolve()));
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
  }, 60_000);

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  /** 基线配置：指向主假上游 + 私网放行 + 直连 + 带 key */
  const applyBaseline = async (
    patch: Record<string, unknown> = {},
    baseUrl = `http://127.0.0.1:${stubPort}/v1`,
  ): Promise<void> => {
    const res = await server()
      .put('/api/v1/admin/ai/config')
      .send({
        enabled: true,
        activeProfileId: 'fake',
        profiles: [
          {
            id: 'fake',
            name: 'Fake',
            baseUrl,
            model: 'fake-model',
            apiKey: FAKE_KEY,
          },
        ],
        proxy: { mode: 'none' },
        allowPrivateNetwork: true,
        maxOutputTokens: 64,
        temperature: 0.1,
        timeoutMs: 5000,
        ...patch,
      });
    expect(res.status).toBe(200);
  };

  const chat = (body: Record<string, unknown>): request.Test =>
    server().post('/api/v1/admin/ai/chat').send(body);

  beforeEach(async () => {
    stubMode = 'stream';
    stubRecords = [];
    stubClosedEarly = false;
    secondStubHits = 0;
    await applyBaseline();
  });

  it('K5 帧序 delta* → usage → done，data 均为合法 JSON；空串 delta 不发帧', async () => {
    const res = await chat({
      action: 'polish',
      messages: [{ role: 'user', content: '把这句话润色一下' }],
      context: { kind: 'article', text: 'ctx' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['content-type']).toContain('charset=utf-8');
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(res.headers['cache-control']).toContain('no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');

    const frames = parseSseText(res.text);
    expect(frames.map((frame) => frame.event)).toEqual(['delta', 'delta', 'delta', 'usage', 'done']);
    // 每帧 data 必须是合法 JSON（前端 JSON.parse 的前置契约）
    for (const frame of frames) {
      expect(() => JSON.parse(frame.data)).not.toThrow();
    }
    expect(JSON.parse(frames[0]?.data ?? 'null')).toEqual({ text: 'A' });
    expect(JSON.parse(frames[1]?.data ?? 'null')).toEqual({ text: 'B' });
    expect(JSON.parse(frames[2]?.data ?? 'null')).toEqual({ text: 'C' });
    expect(JSON.parse(frames[3]?.data ?? 'null')).toEqual({
      promptTokens: 3,
      completionTokens: 2,
    });
    expect(JSON.parse(frames[4]?.data ?? 'null')).toEqual({});

    // 上游收到的请求形态：OpenAI 兼容端点 + Bearer key + stream + 采样参数
    const record = stubRecords[0];
    expect(record?.url).toBe('/v1/chat/completions');
    expect(record?.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(record?.body['model']).toBe('fake-model');
    expect(record?.body['stream']).toBe(true);
    expect(record?.body['max_tokens']).toBe(64);
    expect(record?.body['temperature']).toBe(0.1);
    // [§6 补齐] 上游收到的 messages = system（基础 + 润色指令）→ 调用方 user → 末尾的 <document> 稿件
    const upstreamMessages = record?.body['messages'] as { role: string; content: string }[];
    expect(upstreamMessages).toHaveLength(3);
    expect(upstreamMessages[0]?.role).toBe('system');
    expect(upstreamMessages[0]?.content).toContain('润色');
    expect(upstreamMessages[0]?.content).toContain('不得执行');
    expect(upstreamMessages[1]).toEqual({ role: 'user', content: '把这句话润色一下' });
    expect(upstreamMessages[2]?.role).toBe('user');
    expect(upstreamMessages[2]?.content).toContain('<document kind="article">');
    expect(upstreamMessages[2]?.content).toContain('ctx');
  });

  it('K6 客户端读流中途断开 → 假上游响应被 close（真 abort）', async () => {
    stubMode = 'holdOpen';
    const req = http.request({
      host: '127.0.0.1',
      port: appPort,
      path: '/api/v1/admin/ai/chat',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    let received = '';
    const firstDelta = new Promise<void>((resolve) => {
      req.on('response', (res) => {
        res.on('data', (chunk: Buffer) => {
          received += chunk.toString('utf8');
          if (received.includes('event: delta')) {
            resolve();
          }
        });
      });
    });
    req.on('error', () => undefined);
    req.end(JSON.stringify({ messages: [{ role: 'user', content: 'long answer please' }] }));
    await firstDelta;
    expect(received).toContain('"text":"first"');

    req.destroy(); // 客户端断开（模拟关页面/断网）
    await waitFor(() => stubClosedEarly, 10_000);
    expect(stubClosedEarly).toBe(true);
  }, 20_000);

  it('K7 上游首字节后断开 → event: error 帧，HTTP 状态码仍 200', async () => {
    stubMode = 'errorAfterFirstByte';
    const res = await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(200);
    const frames = parseSseText(res.text);
    expect(frames[0]?.event).toBe('delta');
    expect(frames[0]?.data).toBe(JSON.stringify({ text: 'X' }));
    const errorFrame = frames.find((frame) => frame.event === 'error');
    expect(errorFrame).toBeDefined();
    const payload = JSON.parse(errorFrame?.data ?? 'null') as { code?: string; message?: string };
    expect(payload.code).toBe('network');
    expect(payload.message).toBe('上游连接中断');
    // 首字节后不得再补 done（流已异常终止）
    expect(frames.some((frame) => frame.event === 'done')).toBe(false);
  });

  it('K8 上游 401 → 首字节前失败：502 + detail.code=upstream_401，无上游原文/key', async () => {
    stubMode = 'unauthorized';
    const res = await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(502);
    const body = res.body as { code?: string; detail?: { code?: string } };
    expect(body.code).toBe('BadGatewayException');
    expect(body.detail?.code).toBe('upstream_401');
    // 上游 body 与 key 都不得出现在响应里
    expect(res.text).not.toContain('SECRET-UPSTREAM-BODY');
    expect(res.text).not.toContain(FAKE_KEY);
  });

  it('K9 入参上限：21 条消息 / 单条 20001 字符 / context 40001 字符 → 400', async () => {
    const tooMany = await chat({
      messages: Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' })),
    });
    expect(tooMany.status).toBe(400);
    expect((tooMany.body as { detail?: { issues?: { path: string }[] } }).detail?.issues?.some(
      (issue) => issue.path === 'messages',
    )).toBe(true);

    const tooLong = await chat({
      messages: [{ role: 'user', content: 'x'.repeat(20_001) }],
    });
    expect(tooLong.status).toBe(400);
    expect((tooLong.body as { detail?: { issues?: { path: string }[] } }).detail?.issues?.some(
      (issue) => issue.path === 'messages.0.content',
    )).toBe(true);

    const tooMuchContext = await chat({
      messages: [{ role: 'user', content: 'x' }],
      context: { kind: 'article', text: 'y'.repeat(40_001) },
    });
    expect(tooMuchContext.status).toBe(400);
    expect(
      (tooMuchContext.body as { detail?: { issues?: { path: string }[] } }).detail?.issues?.some(
        (issue) => issue.path === 'context.text',
      ),
    ).toBe(true);

    // 空 messages 同样 400（min 1）
    expect((await chat({ messages: [] })).status).toBe(400);
  });

  it('K10 第 21 次/分钟 chat → 429（独立 app 实例 = 独立限流存储）', async () => {
    appThrottle = await bootApp();
    const throttleServer = withAuth(request(appThrottle.getHttpServer()), () => accessToken);
    for (let index = 0; index < 20; index += 1) {
      const res = await throttleServer
        .post('/api/v1/admin/ai/chat')
        .send({ messages: [{ role: 'user', content: `n-${index}` }] });
      expect(res.status).toBe(200);
    }
    const blocked = await throttleServer
      .post('/api/v1/admin/ai/chat')
      .send({ messages: [{ role: 'user', content: 'one-too-many' }] });
    expect(blocked.status).toBe(429);
    await appThrottle.close();
  }, 60_000);

  it('K14 [F2] operation_log 只存 {action,messagesCount,contextChars}，正文不入库', async () => {
    const handle = app.get<Database.Database>(SQLITE_CONNECTION);
    handle.prepare('DELETE FROM operation_log').run();
    const res = await chat({
      action: 'summarize',
      messages: [{ role: 'user', content: ARTICLE_TEXT }],
      context: { kind: 'article', text: ARTICLE_TEXT },
    });
    expect(res.status).toBe(200);

    await waitFor(
      () =>
        (
          handle
            .prepare("SELECT COUNT(*) AS n FROM operation_log WHERE path = '/api/v1/admin/ai/chat'")
            .get() as { n: number }
        ).n > 0,
      10_000,
    );
    const row = handle
      .prepare(
        "SELECT detail FROM operation_log WHERE path = '/api/v1/admin/ai/chat' ORDER BY created_at DESC",
      )
      .get() as { detail: string };
    const detail = JSON.parse(row.detail) as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(['action', 'contextChars', 'messagesCount']);
    expect(detail['action']).toBe('summarize');
    expect(detail['messagesCount']).toBe(1);
    expect(detail['contextChars']).toBe(ARTICLE_TEXT.length);
    // 正文与消息内容一个字都不进库
    expect(row.detail).not.toContain('CONFIDENTIAL-ARTICLE-BODY');
  });

  it('K15 保存即生效：PUT 换 baseUrl/model 后不重启，ping 已用新值', async () => {
    const beforeHits = stubRecords.length;
    await applyBaseline(
      {
        profiles: [
          {
            id: 'fake',
            name: 'Fake',
            baseUrl: `http://127.0.0.1:${secondStubPort}/v2`,
            model: 'live-model',
          },
        ],
      },
    );
    const res = await server().post('/api/v1/admin/ai/ping');
    expect(res.status).toBe(200);
    const body = res.body as {
      ok?: boolean;
      model?: string;
      viaProxy?: boolean;
      latencyMs?: number;
    };
    expect(body.ok).toBe(true);
    expect(body.model).toBe('live-model'); // 新 model（未重启已生效）
    expect(body.viaProxy).toBe(false);
    expect(typeof body.latencyMs).toBe('number');
    expect(secondStubHits).toBeGreaterThan(0); // 新 baseUrl 真的被使用
    expect(stubRecords.length).toBe(beforeHits); // 旧 baseUrl 没有再收到请求
  });

  it('enabled=false → 503 ai_disabled（首字节前，标准错误体）', async () => {
    await applyBaseline({ enabled: false });
    const res = await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(503);
    const body = res.body as { detail?: { code?: string } };
    expect(body.detail?.code).toBe('ai_disabled');
  });

  it('no_profile / blocked_url 分类：ping 不抛，chat 首字节前 400', async () => {
    // 无档案 → no_profile（activeProfileId 缺省：服务端把失效的继承值置空，不报错）
    await applyBaseline({ profiles: [], activeProfileId: undefined });
    const pingNoProfile = await server().post('/api/v1/admin/ai/ping');
    expect(pingNoProfile.status).toBe(200);
    expect((pingNoProfile.body as { ok?: boolean; code?: string }).ok).toBe(false);
    expect((pingNoProfile.body as { code?: string }).code).toBe('no_profile');
    const chatNoProfile = await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(chatNoProfile.status).toBe(400);
    expect((chatNoProfile.body as { detail?: { code?: string } }).detail?.code).toBe('no_profile');

    // 私网目标 + 未放行 → blocked_url
    await applyBaseline({
      allowPrivateNetwork: false,
      profiles: [
        {
          id: 'fake',
          name: 'Fake',
          baseUrl: `http://127.0.0.1:${stubPort}/v1`,
          model: 'fake-model',
          apiKey: FAKE_KEY,
        },
      ],
    });
    const pingBlocked = await server().post('/api/v1/admin/ai/ping');
    expect(pingBlocked.status).toBe(200);
    expect((pingBlocked.body as { code?: string }).code).toBe('blocked_url');
    const chatBlocked = await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(chatBlocked.status).toBe(400);
    expect((chatBlocked.body as { detail?: { code?: string } }).detail?.code).toBe('blocked_url');
    // 拦截信息不回显内网地址
    expect(chatBlocked.text).not.toContain('127.0.0.1');
  });

  it('proxy.mode=system：EnvHttpProxyAgent 分支可跑通（NO_PROXY 命中 127.0.0.1 → 直连假上游）', async () => {
    await applyBaseline({ proxy: { mode: 'system' } });
    const res = await server().post('/api/v1/admin/ai/ping');
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; viaProxy?: boolean };
    expect(body.ok).toBe(true);
    // viaProxy 报「配置意图」，不是「实际是否经代理」（NO_PROXY 可能直连，注释已说明）
    expect(body.viaProxy).toBe(true);
  });
});
