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
 * [U3-P4a/K6/K7] 番剧/B站配置档纳管 e2e（siteConfig 的 anime / bangumi / bilibili 三键）。
 *
 * 覆盖（8 例）：
 *   ① 无 override → `anime.effective` = 基线三域值，`anime.override` = null；
 *   ② PUT 部分域 → 仅该域物化，其余域**逐字节不变**；
 *   ③ `originals['siteConfig.anime']` 首次留档出现（原初始化器文本）；
 *   ④ 越界键 → 400 零物化（域内 .strict() + 顶层 .strict()）；
 *   ⑤ 第二次 PUT 同域 → `originals` 保持首次原文本（不被 override 文本污染）；
 *   ⑥ 清除 override（`PUT {}`）→ 还原留档原文本 + 侧车 siteAnime 键消失；
 *   ⑦ `PUT /site-info` 回归：15 键契约不变（全键 200 / 越界键 400），且 anime 三键域不受影响；
 *   ⑧ config.ts 非受管成员（含注释）逐字节不变（写入前后逐行比对）。
 *
 * 注：主题根 = fixture cpSync 副本（mkdtemp 临时域），config.ts 本 spec 内联写入，
 * 真实主题目录零触碰；用例按文件序执行且共享状态（每例 reset 复位）。
 */

// 基线：15 受管 siteInfo 键全在位 + 非受管 keyword + 本批三域（anime / bangumi / bilibili）
const BASELINE_FULL = `// [p7k fixture] 非受管注释：写入前后必须逐字节保留
const SITE_LANG = "zh_CN";
const SITE_TIMEZONE = 8;

export const siteConfig = {
  title: "Mizuki",
  subtitle: "副标题",
  siteURL: "https://example.com/",
  siteStartDate: "2024-01-01",
  lang: SITE_LANG,
  timeZone: SITE_TIMEZONE,
  themeColor: {
    hue: 240,
    fixed: false,
  },
  featurePages: {
    anime: true,
    diary: false,
    friends: true,
    projects: true,
    skills: true,
    timeline: true,
    albums: false,
    devices: false,
  },
  navbarTitle: {
    mode: "text-icon",
    text: "MizukiUI",
  },
  postListLayout: {
    defaultMode: "list",
    allowSwitch: true,
    categoryBar: {
      enable: false,
    },
  },
  tagStyle: {
    useNewStyle: true,
  },
  wallpaperMode: {
    defaultMode: "banner",
    showModeSwitchOnMobile: "both",
  },
  banner: {
    src: "assets/images/banner.webp",
    credit: {
      enable: true,
      text: "Unsplash",
    },
  },
  pageScaling: {
    enable: false,
  },
  font: {
    asciiFont: {
      fontFamily: "Roboto",
      fontWeight: "400",
      localFonts: [],
      enableCompress: true,
    },
    cjkFont: {
      fontFamily: "Noto Sans SC",
      fontWeight: 400,
      localFonts: ["a.woff2"],
      enableCompress: true,
    },
  },
  toc: {
    enable: true,
    mobileTop: false,
    desktopSidebar: true,
    floating: false,
    depth: 2,
  },
  keywords: ["blog"],
  bangumi: {
    userId: "fixture-bangumi-user",
    fetchOnDev: false,
  },
  bilibili: {
    vmid: "12345678",
    fetchOnDev: true,
    coverMirror: "https://i0.hdslb.com",
    useWebp: true,
  },
  anime: {
    mode: "local",
  },
};
`;

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7k-site-anime-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const overridePath = process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] as string;

/** 完整 site-info 请求体（15 受管键，与 p7i 同形；lang 不在档内） */
const SITE_INFO_BODY = {
  title: '新站点标题',
  subtitle: '新副标题',
  siteURL: 'https://new.example.com/',
  siteStartDate: '2025-05-06',
  timeZone: -5,
  themeColor: { hue: 120, fixed: true },
  featurePages: {
    anime: false,
    diary: true,
    friends: false,
    projects: true,
    skills: false,
    timeline: true,
    albums: true,
    devices: false,
  },
  navbarTitle: { mode: 'logo', text: 'NewUI', logo: 'assets/images/logo.webp' },
  postListLayout: {
    defaultMode: 'grid',
    allowSwitch: false,
    categoryBar: { enable: true },
  },
  tagStyle: { useNewStyle: false },
  wallpaperMode: { defaultMode: 'fullscreen', showModeSwitchOnMobile: 'off' },
  banner: {
    src: ['assets/images/b1.webp', 'assets/images/b2.webp'],
    credit: { enable: false, text: '自摄' },
  },
  pageScaling: { enable: true, targetWidth: 1600 },
  font: {
    asciiFont: {
      fontFamily: 'Inter',
      fontWeight: 500,
      localFonts: [],
      enableCompress: false,
    },
    cjkFont: {
      fontFamily: '思源黑体',
      fontWeight: '500',
      localFonts: ['cjk.woff2'],
      enableCompress: true,
    },
  },
  toc: { enable: false, mobileTop: true, desktopSidebar: false, floating: true, depth: 3 },
};

interface AnimeView {
  effective: Record<string, Record<string, unknown>>;
  override: Record<string, Record<string, unknown>> | null;
}

interface ConfigView {
  siteInfo: Record<string, unknown> | null;
  anime: AnimeView;
}

describe('U3-P4a：番剧/B站配置档纳管 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    fs.writeFileSync(configTsPath, BASELINE_FULL);
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

  const configTs = (): string => fs.readFileSync(configTsPath, 'utf8');

  const readCarrier = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(overridePath, 'utf8')) as Record<string, unknown>;

  /** 复位：基线 config.ts + 清侧车（用例间独立） */
  const reset = (): void => {
    fs.writeFileSync(configTsPath, BASELINE_FULL);
    if (fs.existsSync(overridePath)) {
      fs.rmSync(overridePath);
    }
  };

  /** 取某域的初始器原文块（fixture 固定两空格缩进：`\n  <key>: { … \n  },`） */
  const domainBlock = (text: string, key: string): string => {
    const match = new RegExp(`\\n {2}${key}: \\{[\\s\\S]*?\\n {2}\\},`).exec(text);
    return match?.[0] ?? '';
  };

  /** 第一个受管域（bangumi）之前的全部文本（非受管成员逐字节比对的载体） */
  const prefixBeforeFirstManagedDomain = (text: string): string => {
    const index = text.indexOf('\n  bangumi: {');
    return index === -1 ? text : text.slice(0, index);
  };

  it('① 无 override → anime.effective 回落到基线三域，override = null', async () => {
    reset();
    const res = await server().get('/api/v1/admin/config');
    expect(res.status).toBe(200);
    const view = res.body as ConfigView;
    expect(view.anime.override).toBeNull();
    expect(view.anime.effective).toEqual({
      anime: { mode: 'local' },
      bangumi: { userId: 'fixture-bangumi-user', fetchOnDev: false },
      bilibili: {
        vmid: '12345678',
        fetchOnDev: true,
        coverMirror: 'https://i0.hdslb.com',
        useWebp: true,
      },
    });
  });

  it('② PUT 部分域 → 仅该域物化，其余域逐字节不变', async () => {
    reset();
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/anime')
      .send({ anime: { mode: 'bangumi' } });
    expect(res.status).toBe(200);
    const view = res.body as ConfigView;
    expect(view.anime.override).toEqual({ anime: { mode: 'bangumi' } });
    expect(view.anime.effective['anime']).toEqual({ mode: 'bangumi' });
    // 未提交的两域仍回落到基线
    expect(view.anime.effective['bangumi']).toEqual({
      userId: 'fixture-bangumi-user',
      fetchOnDev: false,
    });

    const after = configTs();
    expect(after).toContain('mode: "bangumi"');
    // 其余域与另一个 siteConfig 成员逐字节不变
    expect(domainBlock(after, 'bangumi')).toBe(domainBlock(before, 'bangumi'));
    expect(domainBlock(after, 'bilibili')).toBe(domainBlock(before, 'bilibili'));
    expect(after).toContain('keywords: ["blog"]');
  });

  it('③ originals["siteConfig.anime"] 首次留档（原初始化器文本）', async () => {
    reset();
    await server().put('/api/v1/admin/config/anime').send({ anime: { mode: 'bilibili' } });
    const originals = readCarrier()['originals'] as Record<string, string>;
    expect(originals['siteConfig.anime']).toBeDefined();
    expect(originals['siteConfig.anime']).toContain('mode: "local"');
    // 未触碰的域不产生留档条目（本次 body 未含 bangumi/bilibili）
    expect(originals['siteConfig.bangumi']).toBeUndefined();
    expect(originals['siteConfig.bilibili']).toBeUndefined();
    // 侧车只记本次提交的域
    expect(readCarrier()['siteAnime']).toEqual({ anime: { mode: 'bilibili' } });
  });

  it('④ 越界键 → 400 零物化（域内 .strict() + 顶层 .strict()）', async () => {
    reset();
    const before = configTs();
    const insideDomain = await server()
      .put('/api/v1/admin/config/anime')
      .send({ anime: { mode: 'local', unexpected: 1 } });
    expect(insideDomain.status).toBe(400);
    const unknownDomain = await server()
      .put('/api/v1/admin/config/anime')
      .send({ unknownDomain: { mode: 'local' } });
    expect(unknownDomain.status).toBe(400);
    const badEnum = await server()
      .put('/api/v1/admin/config/anime')
      .send({ anime: { mode: 'netflix' } });
    expect(badEnum.status).toBe(400);
    expect(configTs()).toBe(before);
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('⑤ 第二次 PUT 同域 → originals 保持首次原文本（不被 override 文本污染）', async () => {
    reset();
    await server().put('/api/v1/admin/config/anime').send({ anime: { mode: 'bangumi' } });
    const first = (readCarrier()['originals'] as Record<string, string>)['siteConfig.anime'];
    await server().put('/api/v1/admin/config/anime').send({ anime: { mode: 'bilibili' } });
    const second = (readCarrier()['originals'] as Record<string, string>)['siteConfig.anime'];
    expect(second).toBe(first);
    expect(second).toContain('mode: "local"');
    expect(second).not.toContain('bangumi');
    expect(configTs()).toContain('mode: "bilibili"');
  });

  it('⑥ 清除 override（PUT {}）→ 还原留档原文本 + 侧车 siteAnime 消失', async () => {
    reset();
    await server().put('/api/v1/admin/config/anime').send({ anime: { mode: 'bangumi' } });
    expect(configTs()).toContain('mode: "bangumi"');

    const cleared = await server().put('/api/v1/admin/config/anime').send({});
    expect(cleared.status).toBe(200);
    const view = cleared.body as ConfigView;
    expect(view.anime.override).toBeNull();
    expect(view.anime.effective['anime']).toEqual({ mode: 'local' });
    // 物化还原：config.ts 回到主题原值
    expect(configTs()).toContain('mode: "local"');
    expect(configTs()).not.toContain('mode: "bangumi"');
    // 侧车 siteAnime 键消失（原文本留档仍保留，供二次接管）
    expect(readCarrier()['siteAnime']).toBeUndefined();
    expect((readCarrier()['originals'] as Record<string, string>)['siteConfig.anime']).toBeDefined();
  });

  it('⑦ PUT /site-info 回归：15 键契约不变，anime 三域不受影响', async () => {
    reset();
    const before = configTs();
    const ok = await server().put('/api/v1/admin/config/site-info').send(SITE_INFO_BODY);
    expect(ok.status).toBe(200);
    const view = ok.body as ConfigView;
    expect(view.siteInfo).toMatchObject({ title: '新站点标题', timeZone: -5 });
    // 三域未被 site-info 端点触碰（anime 域仍为基线值，override 仍为 null）
    expect(view.anime.override).toBeNull();
    expect(domainBlock(configTs(), 'anime')).toBe(domainBlock(before, 'anime'));

    // 15 键契约未扩张：把这三键塞进 site-info body 会被 .strict() 拒绝
    const leak = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, anime: { mode: 'local' } });
    expect(leak.status).toBe(400);
  });

  it('⑧ config.ts 非受管成员（含注释）逐字节不变', async () => {
    reset();
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/anime')
      .send({ bangumi: { userId: 'fixture-bangumi-user', fetchOnDev: true } });
    expect(res.status).toBe(200);
    const after = configTs();
    // 第一个受管域（bangumi）之前的全部内容必须逐字节相同——覆盖文件头注释、两个 const、
    // 15 个 siteInfo 成员与 keywords（非受管键）。整对象替换只会重写该域自身的字面量块
    // （ts-morph 按同层缩进重排块内续行，属物化格式归一，不改语义）。
    expect(prefixBeforeFirstManagedDomain(after)).toBe(prefixBeforeFirstManagedDomain(before));
    expect(after.split('\n  bangumi: {').length).toBe(before.split('\n  bangumi: {').length);
    // 注释与非受管键逐字保留（上面 prefix 等式已覆盖，此处显式钉住易读锚点）
    expect(after).toContain('// [p7k fixture] 非受管注释：写入前后必须逐字节保留');
    expect(after).toContain('keywords: ["blog"]');
    expect(after).toContain('lang: SITE_LANG');
    // 受管域确实被替换（fetchOnDev false → true；块内格式按语料重排）
    expect(after).toContain('fetchOnDev: true');
    expect(after).not.toContain('fetchOnDev: false');
  });
});
