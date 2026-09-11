import 'reflect-metadata';
import crypto from 'node:crypto';
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
 * [Phase4-D4/C3] override 侧车路径隔离加固 e2e（架构师授权 2026-09-08，数账 414→417 之③）：
 * 仅注入 MIZUKI_CONFIG_PATH（不设 MIZUKI_CONFIG_OVERRIDE_PATH）时，侧车随其目录派生
 * （<dirname(config.json)>/config-override.json），真实 data 目录零触碰。
 * 事故根因（2026-09-07 走查侧车事故，见 SESSIONS）：加固前侧车路径硬编码
 * apps/server/data/config-override.json，不随 MIZUKI_CONFIG_PATH 走 → 隔离实例
 * （仅注入 CONFIG_PATH）误写真实 data 侧车。
 * 显式 OVERRIDE_PATH 最优先分支由 p7f ① 权威覆盖（p7f 同注两者），此处不重复。
 * 注：主题根用 mizuki fixture cpSync 后内联写入最小 src/config.ts（零 fixture 变更）。
 */

const BASELINE_CONFIG_TS = `const SITE_LANG = "zh_CN";
const SITE_TIMEZONE = 8;

export const siteConfig = {
  title: "Mizuki",
  lang: SITE_LANG,
  timeZone: SITE_TIMEZONE,
  navbarTitle: {
    mode: "text-icon",
    text: "MizukiUI",
  },
};
`;

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
// cfg 子目录：使「派生侧车」与任何缺省/巧合路径空间隔离（p7f 的 tmp 同目录巧合不可复现）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7h-e2e-'));
const cfgDir = path.join(tmp, 'cfg');
const realDataOverride = path.resolve(__dirname, '../data/config-override.json');
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
// 派生分支前提：无显式 OVERRIDE_PATH（vitest isolate 每文件独立环境，此为纵深防御）
delete process.env['MIZUKI_CONFIG_OVERRIDE_PATH'];
process.env['MIZUKI_CONFIG_PATH'] = path.join(cfgDir, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const derivedOverridePath = path.join(cfgDir, 'config-override.json');

describe('Phase4-D4/C3：override 侧车路径隔离（MIZUKI_CONFIG_PATH 目录派生）e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;
  let realDataOverrideShaBefore: string | null;

  beforeAll(async () => {
    // 真实 data 侧车快照（存在性 + sha256；不存在则记 null，断言「仍不存在」）
    realDataOverrideShaBefore = fs.existsSync(realDataOverride)
      ? crypto.createHash('sha256').update(fs.readFileSync(realDataOverride)).digest('hex')
      : null;
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS);
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
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
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

  it('C3-① 仅注入 MIZUKI_CONFIG_PATH：PUT lang 后侧车落注入目录派生路径、真实 data 目录零触碰', async () => {
    // PUT lang 走真实写管线（ts-morph 物化 + 侧车持久化）
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: 'en' });
    expect(put.status).toBe(200);

    // 侧车落注入目录派生路径（cfg/config-override.json），含 override 值
    expect(fs.existsSync(derivedOverridePath)).toBe(true);
    const carrier = JSON.parse(fs.readFileSync(derivedOverridePath, 'utf8')) as {
      version?: number;
      siteConfig?: { lang?: string };
      originals?: Record<string, unknown>;
    };
    expect(carrier.version).toBe(1);
    expect(carrier.siteConfig?.lang).toBe('en');
    // originals 留档保留（还原义务）
    expect(carrier.originals).toBeDefined();

    // 真实 data 目录零触碰：侧车 sha 前后一致（不存在 → 仍不存在）
    if (realDataOverrideShaBefore === null) {
      expect(fs.existsSync(realDataOverride)).toBe(false);
    } else {
      const after = crypto.createHash('sha256').update(fs.readFileSync(realDataOverride)).digest('hex');
      expect(after).toBe(realDataOverrideShaBefore);
    }
  });
});
