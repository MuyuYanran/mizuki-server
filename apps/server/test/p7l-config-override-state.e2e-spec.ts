import 'reflect-metadata';
import { createHash } from 'node:crypto';
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
 * [U3-P4b/K1] 站点配置「物化态」视图字段 e2e（`GET /admin/config` 的 `overrides`）。
 * 8 锚（指令包 §4.1 八条逐条落地）：
 * ① 无侧车 → 六域全 false + `siteInfo.keys` / `originalsKeys` 双空（= 「无物化」而不是缺字段）；
 * ② PUT lang → `lang === true`（侧车子域是 `siteConfig.lang`，判定源不是顶层 `lang`）；
 * ③ PUT nav `{links: []}` → `nav === true`（**空值接管**：空数组不得被判 false）；
 * ④ siteInfo：PUT 15 键全档 → `active` + `keys` 恰 15 键且字典序；**三键**场景走侧车
 *    直落（PUT 契约要求 11 个必填键，三键体必 400——见文件末「口径说明」）；
 * ⑤ 首次物化留档：`originalsKeys` 含 `siteConfig.lang` / `navBarConfig`；二次 PUT
 *    同域**不改变**集合；再把 comments / profile / announcement 接管 → 六域全覆盖；
 * ⑥ PUT lang '' 清除 → `lang === false`，但 `originalsKeys` **仍含**留档键（留档不随清除删除）；
 * ⑦ 既有字段零变化：去掉 `overrides` 后键集 = 冻结 14 键 + JSON sha256 = 改动前快照；
 * ⑧ 不外泄：响应体不含 `SITE_LANG` 原文、不含 `originals` 原文、不含盘符绝对路径；
 *    + [U3-P4b/DEF-06 ②] 侧车损坏 → 500 `InternalError` / `detail: null` / 响应体无盘符绝对路径。
 * 注：主题根 = fixture cpSync 副本（mkdtemp 临时域），config.ts 本 spec 内联写入，
 * 真实主题目录零触碰；每个用例先 `reset()`（基线 config.ts + 清侧车）故用例间独立。
 *
 * 口径说明（§4.1 ④ 的落地偏差，据实登记）：`PUT /admin/config/site-info` 的 body 走
 * `SiteInfoSchema`（**非** partial：title / subtitle / siteURL / timeZone / themeColor /
 * featurePages / postListLayout / wallpaperMode / banner / font / toc 共 11 键必填），
 * 故「恰好三键」不可能由 PUT 产生。改用**侧车直落**三键（投影只依赖 carrier）证明
 * `siteInfo.keys` 的三键语义与字典序，另以真实 PUT 全档证明 `active` 的写入链路。
 */

// 完整基线：siteConfig 15 受管键全在位（+ 非受管 keywords / lang）+ commentConfig +
// navBarConfig（LinkPreset 标识符 + 数组字面量，探针结构匹配）+ profile / announcement。
// 形态来源：p7i（siteConfig / profile / announcement）、p7f（commentConfig）、
// p4e3a（navBarConfig）——三份均已被既有门禁用例证明探针全通过。
const BASELINE_CONFIG_TS = `const SITE_LANG = "zh_CN";
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
};

export const commentConfig = {
  enable: false,
  system: "twikoo",
  twikoo: {
    envId: "https://twikoo.vercel.app",
    lang: SITE_LANG,
  },
  giscus: {
    repo: "your-github-username/your-repo-name",
    repoId: "your-repo-id",
    category: "Announcements",
    categoryId: "your-category-id",
    mapping: "pathname",
    strict: "0",
    reactionsEnabled: "1",
    emitMetadata: "0",
    inputPosition: "top",
    theme: "preferred_color_scheme",
    lang: SITE_LANG,
    loading: "lazy",
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

/** 完整 site-info 请求体（11 必填 + 4 可选；lang 不在档内） */
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

/**
 * ⑦ 冻结锚：改动前（HEAD `7ab8b9d`，未加 `overrides`）在**本文件基线下**同一无侧车状态的
 * `GET /admin/config` 响应体（去掉 `overrides` 后 `JSON.stringify`）的 sha256。
 * 采集方式：把 `site-config.service.ts` / `theme-registry.service.ts` 复原到 HEAD
 * 内容后跑本 spec 的 ⑦ 单例（详见报告）。它同时钉住「字段集」与「每个字段的值」。
 */
const PRE_CHANGE_VIEW_SHA256 = '7aaff5d850e2059a492febfd7ad9fdee3071db5d9815032ae9ca3703b8347c40';

/** 改动前既有字段集（冻结 14 键，字典序：六域 + baseline* + anime/effects 两批 additive 视图） */
const PRE_CHANGE_FIELDS = [
  'anime',
  'announcement',
  'baselineAnnouncement',
  'baselineEffects',
  'baselineNav',
  'baselineNavRaw',
  'baselineProfile',
  'baselineSiteInfo',
  'commentConfig',
  'effects',
  'nav',
  'profile',
  'siteConfig',
  'siteInfo',
];

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7l-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
process.env['MIZUKI_THEME_BASELINE_PATH'] = path.join(tmp, 'theme-baseline', 'baseline.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const overridePath = process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] as string;

/** K1 视图字段（与后端 interface 同形；后端未导出 shared schema，双份手写口径同 api/config.ts） */
interface OverridesView {
  lang: boolean;
  comments: boolean;
  nav: boolean;
  siteInfo: { active: boolean; keys: string[] };
  profile: boolean;
  announcement: boolean;
  originalsKeys: string[];
}

interface ConfigView {
  siteConfig: { lang: string | null; baselineLang: string | null };
  commentConfig: Record<string, unknown> | null;
  nav: { links: unknown[] } | null;
  baselineNav: unknown;
  baselineNavRaw: string | null;
  siteInfo: Record<string, unknown> | null;
  baselineSiteInfo: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  baselineProfile: Record<string, unknown> | null;
  announcement: Record<string, unknown> | null;
  baselineAnnouncement: Record<string, unknown> | null;
  overrides: OverridesView;
}

describe('U3-P4b/K1：站点配置物化态视图字段（GET /admin/config 的 overrides）e2e', () => {
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

  /** 复位：基线 config.ts + 清侧车（用例间独立） */
  const reset = (): void => {
    fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS);
    if (fs.existsSync(overridePath)) {
      fs.rmSync(overridePath);
    }
  };

  const getView = async (): Promise<ConfigView> => {
    const res = await server().get('/api/v1/admin/config');
    expect(res.status).toBe(200);
    return res.body as ConfigView;
  };

  const getOverrides = async (): Promise<OverridesView> => (await getView()).overrides;

  const writeCarrier = (carrier: unknown): void => {
    fs.writeFileSync(overridePath, JSON.stringify(carrier, null, 2));
  };

  const readCarrier = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(overridePath, 'utf8')) as Record<string, unknown>;

  it('① 无侧车 → 六域全 false + siteInfo.keys / originalsKeys 双空（「无物化」而非缺字段）', async () => {
    reset();
    const overrides = await getOverrides();
    expect(overrides).toEqual({
      lang: false,
      comments: false,
      nav: false,
      siteInfo: { active: false, keys: [] },
      profile: false,
      announcement: false,
      originalsKeys: [],
    });
    // 字段恒在（前端 fail-open 判据是「字段缺失」，故后端不得省略该键）
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('② PUT lang → overrides.lang === true，其余五域仍 false（判定源 = 侧车 siteConfig.lang 子域）', async () => {
    reset();
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: 'en' });
    expect(put.status).toBe(200);

    const overrides = await getOverrides();
    expect(overrides.lang).toBe(true);
    expect(overrides.comments).toBe(false);
    expect(overrides.nav).toBe(false);
    expect(overrides.siteInfo).toEqual({ active: false, keys: [] });
    expect(overrides.profile).toBe(false);
    expect(overrides.announcement).toBe(false);
    // 侧车实际形态锚：键落在 siteConfig.lang（不是顶层 lang）
    expect(readCarrier()['siteConfig']).toEqual({ lang: 'en' });
    expect(readCarrier()).not.toHaveProperty('lang');
  });

  it('③ PUT nav {links: []} → overrides.nav === true（空数组 = 合法清空导航，属已接管，不因「空」判 false）', async () => {
    reset();
    const put = await server().put('/api/v1/admin/config/nav').send({ links: [] });
    expect(put.status).toBe(200);

    const overrides = await getOverrides();
    expect(overrides.nav).toBe(true);
    expect(overrides.lang).toBe(false);
    // 空值接管在视图字段上仍是「有」，值面照旧是空导航
    const view = await getView();
    expect(view.nav).toEqual({ links: [] });
    expect(readCarrier()['nav']).toEqual({ links: [] });
  });

  it('④ siteInfo：PUT 全档 → active + 15 键字典序；三键侧车 → keys 恰三键且字典序', async () => {
    // (a) 真实写入链路：PUT 全档（11 必填 + 4 可选）→ active 与键序
    reset();
    const put = await server().put('/api/v1/admin/config/site-info').send(SITE_INFO_BODY);
    expect(put.status).toBe(200);
    const afterPut = (put.body as ConfigView).overrides;
    expect(afterPut.siteInfo.active).toBe(true);
    expect(afterPut.siteInfo.keys).toEqual(
      [
        'banner',
        'featurePages',
        'font',
        'navbarTitle',
        'pageScaling',
        'postListLayout',
        'siteStartDate',
        'siteURL',
        'subtitle',
        'tagStyle',
        'themeColor',
        'timeZone',
        'title',
        'toc',
        'wallpaperMode',
      ].sort(),
    );

    // (b) 三键场景：PUT 契约 11 键必填，故直落侧车（投影只依赖 carrier）
    reset();
    writeCarrier({
      version: 1,
      // 键序刻意 != 字典序，证明排序不是「文件里的顺序」
      siteInfo: { title: 'T', timeZone: 8, subtitle: 'S' },
    });
    const overrides = await getOverrides();
    expect(overrides.siteInfo.active).toBe(true);
    expect(overrides.siteInfo.keys).toEqual(['subtitle', 'timeZone', 'title']);

    // (c) 空对象接管：`siteInfo = {}` 也是「已接管且值为空」（active true + keys []），
    // 不得与「未接管」（active false）同形——这是 K1 用 `!== undefined` 判定而非真值判定的原因
    reset();
    writeCarrier({ version: 1, siteInfo: {} });
    expect((await getOverrides()).siteInfo).toEqual({ active: true, keys: [] });
  });

  it('⑤ 首次物化留档：originalsKeys 含 siteConfig.lang / navBarConfig；二次 PUT 不改变集合；六域全覆盖', async () => {
    reset();
    const lang1 = await server().put('/api/v1/admin/config/lang').send({ lang: 'ja' });
    expect(lang1.status).toBe(200);
    const nav1 = await server()
      .put('/api/v1/admin/config/nav')
      .send({ links: [{ name: '首页', url: '/', icon: 'fa7-solid:home' }] });
    expect(nav1.status).toBe(200);

    const first = await getOverrides();
    // 字典序：navBarConfig < siteConfig.lang（'n' < 's'）
    expect(first.originalsKeys).toEqual(['navBarConfig', 'siteConfig.lang']);

    // 二次 PUT（同域、不同值）→ 首次留档语义：集合不增不减、留档原文不变
    const originalNav = fs.existsSync(overridePath)
      ? (readCarrier()['originals'] as Record<string, string>)['navBarConfig']
      : undefined;
    const lang2 = await server().put('/api/v1/admin/config/lang').send({ lang: 'ko' });
    expect(lang2.status).toBe(200);
    const nav2 = await server()
      .put('/api/v1/admin/config/nav')
      .send({ links: [{ name: '归档', url: '/archive/' }] });
    expect(nav2.status).toBe(200);

    const second = await getOverrides();
    expect(second.originalsKeys).toEqual(first.originalsKeys);
    expect((readCarrier()['originals'] as Record<string, string>)['navBarConfig']).toBe(
      originalNav as string,
    );

    // 六域全覆盖：再把 comments / profile / announcement 接管（各自 PUT 链路）
    const view = await getView();
    const comments = await server().put('/api/v1/admin/config/comments').send(view.commentConfig);
    expect(comments.status).toBe(200);
    const profile = await server().put('/api/v1/admin/config/profile').send(view.baselineProfile);
    expect(profile.status).toBe(200);
    const announcement = await server()
      .put('/api/v1/admin/config/announcement')
      .send(view.baselineAnnouncement);
    expect(announcement.status).toBe(200);

    const all = await getOverrides();
    expect(all).toMatchObject({
      lang: true,
      comments: true,
      nav: true,
      profile: true,
      announcement: true,
    });
    // 留档键齐备（字典序）。注意 commentConfig **刻意不在留档内**：该域无还原路径
    // （ADR-020 §6「覆盖写入即管理权转移」），`spliceCommentConfig` 只整档置换不记 originals；
    // 「已接管」由布尔 fields 表达，与留档是两件事（K1 字段语义）。
    expect(all.originalsKeys).toEqual([
      'announcementConfig',
      'navBarConfig',
      'profileConfig',
      'siteConfig.lang',
    ]);
  });

  it('⑥ PUT lang "" 清除 → overrides.lang === false，但 originalsKeys 仍含留档键（留档不随清除删除）', async () => {
    reset();
    const set = await server().put('/api/v1/admin/config/lang').send({ lang: 'en' });
    expect(set.status).toBe(200);
    expect((await getOverrides()).lang).toBe(true);

    const clear = await server().put('/api/v1/admin/config/lang').send({ lang: '' });
    expect(clear.status).toBe(200);
    const overrides = await getOverrides();
    expect(overrides.lang).toBe(false); // 归一缺省 = 未接管
    expect(overrides.originalsKeys).toEqual(['siteConfig.lang']); // 留档仍在
    // 侧车 siteConfig 子域被整体移除（不是留一个空对象）
    expect(readCarrier()).not.toHaveProperty('siteConfig');
    expect((readCarrier()['originals'] as Record<string, string>)['siteConfig.lang']).toBe(
      'SITE_LANG',
    );
  });

  it('⑦ 既有字段零变化：去 overrides 后键集 = 冻结 14 键，且 JSON sha256 = 改动前快照', async () => {
    reset();
    const view = await getView();
    const { overrides, ...rest } = view;
    // 字段集：既有 14 键逐字不变（additive 字段之外零增删）
    expect(Object.keys(rest).sort()).toEqual(PRE_CHANGE_FIELDS);
    // 值面：全量 sha256（改动前快照逐键全等）；失败时把实际快照打进消息便于定位
    const sha = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    expect(sha, `去 overrides 后的既有字段快照：\n${JSON.stringify(rest, null, 2)}`).toBe(
      PRE_CHANGE_VIEW_SHA256,
    );
    // 人类可读锚（sha 失败时先看这里：基线代入 / 降级分支 / 六域合并语义）
    expect(rest.siteConfig.baselineLang).toBe('zh_CN');
    expect(rest.siteConfig.lang).toBeNull();
    expect(rest.nav).toBeNull();
    expect(rest.baselineNavRaw).toContain('LinkPreset.Home');
    expect(rest.commentConfig).toMatchObject({ enable: false, system: 'twikoo' });
    // 该态下 overrides 必须恰好是「空物化态」（见 ①；此处仅作对照）
    expect(overrides).toEqual({
      lang: false,
      comments: false,
      nav: false,
      siteInfo: { active: false, keys: [] },
      profile: false,
      announcement: false,
      originalsKeys: [],
    });
  });

  it('⑧ 不外泄：无 SITE_LANG 原文 / 无 originals 原文 / 无盘符绝对路径；+ DEF-06 侧车损坏 500 无路径', async () => {
    reset();
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: 'en' });
    expect(put.status).toBe(200);
    const body = await getView();
    const text = JSON.stringify(body);

    // (a) 留档原文（`SITE_LANG`）只以键名 `siteConfig.lang` 出现在 originalsKeys
    expect(body.overrides.originalsKeys).toEqual(['siteConfig.lang']);
    expect(text).not.toContain('SITE_LANG');
    // (b) 没有任何回值形的 originals 字段（originalsKeys 合法，故只禁 `"originals":`）
    expect(text).not.toContain('"originals":');
    // (c) 无盘符绝对路径、无本机侧车绝对路径
    expect(text).not.toMatch(/[A-Za-z]:\\/);
    expect(text).not.toContain(overridePath);
    expect(text).not.toContain(tmp);

    // (d) [DEF-06 ②] 侧车损坏 → 500 InternalError / detail null，且响应体不含盘符绝对路径
    fs.writeFileSync(overridePath, '{ this is not json');
    const broken = await server().get('/api/v1/admin/config');
    expect(broken.status).toBe(500);
    expect((broken.body as { code?: string }).code).toBe('InternalError');
    expect((broken.body as { detail?: unknown }).detail).toBeNull();
    const brokenText = JSON.stringify(broken.body);
    expect(brokenText).not.toMatch(/[A-Za-z]:\\/);
    expect(brokenText).not.toContain(tmp);
    expect(brokenText).not.toContain('config-override.json 解析失败');

    // 校验失败分支同形（同一投影 helper，两种抛错点）
    fs.writeFileSync(overridePath, JSON.stringify({ version: 1, bogus: true }));
    const invalid = await server().get('/api/v1/admin/config');
    expect(invalid.status).toBe(500);
    const invalidText = JSON.stringify(invalid.body);
    expect(invalidText).not.toMatch(/[A-Za-z]:\\/);
    expect(invalidText).not.toContain(tmp);

    reset(); // 复位，避免污染后续/重跑
  });
});
