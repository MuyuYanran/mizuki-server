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
 * [U3-P4a/K1/K2/K3/K4] 任务级环境变量（config.json taskEnv）e2e。
 *
 * 覆盖（8 例）：
 *   ① 空表 GET → `{ items: [] }`；
 *   ② PUT 两条 → GET 掩码视图（长值 `••••`+末 4 字符、短值整体掩码、按 key 字典序）；
 *   ③ 明文永不回：PUT/GET 响应**原文**均不含任何已提交的值（K4/I5 自证）；
 *   ④ 前缀越界（FOO_BAR）与小写形态（bili_x）→ 400 零写盘，detail 只含键名；
 *   ⑤ 安全键（CI / PATH / HOME / APPDATA）→ 400 且 detail 不含值；
 *   ⑥ 上限：17 条 → 400；键名 >64 → 400；单值 >4096 → 400；
 *   ⑦ 整表替换：第二次 PUT 只剩新键（旧键消失）；`{}` = 清空；
 *   ⑧ 注入生效：真实受控任务（tmp 内的 build 探针项目）子进程 env 含 taskEnv 值且 CI 恒为 true。
 *
 * 装配（复用 p9e 两 app 法）：app A = Mizuki 夹具副本（仅 init/login 取 token）；
 *   app B = tmp 内自建探针项目（任务工作目录），两 app 共用 DB / config / secret。
 * 隔离：全部数据在 mkdtemp 临时域，真实主题目录零触碰（AGENTS §4-9）。
 */

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p9f-task-env-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const probeRoot = path.join(tmp, 'probe');
const configPath = process.env['MIZUKI_CONFIG_PATH'] as string;

/** [K4] 用例使用的明文值（断言「响应不回显」时必须能在响应里搜到 0 次） */
const LONG_SECRET = 'sessdata-abc1234567890-tail';
const SECOND_SECRET = 'enable-secret-0099';
const INJECT_SECRET = 'probe-value-778899';

const sqliteHandles: Database.Database[] = [];

/** 落一个最小探针项目：build 打印 taskEnv 注入值与 CI 常量（不走网络、无外部依赖） */
function makeProbeProject(): void {
  fs.mkdirSync(path.join(probeRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(probeRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'mizuki-env-probe',
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
    path.join(probeRoot, 'scripts', 'build.js'),
    [
      "import('node:fs').then((fs) => {",
      '  fs.writeSync(1, "PROBE_TOKEN=" + (process.env.BILI_PROBE_TOKEN ?? "<missing>") + "\\n");',
      '  fs.writeSync(1, "PROBE_CI=" + (process.env.CI ?? "<missing>") + "\\n");',
      '});',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(probeRoot, 'package-lock.json'), '{}\n', 'utf8');
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

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface TaskEnvViewBody {
  items: { key: string; masked: string }[];
}

interface FieldIssue {
  path: string;
  message: string;
}

describe('P9f [U3-P4a] 任务级环境变量（taskEnv）e2e', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });
    makeProbeProject();
    appA = await bootApp(mizukiRoot);
    accessToken = await initAndLogin(request(appA.getHttpServer()), mizukiRoot);
    appB = await bootApp(probeRoot);
  }, 60_000);

  afterAll(async () => {
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

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(appB.getHttpServer()), () => accessToken);

  /** 读 config.json 现值（任务环境变量落盘位置） */
  const readConfigFile = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;

  /** 清空（用例间独立）：PUT {} = 整表清空，合法 */
  const clearTaskEnv = async (): Promise<void> => {
    const res = await server().put('/api/v1/admin/process/task-env').send({ entries: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  };

  it('① 空表 GET → items: []（默认配置零迁移）', async () => {
    await clearTaskEnv();
    const res = await server().get('/api/v1/admin/process/task-env');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('② PUT 两条 → 掩码视图（末 4 字符 / 短值整体掩码 / 按 key 字典序）', async () => {
    const res = await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { BILI_SESSDATA: LONG_SECRET, ENABLE_ANIME_TRACK: 'abc' } });
    expect(res.status).toBe(200);
    const view = res.body as TaskEnvViewBody;
    expect(view.items).toEqual([
      { key: 'BILI_SESSDATA', masked: `••••${LONG_SECRET.slice(-4)}` },
      { key: 'ENABLE_ANIME_TRACK', masked: '••••' },
    ]);
    // GET 与 PUT 同形（同一视图构造单源）
    const got = await server().get('/api/v1/admin/process/task-env');
    expect(got.status).toBe(200);
    expect(got.body).toEqual(view);
    // 落盘为明文（配置文件本身就是凭据载体，不在对外面暴露）
    expect(readConfigFile()['taskEnv']).toEqual({
      BILI_SESSDATA: LONG_SECRET,
      ENABLE_ANIME_TRACK: 'abc',
    });
  });

  it('③ 明文永不回显：PUT / GET 响应原文均不含已提交的值', async () => {
    await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { BILI_SESSDATA: LONG_SECRET, CONTENT_TOKEN: SECOND_SECRET } });
    const get = await server().get('/api/v1/admin/process/task-env');
    expect(get.status).toBe(200);
    // 原始响应文本（非仅 JSON 结构）——含 headers 之外的完整 body
    for (const secret of [LONG_SECRET, SECOND_SECRET, INJECT_SECRET]) {
      expect(get.text).not.toContain(secret);
    }
    // 掩码只保留末 4 字符：短于 8 的值连末 4 都不给（此处两个值均 ≥8）
    expect(get.text).toContain(LONG_SECRET.slice(-4));
    expect(get.text).not.toContain(LONG_SECRET.slice(0, 8));
  });

  it('④ 前缀越界（FOO_BAR）与小写形态（bili_x）→ 400 零写盘，detail 只含键名', async () => {
    await clearTaskEnv();
    const before = fs.readFileSync(configPath, 'utf8');

    const outOfPrefix = await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { FOO_BAR: LONG_SECRET } });
    expect(outOfPrefix.status).toBe(400);
    const issues = (outOfPrefix.body as { detail?: { issues?: FieldIssue[] } }).detail?.issues ?? [];
    expect(issues.some((issue) => issue.path === 'entries.FOO_BAR')).toBe(true);
    // K4：detail 只含键名，不含值
    expect(outOfPrefix.text).not.toContain(LONG_SECRET);

    const lowerCase = await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { bili_sessdata: LONG_SECRET } });
    expect(lowerCase.status).toBe(400);
    const lowerIssues =
      (lowerCase.body as { detail?: { issues?: FieldIssue[] } }).detail?.issues ?? [];
    expect(lowerIssues.some((issue) => issue.message.includes('大写'))).toBe(true);
    expect(lowerCase.text).not.toContain(LONG_SECRET);

    // 零写盘（两次 400 均未触碰配置文件）
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('⑤ 安全键（CI / PATH / HOME / APPDATA）→ 400 且 detail 不含值', async () => {
    await clearTaskEnv();
    const before = fs.readFileSync(configPath, 'utf8');
    for (const forbidden of ['CI', 'PATH', 'HOME', 'APPDATA']) {
      const res = await server()
        .put('/api/v1/admin/process/task-env')
        .send({ entries: { [forbidden]: 'evil-value-should-not-leak' } });
      expect(res.status).toBe(400);
      const issues = (res.body as { detail?: { issues?: FieldIssue[] } }).detail?.issues ?? [];
      expect(issues.some((issue) => issue.message.includes(forbidden))).toBe(true);
      expect(res.text).not.toContain('evil-value-should-not-leak');
    }
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('⑥ 上限：17 条 / 键名 >64 / 单值 >4096 → 400', async () => {
    await clearTaskEnv();
    const before = fs.readFileSync(configPath, 'utf8');

    const seventeen: Record<string, string> = {};
    for (let i = 1; i <= 17; i += 1) {
      seventeen[`BILI_ITEM_${String(i).padStart(2, '0')}`] = `value-${i}`;
    }
    const tooMany = await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: seventeen });
    expect(tooMany.status).toBe(400);
    expect(tooMany.text).toContain('条数超过上限');

    const longKey = `BILI_${'K'.repeat(70)}`;
    const keyTooLong = await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { [longKey]: 'v' } });
    expect(keyTooLong.status).toBe(400);

    const valueTooLong = await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { BILI_BIG: 'x'.repeat(4097) } });
    expect(valueTooLong.status).toBe(400);
    expect(valueTooLong.text).not.toContain('x'.repeat(4097));

    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('⑦ 整表替换语义：旧键消失；{} = 清空', async () => {
    await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { BILI_OLD: LONG_SECRET } });
    const replaced = await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { ANIME_NEW: SECOND_SECRET } });
    expect(replaced.status).toBe(200);
    const keys = (replaced.body as TaskEnvViewBody).items.map((item) => item.key);
    expect(keys).toEqual(['ANIME_NEW']); // 旧键 BILI_OLD 已被整表替换掉

    await clearTaskEnv();
    expect(readConfigFile()['taskEnv']).toEqual({});
    const empty = await server().get('/api/v1/admin/process/task-env');
    expect(empty.body).toEqual({ items: [] });
  });

  it('⑧ 注入生效：受控 build 任务子进程 env 含 taskEnv 值，且 CI 恒为 true', async () => {
    await server()
      .put('/api/v1/admin/process/task-env')
      .send({ entries: { BILI_PROBE_TOKEN: INJECT_SECRET } });

    const started = await server().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    expect(started.status).toBe(201);
    const taskId = started.body.id as string;

    await waitFor(async () => {
      const detail = await server().get(`/api/v1/admin/process/runs/${taskId}`);
      return (detail.body as { finishedAt: string | null }).finishedAt !== null;
    }, 60_000);

    const detail = await server().get(`/api/v1/admin/process/runs/${taskId}`);
    expect(detail.status).toBe(200);
    const logText = (detail.body as { logText: string | null }).logText ?? '';
    // 探针脚本把注入值打到自己的 stdout —— 这是**任务输出**，不是 API 回显 taskEnv
    expect(logText).toContain(`PROBE_TOKEN=${INJECT_SECRET}`);
    // K2 顺序不可变：taskEnv 不能覆盖恒写的 CI 常量
    expect(logText).toContain('PROBE_CI=true');
    expect(logText).not.toContain('PROBE_TOKEN=<missing>');
  }, 90_000);
});
