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
import { PackageManagerResolver } from '../src/modules/process/pm-resolver';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * C3 §T5 e2e（提示词编号 ⑥⑦）：解析链在真实环境下的用户可见面。
 * ⑥ 未篡改的真实 PATH 下启动 mini-project 任务 → 解析链出真值，任务自然退出 exitCode=0
 *    （ADR-011 验证义务：解析产物实证随测试与交付报告归档）；
 * ⑦ 层①显式路径指向假 shim → 任务启动失败 400，错误信息含 MIZUKI_PM_* 配置指引。
 * 装配沿 P9：app A = 假 Mizuki 项目（init/login），app B = mini-project（任务工作目录）。
 */

const MIZUKI_FIXTURE = path.resolve(__dirname, 'fixtures/mizuki');
const MINI_FIXTURE = path.resolve(__dirname, 'fixtures/mini-project');
const PM_FIXTURE = path.resolve(__dirname, 'fixtures/pm-resolver');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p9b-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const miniRoot = path.join(tmp, 'mini');

const sqliteHandles: Database.Database[] = [];

async function bootApp(root: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
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

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('C3 包管理器解析链 e2e（p9b）', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    fs.cpSync(MIZUKI_FIXTURE, mizukiRoot, { recursive: true });
    fs.cpSync(MINI_FIXTURE, miniRoot, { recursive: true });
    appA = await bootApp(mizukiRoot);
    accessToken = await initAndLogin(request(appA.getHttpServer()), mizukiRoot);
    appB = await bootApp(miniRoot);
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

  const serverB = (): request.SuperTest<request.Test> =>
    withAuth(request(appB.getHttpServer()), () => accessToken);

  it('⑥ 真实解析：未篡改 PATH 下 build 任务经解析链自然退出 exitCode=0（ADR-011 解析产物实证）', async () => {
    // 解析产物直接取证（真实 PATH，无注入）
    const resolver = new PackageManagerResolver();
    const plan = await resolver.resolve('npm', { projectRoot: miniRoot });
    expect(plan.manager).toBe('npm');
    expect(plan.file.length).toBeGreaterThan(0);
    if (process.platform === 'win32' && plan.file === process.execPath) {
      // 垫片穿透形态（npm.cmd → node + npm-cli.js）；若 where 命中直接可执行体则不适用
      expect(plan.argsPrefix[0]).toMatch(/npm-cli\.js$/i);
    }

    // 用户可见面：任务真实启动并成功
    const started = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
    expect(started.status).toBe(201);
    const taskId = started.body.id as string;
    await waitFor(async () => (await serverB().get(`/api/v1/admin/process/tasks/${taskId}`)).body.status === 'exited');
    const finished = await serverB().get(`/api/v1/admin/process/tasks/${taskId}`);
    expect(finished.body.exitCode).toBe(0);
  }, 40_000);

  it('⑦ 层①显式路径指向假 shim → 任务启动失败 400 且错误信息含配置指引（用户可见面）', async () => {
    const fakePath =
      process.platform === 'win32'
        ? path.join(PM_FIXTURE, 'win', 'dangling', 'pnpm.cmd')
        : path.join(PM_FIXTURE, 'posix', 'exit3', 'pnpm');
    process.env['MIZUKI_PM_NPM_PATH'] = fakePath;
    try {
      const res = await serverB().post('/api/v1/admin/process/tasks').send({ task: 'build' });
      expect(res.status).toBe(400);
      const message = String(res.body.message);
      expect(message).toContain('MIZUKI_PM_NPM_PATH');
      expect(message).toContain('不会自动降级');
    } finally {
      delete process.env['MIZUKI_PM_NPM_PATH'];
    }
  }, 30_000);
});
