/**
 * [U4-AI1/K1/K2/K3/K13/K16] AI 配置与掩码 e2e（`/admin/ai/config`）
 *
 * 覆盖：
 *   ① 默认视图（DeepSeek + deepseek-flash + system 代理 + keySource none）；
 *   ② K1：响应体**不含**任何 key 明文，`maskedKey` = `••••`+末 4 位，`apiKey` 字段不出现；
 *   ③ K2：`MIZUKI_AI_API_KEY` 存在 → keySource='env' 且所有档案同掩码；PUT 不带
 *      apiKey 不会覆盖落盘值（env 只覆盖读取，不写盘）；
 *   ④ K3：`keepApiKey` 省略 = 保留；`false` + 无 apiKey = 清空该档案 key；
 *   ⑤ K16：只改 proxy / 只改上限时，档案与 key 一条不丢（浅合并陷阱）；
 *   ⑥ 档案替换 / activeProfileId 悬空 / 语义 400（proxy-url-required、duplicate-profile-id…）；
 *   ⑦ K13（F1）：`apiKey` / `api_key` / `API-KEY` 三种键名在审计 detail 里都掩码为 `***`。
 *
 * 隔离：DB / config.json / override 侧车全在 mkdtemp 临时域；不写真实 Mizuki 目录。
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
import { sanitizeAuditValue } from '../src/common/interceptors/operation-log.interceptor';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin, withAuth } from './helpers/admin-auth';

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p10a-ai-config-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configPath = process.env['MIZUKI_CONFIG_PATH'] as string;

/** 明文 key（断言「响应不回显」时必须在响应原文里搜到 0 次） */
const CONFIG_KEY = 'sk-config-key-aaaa-1111';
const SECOND_KEY = 'sk-second-key-bbbb-2222';
const ENV_KEY = 'sk-env-key-cccc-3333';

const sqliteHandles: Database.Database[] = [];

/** 落盘配置读取（掩码/深合并的最终证据在 config.json，不只看响应） */
function readConfigFile(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
}

interface ProfileView {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  maskedKey: string;
}

interface ConfigViewBody {
  enabled: boolean;
  activeProfileId: string | null;
  profiles: ProfileView[];
  proxy: { mode: string; url?: string };
  allowPrivateNetwork: boolean;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  keySource: 'none' | 'config' | 'env';
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

describe('P10a [U4-AI1] AI 配置（掩码 / keep / 深合并）e2e', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    delete process.env['MIZUKI_AI_API_KEY'];
    delete process.env['MIZUKI_AI_BASE_URL'];
    delete process.env['MIZUKI_AI_MODEL'];
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });
    app = await bootApp();
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  }, 60_000);

  afterAll(async () => {
    delete process.env['MIZUKI_AI_API_KEY'];
    await app.close();
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

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  const getConfig = async (): Promise<ConfigViewBody> => {
    const res = await server().get('/api/v1/admin/ai/config');
    expect(res.status).toBe(200);
    return res.body as ConfigViewBody;
  };

  const putConfig = (body: Record<string, unknown>): request.Test =>
    server().put('/api/v1/admin/ai/config').send(body);

  /** 两条带 key 的档案（K16 的种子；PUT 为整表替换语义，每次测试自建基线） */
  const putSeedProfiles = async (): Promise<void> => {
    const res = await putConfig({
      enabled: false,
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Profile 1',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-flash',
          apiKey: CONFIG_KEY,
        },
        {
          id: 'p2',
          name: 'Profile 2',
          baseUrl: 'https://example.com/v1',
          model: 'm-two',
          apiKey: SECOND_KEY,
        },
      ],
      proxy: { mode: 'system' },
      allowPrivateNetwork: false,
      maxOutputTokens: 1024,
      temperature: 0.7,
      timeoutMs: 30_000,
    });
    expect(res.status).toBe(200);
  };

  it('① 默认视图：DeepSeek + deepseek-flash + system 代理 + keySource none', async () => {
    const view = await getConfig();
    expect(view).toEqual({
      enabled: false,
      activeProfileId: null,
      profiles: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-flash',
          maskedKey: '',
        },
      ],
      proxy: { mode: 'system' },
      allowPrivateNetwork: false,
      maxOutputTokens: 1024,
      temperature: 0.7,
      timeoutMs: 30_000,
      keySource: 'none',
    });
  });

  it('② [K1] 响应不含 key 明文：maskedKey=••••+末4，且视图无 apiKey 字段', async () => {
    await putSeedProfiles();
    const res = await server().get('/api/v1/admin/ai/config');
    expect(res.status).toBe(200);
    const view = res.body as ConfigViewBody;
    expect(view.profiles.map((profile) => profile.maskedKey)).toEqual(['••••1111', '••••2222']);
    // 明文 key 一个字符都不出现在响应原文里
    expect(res.text).not.toContain(CONFIG_KEY);
    expect(res.text).not.toContain(SECOND_KEY);
    for (const profile of view.profiles) {
      expect(Object.keys(profile).sort()).toEqual([
        'baseUrl',
        'id',
        'maskedKey',
        'model',
        'name',
      ]);
    }
    // 落盘保留明文（配置文件本身是凭据载体，不在对外面暴露）
    const ai = readConfigFile()['ai'] as { profiles: { apiKey?: string }[] };
    expect(ai.profiles[0]?.apiKey).toBe(CONFIG_KEY);
    expect(ai.profiles[1]?.apiKey).toBe(SECOND_KEY);
  });

  it('③ [K2] MIZUKI_AI_API_KEY → keySource=env、全档案同掩码；PUT 不带 apiKey 不覆盖落盘值', async () => {
    await putSeedProfiles();
    process.env['MIZUKI_AI_API_KEY'] = ENV_KEY;
    try {
      const envView = await getConfig();
      expect(envView.keySource).toBe('env');
      expect(envView.profiles.map((profile) => profile.maskedKey)).toEqual([
        '••••3333',
        '••••3333',
      ]);
      // PUT 只改代理、不带 apiKey：落盘既有 key 必须原样保留（env 不写盘）
      const put = await putConfig({ proxy: { mode: 'none' } });
      expect(put.status).toBe(200);
      const aiAfterPut = readConfigFile()['ai'] as { profiles: { apiKey?: string }[] };
      expect(aiAfterPut.profiles[0]?.apiKey).toBe(CONFIG_KEY);
      expect(aiAfterPut.profiles[1]?.apiKey).toBe(SECOND_KEY);
    } finally {
      delete process.env['MIZUKI_AI_API_KEY'];
    }
    // 撤掉 env → 回落到 config 来源
    const configView = await getConfig();
    expect(configView.keySource).toBe('config');
    expect(configView.profiles.map((profile) => profile.maskedKey)).toEqual(['••••1111', '••••2222']);
  });

  it('④ [K3] keepApiKey 省略=保留；false+无 apiKey=清空；显式新 key=覆盖', async () => {
    await putSeedProfiles();
    const profileWithoutKey = {
      id: 'p1',
      name: 'Profile 1',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
    };
    // 省略 keepApiKey（同 true）：保留
    const kept = await putConfig({ profiles: [profileWithoutKey] });
    expect(kept.status).toBe(200);
    expect((kept.body as ConfigViewBody).profiles[0]?.maskedKey).toBe('••••1111');

    // keepApiKey:false：该档案 key 被清空（显式清空语义，不是「保留」）
    const cleared = await putConfig({ profiles: [profileWithoutKey], keepApiKey: false });
    expect(cleared.status).toBe(200);
    const clearedView = cleared.body as ConfigViewBody;
    expect(clearedView.profiles[0]?.maskedKey).toBe('');
    const aiCleared = readConfigFile()['ai'] as { profiles: { apiKey?: string }[] };
    expect(aiCleared.profiles[0]?.apiKey).toBeUndefined();

    // 再显式带新 key：写回
    const rekeyed = await putConfig({ profiles: [{ ...profileWithoutKey, apiKey: SECOND_KEY }] });
    expect(rekeyed.status).toBe(200);
    expect((rekeyed.body as ConfigViewBody).profiles[0]?.maskedKey).toBe('••••2222');
  });

  it('⑤ [K16] 深合并不丢数据：只改 proxy / 只改上限，两条档案与 key 仍在', async () => {
    await putSeedProfiles();
    const onlyProxy = await putConfig({ proxy: { mode: 'none' } });
    expect(onlyProxy.status).toBe(200);
    const afterProxy = onlyProxy.body as ConfigViewBody;
    expect(afterProxy.profiles).toHaveLength(2);
    expect(afterProxy.profiles.map((profile) => profile.maskedKey)).toEqual(['••••1111', '••••2222']);
    expect(afterProxy.activeProfileId).toBe('p1');
    expect(afterProxy.proxy).toEqual({ mode: 'none' });

    const onlyLimits = await putConfig({ maxOutputTokens: 512, temperature: 1.2 });
    expect(onlyLimits.status).toBe(200);
    const afterLimits = onlyLimits.body as ConfigViewBody;
    expect(afterLimits.profiles.map((profile) => profile.maskedKey)).toEqual([
      '••••1111',
      '••••2222',
    ]);
    expect(afterLimits.maxOutputTokens).toBe(512);
    expect(afterLimits.temperature).toBe(1.2);

    const ai = readConfigFile()['ai'] as {
      activeProfileId?: string;
      proxy: { mode: string; url?: string };
      profiles: { id: string; apiKey?: string }[];
    };
    expect(ai.profiles.map((profile) => profile.id)).toEqual(['p1', 'p2']);
    expect(ai.profiles.map((profile) => profile.apiKey)).toEqual([CONFIG_KEY, SECOND_KEY]);
    expect(ai.activeProfileId).toBe('p1');
    expect(ai.proxy).toEqual({ mode: 'none' });
  });

  it('⑥ [K16] 删除 active 档案 → activeProfileId 置空；显式指向不存在档案 → 400', async () => {
    await putSeedProfiles();
    // 只保留 p2（p1 被删）：继承来的 activeProfileId 失效 → 置空，且 p2 的 key 保留
    const removed = await putConfig({
      profiles: [
        {
          id: 'p2',
          name: 'Profile 2',
          baseUrl: 'https://example.com/v1',
          model: 'm-two',
        },
      ],
    });
    expect(removed.status).toBe(200);
    const removedView = removed.body as ConfigViewBody;
    expect(removedView.activeProfileId).toBeNull();
    expect(removedView.profiles).toHaveLength(1);
    expect(removedView.profiles[0]?.maskedKey).toBe('••••2222');

    const unknown = await putConfig({ activeProfileId: 'p1' });
    expect(unknown.status).toBe(400);
    const detail = (unknown.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe('unknown-profile');

    const picked = await putConfig({ activeProfileId: 'p2' });
    expect(picked.status).toBe(200);
    expect((picked.body as ConfigViewBody).activeProfileId).toBe('p2');
  });

  it('⑦ 语义/形态校验：custom 缺 url、socks5 代理、重复 id、超限字段 → 400 且零写盘', async () => {
    await putSeedProfiles();
    const before = fs.readFileSync(configPath, 'utf8');

    const noUrl = await putConfig({ proxy: { mode: 'custom' } });
    expect(noUrl.status).toBe(400);
    expect((noUrl.body as { detail?: { code?: string } }).detail?.code).toBe('proxy-url-required');

    const socks = await putConfig({ proxy: { mode: 'custom', url: 'socks5://127.0.0.1:1080' } });
    expect(socks.status).toBe(400);
    expect((socks.body as { detail?: { code?: string } }).detail?.code).toBe('blocked_url');

    const duplicate = await putConfig({
      profiles: [
        { id: 'dup', name: 'A', baseUrl: 'https://a.example/v1', model: 'm' },
        { id: 'dup', name: 'B', baseUrl: 'https://b.example/v1', model: 'm' },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect((duplicate.body as { detail?: { code?: string } }).detail?.code).toBe(
      'duplicate-profile-id',
    );

    const tooManyProfiles = await putConfig({
      profiles: Array.from({ length: 9 }, (_, index) => ({
        id: `p${index}`,
        name: `P${index}`,
        baseUrl: 'https://example.com/v1',
        model: 'm',
      })),
    });
    expect(tooManyProfiles.status).toBe(400);

    expect((await putConfig({ maxOutputTokens: 9000 })).status).toBe(400);
    expect((await putConfig({ temperature: 3 })).status).toBe(400);
    expect((await putConfig({ timeoutMs: 500 })).status).toBe(400);
    // 未声明键（strictObject）也拒，防契约蔓延
    expect((await putConfig({ unexpected: true })).status).toBe(400);

    // 零写盘：所有 400 都没触碰 config.json
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  // ── [K13/F1] 审计脱敏（纯函数单测：PUT 不在 AUDITED_METHODS 内，无法从 HTTP 面覆盖）──
  describe('[K13/F1] operation_log 脱敏词表补 apikey', () => {
    it('apiKey / api_key / API-KEY / 嵌套与数组形态均掩码为 ***，非敏感键原样', () => {
      const sanitized = sanitizeAuditValue({
        apiKey: 'sk-plain-1',
        api_key: 'sk-plain-2',
        'API-KEY': 'sk-plain-3',
        profile: { apiKey: 'sk-plain-4', name: 'keep-me' },
        list: [{ apiKey: 'sk-plain-5' }],
        apiToken: 'sk-plain-6',
        plain: 'visible',
        monkey: 'not-a-key',
      }) as Record<string, unknown>;

      expect(sanitized['apiKey']).toBe('***');
      expect(sanitized['api_key']).toBe('***');
      expect(sanitized['API-KEY']).toBe('***');
      expect(sanitized['apiToken']).toBe('***');
      expect(sanitized['plain']).toBe('visible');
      expect(sanitized['monkey']).toBe('not-a-key');
      expect((sanitized['profile'] as Record<string, unknown>)['apiKey']).toBe('***');
      expect((sanitized['profile'] as Record<string, unknown>)['name']).toBe('keep-me');
      expect((sanitized['list'] as Record<string, unknown>[])[0]?.['apiKey']).toBe('***');
      // 任何明文 key 都不能在 detail 文本里残留
      expect(JSON.stringify(sanitized)).not.toContain('sk-plain');
    });
  });
});
