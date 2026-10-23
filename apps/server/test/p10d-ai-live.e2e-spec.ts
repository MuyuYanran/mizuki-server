/**
 * [U4-AI1/真链路] 真实 provider 验收（**默认跳过**，只在显式提供 key 时运行）
 *
 * 为什么单独一个文件：p10a/p10b/p10c 全部用本机假上游，证明的是**协议与边界**；
 * 真上游才能证明「Bearer 头 + baseUrl + model 名 + 代理分支」在真实网络下成立
 * （尤其 model id 会随 provider 版本变化——本仓首次接入时就踩到 `deepseek-chat`
 * 已不存在，只有 `deepseek-flash` / `deepseek-v4-pro`）。
 *
 * 运行方式（key **不落盘、不入库、不写交付报告**）：
 *   MIZUKI_AI_LIVE_KEY=sk-xxx pnpm --filter @mizuki/server exec vitest run \
 *     test/p10d-ai-live.e2e-spec.ts --maxWorkers=1
 *
 * 门禁与纪律：
 *   - 门禁变量是 `MIZUKI_AI_LIVE_KEY`（**不是** `MIZUKI_AI_API_KEY`）：本文件在
 *     beforeAll 里把它注入成后者供服务消费，避免与其他 spec 的 env 清理互相污染；
 *   - 未设置门禁时整块 `describe.skip` ⇒ CI 与日常全量跑永远跳过，不会误发网络请求；
 *   - 断言失败只打印**分类码与长度**，任何情况下不打印 key、上游 body 或 URL。
 */
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

const LIVE_KEY = (process.env['MIZUKI_AI_LIVE_KEY'] ?? '').trim();
const LIVE_BASE_URL = (process.env['MIZUKI_AI_LIVE_BASE_URL'] ?? 'https://api.deepseek.com/v1').trim();
const LIVE_MODEL = (process.env['MIZUKI_AI_LIVE_MODEL'] ?? 'deepseek-flash').trim();
/** 本机真实网络形态：环境里已有 HTTPS_PROXY，故 system 分支会真的走代理 */
const LIVE_PROXY_MODE = (process.env['MIZUKI_AI_LIVE_PROXY_MODE'] ?? 'system').trim();

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p10d-ai-live-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configPath = process.env['MIZUKI_CONFIG_PATH'] as string;

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

const sqliteHandles: Database.Database[] = [];

const describeLive = LIVE_KEY === '' ? describe.skip : describe;

describeLive('P10d [U4-AI1] 真链路验收（真实 provider，需 MIZUKI_AI_LIVE_KEY）', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    // 门禁变量 → 服务消费变量（env 优先级最高，key 因此不必进 config.json）
    process.env['MIZUKI_AI_API_KEY'] = LIVE_KEY;
    delete process.env['MIZUKI_AI_BASE_URL'];
    delete process.env['MIZUKI_AI_MODEL'];
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });

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

    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);

    const res = await withAuth(request(app.getHttpServer()), () => accessToken)
      .put('/api/v1/admin/ai/config')
      .send({
        enabled: true,
        activeProfileId: 'deepseek',
        profiles: [
          // 故意**不带 apiKey**：验证 env 通道端到端可用
          { id: 'deepseek', name: 'DeepSeek', baseUrl: LIVE_BASE_URL, model: LIVE_MODEL },
        ],
        proxy: { mode: LIVE_PROXY_MODE },
        allowPrivateNetwork: false,
        maxOutputTokens: 64,
        temperature: 0,
        timeoutMs: 30_000,
      });
    expect(res.status).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    for (const handle of sqliteHandles) {
      try {
        handle.close();
      } catch {
        /* 已关闭 */
      }
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

  it('L1 配置视图：keySource=env，且 key 明文不出现在响应里', async () => {
    const res = await withAuth(request(app.getHttpServer()), () => accessToken).get(
      '/api/v1/admin/ai/config',
    );
    expect(res.status).toBe(200);
    expect(res.body.keySource).toBe('env');
    expect(res.body.enabled).toBe(true);
    expect(res.body.activeProfileId).toBe('deepseek');
    // 掩码形态：•••• + 末 4 位（不含完整 key）
    expect(res.body.profiles[0].maskedKey).toBe(`••••${LIVE_KEY.slice(-4)}`);
    expect(JSON.stringify(res.body)).not.toContain(LIVE_KEY);
  });

  it('L2 真上游 ping：ok=true 且有延迟与模型回显', async () => {
    const res = await withAuth(request(app.getHttpServer()), () => accessToken).post(
      '/api/v1/admin/ai/ping',
    );
    // 失败时只打分类码，绝不打印上游内容
    if (res.body.ok !== true) {
      throw new Error(`ping 失败：code=${String(res.body.code)} latency=${String(res.body.latencyMs)}`);
    }
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.latencyMs).toBe('number');
    expect(res.body.latencyMs).toBeGreaterThan(0);
    expect(res.body.model).toBe(LIVE_MODEL);
    expect(typeof res.body.viaProxy).toBe('boolean');
  }, 60_000);

  it('L3 真上游流式对话：SSE 帧序合法、delta 拼接非空、以 done 收尾', async () => {
    const res = await withAuth(request(app.getHttpServer()), () => accessToken)
      .post('/api/v1/admin/ai/chat')
      .send({
        messages: [{ role: 'user', content: '请只回答四个字：连接正常' }],
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-accel-buffering']).toBe('no');

    const frames = parseSseText(res.text);
    const events = frames.map((frame) => frame.event);
    // 失败自诊断：只回我们自己分类器的 code（不含 key、不含上游 body/URL）
    const errorFrame = frames.find((frame) => frame.event === 'error');
    if (errorFrame !== undefined) {
      const code = (JSON.parse(errorFrame.data) as { code?: string }).code ?? 'unknown';
      throw new Error(`流式返回 error 帧：code=${code}（帧数=${frames.length}）`);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toBe('done');

    for (const frame of frames) {
      expect(() => JSON.parse(frame.data)).not.toThrow();
    }
    const text = frames
      .filter((frame) => frame.event === 'delta')
      .map((frame) => (JSON.parse(frame.data) as { text?: string }).text ?? '')
      .join('');
    expect(text.trim().length).toBeGreaterThan(0);
  }, 90_000);

  it('L4 key 未落盘：临时 config.json 里不含 key 明文', () => {
    const persisted = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    expect(persisted).not.toContain(LIVE_KEY);
    // 反向确认配置确实写进去了（否则上面的断言会假绿）
    expect(persisted).toContain('"ai"');
    expect(persisted).toContain(LIVE_MODEL);
  });
});
