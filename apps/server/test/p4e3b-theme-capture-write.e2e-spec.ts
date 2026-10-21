import 'reflect-metadata';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { ThemeStatusViewSchema } from '@mizuki/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { projectInternalPath } from '../src/common/fs/path-projection';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [U3-P4b/T2 后端零改动] theme capture 的写面 e2e：钉住漂移呈现面板依赖的三条行为。
 * ① `GET /admin/theme/status` 过 `ThemeStatusViewSchema.safeParse`（严格契约锚：面板类型面
 *    = shared schema，增删字段必须先过 schema）+ [DEF-06 ①] 基线 JSON 损坏时
 *    `baseline.detail` 用相对投影（含 `data/theme-baseline/baseline.json`，不含盘符绝对路径）
 *    + 投影 helper 单源自校验（根内 → 相对 POSIX；越界 → `<data>/末两段`）；
 * ② `POST /admin/theme/capture` → 201、`drift.state === 'clean'`、基线文件落在 mkdtemp 注入路径、
 *    且捕获前后 `<mizukiRoot>/src/config.ts` 的 sha256 **相等**（只写基线、不改主题源码）；
 * ③ 写失败（`MIZUKI_THEME_BASELINE_PATH` 的父路径是**普通文件**）→ 500 / `InternalError` /
 *    `detail: null`，且 mkdtemp 内无 `.tmp-*` 残留（原子写清理语义）。
 * 注：主题根 = fixture cpSync 副本 + 内联最小 `src/config.ts`（p4e3a 同款），真实主题目录零触碰。
 */

// 主题 config.ts 基线（形态仿真实主题：非导出常量 + 标识符引用 + LinkPreset 标识符 + children 嵌套）
const BASELINE_CONFIG_TS = `const SITE_LANG = "zh_CN";
const SITE_TIMEZONE = 8;

export const siteConfig = {
  title: "Mizuki",
  subtitle: "副标题",
  siteURL: "https://example.com/",
  lang: SITE_LANG,
  timeZone: SITE_TIMEZONE,
  navbarTitle: {
    mode: "text-icon",
    text: "MizukiUI",
  },
};

export const commentConfig = {
  enable: false,
  system: "twikoo",
  twikoo: {
    envId: "https://twikoo.vercel.app",
    lang: SITE_LANG,
  },
};

export const navBarConfig = {
\tlinks: [
\t\tLinkPreset.Home,
\t\t{ name: "关于", url: "/about/", icon: "fa7-solid:user" },
\t],
};

export const profileConfig = {
  name: "Mizuki",
  links: [
    {
      name: "GitHub",
      url: "https://github.com/matsuzaka-yuki/Mizuki",
      icon: "fa7-brands:github",
    },
  ],
};

export const announcementConfig = {
  content: "欢迎",
};
`;

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
/** 服务根（`<apps/server>`）：本 spec 位于 `<apps/server>/test`，上溯一级 */
const SERVER_ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4e3b-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const baselinePath = path.join(tmp, 'data', 'theme-baseline', 'baseline.json');
process.env['MIZUKI_THEME_BASELINE_PATH'] = baselinePath;
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');

/** theme-status 响应视图（宽松断言面，逐字段窄化） */
interface ThemeStatusLike {
  identity: { name: string | null; version: string | null; fallback: string };
  fingerprint: {
    scannedAt: string;
    digest: string;
    entries: { path: string; role: string; present: boolean; sha256: string | null }[];
  };
  baseline: {
    state: 'absent' | 'loaded' | 'version-mismatch' | 'parse-error';
    profileVersion: string | null;
    capturedAt: string | null;
    detail: string | null;
  };
  drift: { state: 'no-baseline' | 'clean' | 'drifted'; items: { path: string; kind: string }[] };
  probes: { target: string; passed: boolean; detail: string }[];
}

describe('U3-P4b/T2：theme capture 写面（只写基线、失败不谎报）e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true }); // fixture 唯一数据源：先 cp 再操作
    fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS); // 主题 config.ts 基线（本 spec 内联，零 fixture 变更）
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
    // Windows 句柄释放延迟：重试清理，最终失败不阻塞套件
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

  const statusOf = async (): Promise<{ status: number; body: ThemeStatusLike }> => {
    const res = await server().get('/api/v1/admin/theme/status');
    return { status: res.status, body: res.body as ThemeStatusLike };
  };

  const sha256Of = (absPath: string): string =>
    createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');

  /** `.tmp-*` 残留递归扫描（原子写清理语义的负向锚） */
  const findTmpResidue = (root: string): string[] => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) {
        return;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.name.startsWith('.tmp-')) {
          found.push(abs);
        }
        if (entry.isDirectory()) {
          walk(abs);
        }
      }
    };
    walk(root);
    return found;
  };

  it('① GET status 过 ThemeStatusViewSchema（严格契约锚）+ DEF-06 基线损坏 detail 投影', async () => {
    // (a) 严格契约：无基线态也是合法 ThemeStatusView（面板类型面 = shared schema）
    const absent = await statusOf();
    expect(absent.status).toBe(200);
    const parsed = ThemeStatusViewSchema.safeParse(absent.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(absent.body.baseline.state).toBe('absent');
    expect(absent.body.baseline.detail).toBeNull();

    // (b) 投影 helper 单源自校验：根内 → 相对 POSIX；越界 → `<data>/末两段`（永不出盘符）
    expect(projectInternalPath(path.join(SERVER_ROOT, 'data', 'config-override.json'))).toBe(
      'data/config-override.json',
    );
    expect(
      projectInternalPath(path.join(SERVER_ROOT, 'data', 'theme-baseline', 'baseline.json')),
    ).toBe('data/theme-baseline/baseline.json');
    expect(projectInternalPath(path.join(tmp, 'config-override.json'))).toBe(
      '<data>/config-override.json',
    );
    // 越界且无 `data` 段：只留文件名（主机目录层级不进文案）
    expect(projectInternalPath(path.join(tmp, 'no-data-dir', 'baseline.json'))).toBe(
      '<data>/baseline.json',
    );
    // 越界但带 `data` 段（自托管把 data 目录指到服务根之外）：归一到 `data/` 前缀（与根内同构）
    expect(projectInternalPath(path.join(tmp, 'data', 'theme-baseline', 'baseline.json'))).toBe(
      'data/theme-baseline/baseline.json',
    );

    // (c) [DEF-06 ①] 基线 JSON 损坏 → parse-error 且 detail 为相对投影（含数据文件名、不含绝对路径）
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, '{ this is not json');
    try {
      const broken = await statusOf();
      expect(broken.status).toBe(200);
      expect(broken.body.baseline.state).toBe('parse-error');
      expect(ThemeStatusViewSchema.safeParse(broken.body).success).toBe(true);
      const detail = broken.body.baseline.detail ?? '';
      expect(detail).toContain('data/theme-baseline/baseline.json'); // 相对投影（`<data>/…` 形态亦满足）
      expect(detail).not.toMatch(/[A-Za-z]:\\/); // 无盘符
      expect(detail).not.toContain(tmp); // 无 mkdtemp 绝对前缀
      expect(detail).not.toContain('\\\\'); // 无反斜杠形态残留（POSIX 投影）
    } finally {
      fs.rmSync(baselinePath, { force: true }); // 复位为「无基线」态，供 ② 从零捕获
    }
    expect(fs.existsSync(baselinePath)).toBe(false);
  });

  it('② POST capture → 201 / drift=clean / 基线落在 mkdtemp / config.ts 哈希不变', async () => {
    const before = sha256Of(configTsPath);
    const res = await server().post('/api/v1/admin/theme/capture');
    expect(res.status).toBe(201);

    const body = res.body as ThemeStatusLike;
    // capture 返回值本身就是最新 ThemeStatusView（面板直接渲染，不发第二次请求）
    expect(ThemeStatusViewSchema.safeParse(res.body).success).toBe(true);
    expect(body.baseline.state).toBe('loaded');
    expect(body.baseline.capturedAt).not.toBeNull();
    expect(body.drift.state).toBe('clean');
    expect(body.drift.items).toEqual([]);

    // 只写基线：文件落在 env 注入的 mkdtemp 路径，且在临时域内（非真实 data 目录）
    expect(fs.existsSync(baselinePath)).toBe(true);
    expect(path.resolve(baselinePath).startsWith(path.resolve(tmp))).toBe(true);
    // 不改主题源码：config.ts 字节级不变
    expect(sha256Of(configTsPath)).toBe(before);
  });

  it('③ 写失败（父路径是普通文件）→ 500 InternalError / detail null / 无 .tmp-* 残留', async () => {
    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, 'not a directory'); // 父路径 = 普通文件 → mkdir/write 必失败
    const failingPath = path.join(blocker, 'baseline.json');
    process.env['MIZUKI_THEME_BASELINE_PATH'] = failingPath;
    try {
      const res = await server().post('/api/v1/admin/theme/capture');
      expect(res.status).toBe(500);
      expect((res.body as { code?: string }).code).toBe('InternalError');
      expect((res.body as { detail?: unknown }).detail).toBeNull();
      // 对外文案不得含绝对路径（含 500 分支）
      expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:\\/);
      expect(JSON.stringify(res.body)).not.toContain(tmp);
    } finally {
      process.env['MIZUKI_THEME_BASELINE_PATH'] = baselinePath; // 复原 env（活读纪律）
      fs.rmSync(blocker, { force: true });
    }
    // 原子写清理语义：失败路径不遗留临时文件
    expect(findTmpResidue(tmp)).toEqual([]);
    // 失败不改既有状态：基线仍是 ② 捕获的那份，漂移轴仍 clean
    expect(fs.existsSync(baselinePath)).toBe(true);
    const after = await statusOf();
    expect(after.body.baseline.state).toBe('loaded');
    expect(after.body.drift.state).toBe('clean');
  });
});
