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
 * [U3-P4c/K11~K16] 特效非敏感开关纳管 e2e（A-GAP-04）。
 *
 * 覆盖（11 例）：
 *   ① 无 override → effects 三域 = 基线值，且响应不含 `meting_api` / `auth=` 凭据面；
 *   ② PUT 部分键 → 仅提交键物化，同一对象其余键 / 其余声明 / 注释逐字节不变；
 *   ③ body 含 `meting_api` → 400（`.strict()` 机械排除），config.ts 字节零变化；
 *   ④ `originals['musicPlayerConfig.enable']` 首次留档 = 原初始化器文本；
 *   ⑤ 第二次 PUT 同键 → `originals` 保持首次原文本；
 *   ⑥ sakura 嵌套整值 + pio.dialog 整值同时提交 → 各自物化，musicPlayerConfig 零触碰；
 *   ⑦ 值域越界（sakuraNum -1 / zIndex 1e9 / pio.width 0）→ 400 零物化；
 *   ⑧ 基线缺 `pioConfig` 声明 → GET 该域 null、PUT 404 零物化；
 *   ⑨ `widgetConfigs` 的 `music: musicPlayerConfig` 行逐字不变（再裁 C）；
 *   ⑩ `PUT /admin/config/site-info` 回归：15 键契约与既有字段不变（effects 为 additive）；
 *   ⑪ `PUT {}` 还原留档原文 + 侧车 `siteEffects` 消失；`PUT /anime` 回归不触碰特效三档。
 *
 * 注：mkdtemp 临时域；config.ts 由本 spec 内联写入（§1.0#22 范式），真实主题目录零触碰。
 * 用例按文件序执行且共享状态（每例 reset 复位：写回基线 + 删侧车）。
 */

/** 基线：注释 + 三个特效顶层声明 + widgetConfigs 引用 + 15 受管 siteInfo 键 */
const BASELINE_FULL = `// [p7m fixture] 注释必须逐字节保留
const SITE_LANG = "zh_CN";

export const siteConfig = {
  title: "Mizuki",
  subtitle: "副标题",
  siteURL: "https://example.com/",
  siteStartDate: "2024-01-01",
  timeZone: 8,
  themeColor: { hue: 240, fixed: false },
  featurePages: { anime: true, diary: false, friends: true, projects: true, skills: true, timeline: true, albums: false, devices: false },
  navbarTitle: { mode: "text-icon", text: "MizukiUI" },
  postListLayout: { defaultMode: "list", allowSwitch: true, categoryBar: { enable: false } },
  tagStyle: { useNewStyle: true },
  wallpaperMode: { defaultMode: "banner", showModeSwitchOnMobile: "both" },
  banner: { src: "assets/images/banner.webp", credit: { enable: true, text: "Unsplash" } },
  pageScaling: { enable: false },
  font: {
    asciiFont: { fontFamily: "Roboto", fontWeight: "400", localFonts: [], enableCompress: true },
    cjkFont: { fontFamily: "Noto Sans SC", fontWeight: 400, localFonts: ["a.woff2"], enableCompress: true },
  },
  toc: { enable: true, mobileTop: false, desktopSidebar: true, floating: false, depth: 2 },
  keywords: ["blog"],
  anime: { mode: "local" },
};

export const musicPlayerConfig = {
  enable: true,
  showFloatingPlayer: true,
  floatingEntryMode: "default",
  mode: "meting",
  meting_api: "https://meting.example.com/api?server=:server&type=:type&id=:id&auth=secret-token",
  id: "fixture-playlist",
  server: "netease",
  type: "playlist",
};

export const sakuraConfig = {
  enable: false,
  sakuraNum: 21,
  limitTimes: -1,
  size: { min: 10, max: 20 },
  opacity: { min: 0.3, max: 0.7 },
  speed: { horizontal: { min: 1, max: 2 }, vertical: { min: 1, max: 2 }, rotation: 0.5, fadeSpeed: 0.8 },
  zIndex: 9999,
};

export const pioConfig = {
  enable: true,
  models: ["pio/model0.json"],
  position: "right",
  width: 200,
  height: 300,
  mode: "fixed",
  hiddenOnMobile: false,
  dialog: {
    welcome: "欢迎",
    touch: ["别碰我"],
    home: "/",
    skin: ["a", "b"],
    close: "再见",
    link: "/about/",
    custom: [{ selector: "#x", type: "read", text: "读" }],
  },
};

export const widgetConfigs = {
  music: musicPlayerConfig,
  sakura: sakuraConfig,
  pio: pioConfig,
};
`;

/** 基线变体：声明缺失面（K11 ①② / K14 null 分支） */
const BASELINE_NO_PIO = BASELINE_FULL.replace(
  /export const pioConfig = \{[\s\S]*?\n\};\n\n/,
  '',
).replace('  pio: pioConfig,\n', '');

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7m-site-effects-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const overridePath = process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] as string;

/** 完整 site-info 请求体（15 受管键，与 p7i/p7k 同形；lang 不在档内） */
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

interface EffectsView {
  musicPlayer: Record<string, unknown> | null;
  sakura: Record<string, unknown> | null;
  pio: Record<string, unknown> | null;
}

interface ConfigView {
  siteInfo: Record<string, unknown> | null;
  effects: EffectsView;
  baselineEffects: EffectsView;
}

/** 取一个顶层声明的完整文本块（`export const X = { … \n};`） */
function declBlock(text: string, declName: string): string {
  const marker = `export const ${declName}`;
  const start = text.indexOf(marker);
  if (start === -1) {
    return '';
  }
  const end = text.indexOf('\n};', start);
  return end === -1 ? text.slice(start) : text.slice(start, end + 3);
}

describe('[U3-P4c] 特效非敏感开关纳管 e2e（A-GAP-04）', () => {
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

  const putEffects = (
    body: Record<string, unknown>,
  ): request.Test => server().put('/api/v1/admin/config/effects').send(body);

  /** 复位：基线 config.ts + 清侧车（用例间独立） */
  const reset = (): void => {
    fs.writeFileSync(configTsPath, BASELINE_FULL);
    if (fs.existsSync(overridePath)) {
      fs.rmSync(overridePath);
    }
  };

  it('① 无 override → effects 三域 = 基线值，响应不含 meting_api 凭据面', async () => {
    reset();
    const res = await server().get('/api/v1/admin/config');
    expect(res.status).toBe(200);
    const view = res.body as ConfigView;
    expect(view.effects.musicPlayer).toEqual({
      enable: true,
      showFloatingPlayer: true,
      floatingEntryMode: 'default',
      mode: 'meting',
      id: 'fixture-playlist',
      server: 'netease',
      type: 'playlist',
    });
    expect(view.effects.sakura).toEqual({
      enable: false,
      sakuraNum: 21,
      limitTimes: -1,
      size: { min: 10, max: 20 },
      opacity: { min: 0.3, max: 0.7 },
      speed: {
        horizontal: { min: 1, max: 2 },
        vertical: { min: 1, max: 2 },
        rotation: 0.5,
        fadeSpeed: 0.8,
      },
      zIndex: 9999,
    });
    expect(view.effects.pio).toEqual({
      enable: true,
      models: ['pio/model0.json'],
      position: 'right',
      width: 200,
      height: 300,
      mode: 'fixed',
      hiddenOnMobile: false,
      dialog: {
        welcome: '欢迎',
        touch: ['别碰我'],
        home: '/',
        skin: ['a', 'b'],
        close: '再见',
        link: '/about/',
        custom: [{ selector: '#x', type: 'read', text: '读' }],
      },
    });
    // [I5] 排除项机械证据：受管键投影里永不出现 meting_api / 内联凭据
    expect(JSON.stringify(res.body)).not.toContain('meting_api');
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
  });

  it('② PUT 部分键 → 仅三键物化，同对象其余键 / 其余声明 / 注释逐字节不变', async () => {
    reset();
    const before = configTs();
    const res = await putEffects({
      musicPlayer: { enable: false, mode: 'meting', id: 'x' },
    });
    expect(res.status).toBe(200);
    const view = res.body as ConfigView;
    expect(view.effects.musicPlayer?.['enable']).toBe(false);
    expect(view.effects.musicPlayer?.['id']).toBe('x');

    const after = configTs();
    const block = declBlock(after, 'musicPlayerConfig');
    expect(block).toContain('enable: false');
    expect(block).toContain('id: "x"');
    // 同一对象其余键零触碰
    expect(block).toContain('showFloatingPlayer: true');
    expect(block).toContain('floatingEntryMode: "default"');
    expect(block).toContain('server: "netease"');
    expect(block).toContain('type: "playlist"');
    expect(block).toContain('meting_api:');
    // 其余声明零触碰
    expect(declBlock(after, 'sakuraConfig')).toBe(declBlock(before, 'sakuraConfig'));
    expect(declBlock(after, 'pioConfig')).toBe(declBlock(before, 'pioConfig'));
    // 文件头注释与常量逐字节保留
    expect(after.slice(0, after.indexOf('export const musicPlayerConfig'))).toBe(
      before.slice(0, before.indexOf('export const musicPlayerConfig')),
    );
    expect(after).toContain('// [p7m fixture] 注释必须逐字节保留');
  });

  it('③ body 含 meting_api → 400（.strict() 机械排除），config.ts 字节零变化', async () => {
    reset();
    const before = configTs();
    const res = await putEffects({
      musicPlayer: { meting_api: 'https://evil.example/api?auth=secret-token' },
    });
    expect(res.status).toBe(400);
    expect(configTs()).toBe(before);
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('④ originals["musicPlayerConfig.enable"] 首次留档 = 原初始化器文本', async () => {
    reset();
    await putEffects({ musicPlayer: { enable: false } });
    const carrier = readCarrier();
    const originals = carrier['originals'] as Record<string, string>;
    expect(originals['musicPlayerConfig.enable']).toBe('true');
    // 只留档本次提交的键
    expect(originals['musicPlayerConfig.id']).toBeUndefined();
    // 侧车只记本次提交的域
    expect(carrier['siteEffects']).toEqual({ musicPlayer: { enable: false } });
  });

  it('⑤ 第二次 PUT 同键 → originals 保持首次原文本', async () => {
    reset();
    await putEffects({ musicPlayer: { enable: false } });
    const first = (readCarrier()['originals'] as Record<string, string>)[
      'musicPlayerConfig.enable'
    ];
    await putEffects({ musicPlayer: { enable: true } });
    const second = (readCarrier()['originals'] as Record<string, string>)[
      'musicPlayerConfig.enable'
    ];
    expect(second).toBe(first);
    expect(second).toBe('true');
    expect(configTs()).toContain('enable: true');
  });

  it('⑥ sakura 嵌套整值 + pio.dialog 整值同时提交 → 各自物化，music 零触碰', async () => {
    reset();
    const before = configTs();
    const res = await putEffects({
      sakura: { size: { min: 30, max: 40 } },
      pio: { dialog: { welcome: 'hi' } },
    });
    expect(res.status).toBe(200);
    const view = res.body as ConfigView;
    expect(view.effects.sakura?.['size']).toEqual({ min: 30, max: 40 });
    // 嵌套整值：override 的 dialog 整体接管（基线 touch/skin 不参与合并）
    expect(view.effects.pio?.['dialog']).toEqual({ welcome: 'hi' });

    const after = configTs();
    const sakuraBlock = declBlock(after, 'sakuraConfig');
    expect(sakuraBlock).toContain('size: {');
    expect(sakuraBlock).toContain('min: 30');
    expect(sakuraBlock).toContain('max: 40');
    expect(sakuraBlock).toContain('sakuraNum: 21'); // 未提交键零触碰
    const pioBlock = declBlock(after, 'pioConfig');
    expect(pioBlock).toContain('welcome: "hi"');
    expect(pioBlock).not.toContain('skin:');
    expect(pioBlock).toContain('position: "right"');
    // musicPlayerConfig 不在本次 body → 字节不变
    expect(declBlock(after, 'musicPlayerConfig')).toBe(declBlock(before, 'musicPlayerConfig'));
  });

  it('⑦ 值域越界（sakuraNum -1 / zIndex 1e9 / pio.width 0）→ 400 零物化', async () => {
    reset();
    const before = configTs();
    const negative = await putEffects({ sakura: { sakuraNum: -1 } });
    expect(negative.status).toBe(400);
    const hugeZ = await putEffects({ sakura: { zIndex: 1e9 } });
    expect(hugeZ.status).toBe(400);
    const zeroWidth = await putEffects({ pio: { width: 0 } });
    expect(zeroWidth.status).toBe(400);
    expect(configTs()).toBe(before);
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('⑧ 基线缺 pioConfig → GET 该域 null、PUT 404 零物化', async () => {
    reset();
    fs.writeFileSync(configTsPath, BASELINE_NO_PIO);
    const before = configTs();
    const get = await server().get('/api/v1/admin/config');
    expect(get.status).toBe(200);
    const view = get.body as ConfigView;
    expect(view.effects.pio).toBeNull();
    expect(view.baselineEffects.pio).toBeNull();
    expect(view.effects.musicPlayer).toEqual(
      expect.objectContaining({ enable: true, mode: 'meting' }),
    );

    const res = await putEffects({ pio: { enable: false } });
    expect(res.status).toBe(404);
    expect(configTs()).toBe(before);
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('⑨ widgetConfigs 的 "music: musicPlayerConfig" 行逐字不变（再裁 C）', async () => {
    reset();
    const before = configTs();
    const res = await putEffects({ musicPlayer: { enable: false } });
    expect(res.status).toBe(200);
    const after = configTs();
    expect(declBlock(after, 'widgetConfigs')).toBe(declBlock(before, 'widgetConfigs'));
    expect(after).toContain('  music: musicPlayerConfig,');
    expect(after).toContain('  sakura: sakuraConfig,');
    expect(after).toContain('  pio: pioConfig,');
  });

  it('⑩ PUT /site-info 回归：15 键契约不变，effects 为 additive 不干扰既有字段', async () => {
    reset();
    const before = configTs();
    const ok = await server().put('/api/v1/admin/config/site-info').send(SITE_INFO_BODY);
    expect(ok.status).toBe(200);
    const view = ok.body as ConfigView;
    expect(view.siteInfo).toMatchObject({ title: '新站点标题', timeZone: -5 });
    // additive 字段存在且取基线（未做 effects override）
    expect(view.baselineEffects.musicPlayer).toEqual(
      expect.objectContaining({ enable: true, mode: 'meting', id: 'fixture-playlist' }),
    );
    expect(view.effects.pio).toEqual(expect.objectContaining({ position: 'right', width: 200 }));
    // 特效三声明不受 site-info 端点影响
    const after = configTs();
    expect(declBlock(after, 'musicPlayerConfig')).toBe(declBlock(before, 'musicPlayerConfig'));
    expect(declBlock(after, 'sakuraConfig')).toBe(declBlock(before, 'sakuraConfig'));
    expect(declBlock(after, 'pioConfig')).toBe(declBlock(before, 'pioConfig'));

    // 15 键契约未扩张：把 effects 塞进 site-info body 会被 .strict() 拒绝
    const leak = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, effects: { musicPlayer: { enable: false } } });
    expect(leak.status).toBe(400);
  });

  it('⑪ PUT {} 还原留档原文 + 侧车 siteEffects 消失；PUT /anime 回归不受影响', async () => {
    reset();
    await putEffects({ musicPlayer: { enable: false, id: 'x' } });
    expect(declBlock(configTs(), 'musicPlayerConfig')).toContain('enable: false');
    expect(declBlock(configTs(), 'musicPlayerConfig')).toContain('id: "x"');

    // 域键全缺省 = 三域清除 override 并还原留档原文
    const cleared = await putEffects({});
    expect(cleared.status).toBe(200);
    const view = cleared.body as ConfigView;
    expect(view.effects.musicPlayer).toEqual(
      expect.objectContaining({ enable: true, id: 'fixture-playlist' }),
    );
    const afterClear = configTs();
    expect(declBlock(afterClear, 'musicPlayerConfig')).toContain('enable: true');
    expect(declBlock(afterClear, 'musicPlayerConfig')).toContain('id: "fixture-playlist"');
    // 侧车域键消失；原文本留档保留（便于二次接管，与 lang/nav 同口径）
    expect(readCarrier()['siteEffects']).toBeUndefined();
    expect((readCarrier()['originals'] as Record<string, string>)['musicPlayerConfig.enable']).toBe(
      'true',
    );

    // /anime 端点回归：effects 域与其完全隔离，物化三声明零触碰
    const beforeAnime = configTs();
    const anime = await server()
      .put('/api/v1/admin/config/anime')
      .send({ anime: { mode: 'bangumi' } });
    expect(anime.status).toBe(200);
    expect(configTs()).toContain('mode: "bangumi"');
    expect(declBlock(configTs(), 'musicPlayerConfig')).toBe(declBlock(beforeAnime, 'musicPlayerConfig'));
    expect(declBlock(configTs(), 'sakuraConfig')).toBe(declBlock(beforeAnime, 'sakuraConfig'));
    expect(declBlock(configTs(), 'pioConfig')).toBe(declBlock(beforeAnime, 'pioConfig'));
  });
});
