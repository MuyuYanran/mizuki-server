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
 * [U3-P1] 配置域一期 e2e：site-info / profile / announcement 受控档（ADR-020 链复用）。
 * ① site-info 往返：200 + 物化文本（逐属性置换）+ 侧车 siteInfo + originals['siteConfig.title']；
 * ② GET 合并语义：siteInfo = override 态（整档），baselineSiteInfo = config.ts 现值逐键解析；
 * ③ 基线缺可选键 navbarTitle → 追加属性（缺失插入；原本无属性不留档，已知限制）；
 * ④ 可选键缺省零触碰（不新增、不改写、不落侧车键）+ 非受管键 keywords 零触碰；
 * ⑤⑥⑦⑧ 越界键 / timeZone=13 / siteURL 无尾斜杠 / title 空串 → 400 零物化；
 * ⑨⑩ profile 往返（links=[] 合法清空）+ 越界键 400；
 * ⑪⑫ announcement 往返 + content 空串 / 非法 type → 400；
 * ⑬⑭ 探针门禁 409（siteConfig 形态不符 / profileConfig 声明缺失）且 config.ts 零物化；
 * ⑮ 旧侧车（仅 lang/comments/nav 键）兼容：GET 不炸 + 旧键保留（I4）。
 * 注：主题根 = fixture cpSync 副本（mkdtemp 临时域），config.ts 本 spec 内联写入，
 * 真实主题目录零触碰；用例按文件序执行且共享状态。
 */

// 完整基线（15 受管键全在位 + 非受管键 keywords）
const BASELINE_FULL = `const SITE_LANG = "zh_CN";
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

export const profileConfig = {
  avatar: "assets/images/avatar.webp",
  name: "测试站",
  bio: "简介",
  typewriter: {
    enable: true,
    speed: 80,
  },
  links: [
    {
      name: "GitHub",
      url: "https://github.com/example",
      icon: "fa7-brands:github",
    },
  ],
};

export const announcementConfig = {
  title: "",
  content: "欢迎",
  closable: true,
  link: {
    enable: true,
    text: "了解更多",
    url: "/about/",
    external: false,
  },
};
`;

// 基线变体：siteConfig 缺可选键 navbarTitle（③ 缺失插入用例）
const BASELINE_NO_NAVBAR_TITLE = BASELINE_FULL.replace(
  `  navbarTitle: {
    mode: "text-icon",
    text: "MizukiUI",
  },
`,
  '',
);

// 基线变体：siteConfig 初始化器非对象字面量（⑬ 探针 409）
const BASELINE_SITE_NON_OBJECT = BASELINE_FULL.replace(
  /export const siteConfig = \{[\s\S]*?\n\};/,
  'export const siteConfig = null;',
);

// 基线变体：profileConfig 声明缺失（⑭ 探针 409 且零物化）
const BASELINE_NO_PROFILE = BASELINE_FULL.replace(
  /export const profileConfig = \{[\s\S]*?\n\};/,
  '',
);

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7i-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const overridePath = process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] as string;

/** 完整 site-info 请求体（15 受管键；lang 不在档内） */
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

describe('U3-P1：配置域一期（site-info / profile / announcement）e2e', () => {
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
  const reset = (baseline: string = BASELINE_FULL): void => {
    fs.writeFileSync(configTsPath, baseline);
    if (fs.existsSync(overridePath)) {
      fs.rmSync(overridePath);
    }
  };

  type View = {
    siteConfig: { lang: string | null; baselineLang: string | null };
    commentConfig: unknown;
    nav: unknown;
    baselineNav: unknown;
    siteInfo: Record<string, unknown> | null;
    baselineSiteInfo: Record<string, unknown> | null;
    profile: Record<string, unknown> | null;
    baselineProfile: Record<string, unknown> | null;
    announcement: Record<string, unknown> | null;
    baselineAnnouncement: Record<string, unknown> | null;
  };

  it('① PUT site-info → 200，15 键逐属性物化 + 侧车 siteInfo + 原文本留档', async () => {
    reset();
    const res = await server().put('/api/v1/admin/config/site-info').send(SITE_INFO_BODY);
    expect(res.status).toBe(200);
    const view = res.body as View;
    expect(view.siteInfo).toMatchObject({ title: '新站点标题', timeZone: -5 });
    expect(view.siteInfo?.['toc']).toMatchObject({ depth: 3 });

    const text = configTs();
    // 物化文本锚：标量逐属性置换（title 由 "Mizuki" → 新值）
    expect(text).toContain('title: "新站点标题"');
    expect(text).toContain('subtitle: "新副标题"');
    expect(text).toContain('siteURL: "https://new.example.com/"');
    expect(text).toContain('timeZone: -5');
    expect(text).toContain('depth: 3');
    // 非受管键零触碰
    expect(text).toContain('keywords: ["blog"]');
    expect(text).toContain('lang: SITE_LANG');
    // lang 归既有端独占：site-info 不改写它
    expect(text).toContain('const SITE_LANG = "zh_CN"');

    // 侧车：siteInfo 键 + originals 留档（仅首次）
    const carrier = readCarrier();
    expect(carrier['siteInfo']).toMatchObject({ title: '新站点标题' });
    const originals = carrier['originals'] as Record<string, string>;
    expect(originals['siteConfig.title']).toBe('"Mizuki"');
    expect(originals['siteConfig.timeZone']).toBe('SITE_TIMEZONE');
    expect(originals['siteConfig.toc']).toBeDefined();
  });

  it('② GET 合并语义：siteInfo = override 整档；baselineSiteInfo = config.ts 现值逐键解析', async () => {
    const res = await server().get('/api/v1/admin/config');
    expect(res.status).toBe(200);
    const view = res.body as View;
    expect(view.siteInfo?.['title']).toBe('新站点标题');
    // 物化即管理权转移：config.ts 现值 = override 态 → 基线对照同值（comments 先例同型）
    expect(view.baselineSiteInfo?.['title']).toBe('新站点标题');
    expect(view.baselineSiteInfo?.['keywords']).toBeUndefined(); // 非受管键不入档
    expect(view.profile).toMatchObject({ name: '测试站' });
    expect(view.announcement).toMatchObject({ content: '欢迎' });
  });

  it('③ 基线缺 navbarTitle → PUT 含该键 → 追加属性（缺失插入）', async () => {
    reset(BASELINE_NO_NAVBAR_TITLE);
    const res = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, navbarTitle: { mode: 'text-icon', text: '插入态' } });
    expect(res.status).toBe(200);
    const text = configTs();
    expect(text).toContain('navbarTitle:');
    expect(text).toContain('"插入态"');
    // 原本无属性 → 无原文本可留档（已知限制）
    const originals = readCarrier()['originals'] as Record<string, string>;
    expect(originals['siteConfig.navbarTitle']).toBeUndefined();
    expect(originals['siteConfig.title']).toBe('"Mizuki"');
  });

  it('④ 可选键缺省 → 零触碰：不新增、不改写、不落侧车键', async () => {
    reset();
    const body: Record<string, unknown> = { ...SITE_INFO_BODY };
    delete body['tagStyle'];
    delete body['wallpaperMode'];
    const res = await server().put('/api/v1/admin/config/site-info').send(body);
    expect(res.status).toBe(200);
    const text = configTs();
    expect(text).toContain('useNewStyle: true'); // 站点原值保留
    expect(text).toContain('showModeSwitchOnMobile: "both"');
    const carrier = readCarrier();
    expect(carrier['siteInfo']).not.toHaveProperty('tagStyle');
    expect(carrier['siteInfo']).not.toHaveProperty('wallpaperMode');
  });

  it('⑤ 越界键（lang / keywords）→ 400 且零物化', async () => {
    reset();
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, lang: 'en' });
    expect(res.status).toBe(400);
    expect(configTs()).toBe(before);
    const res2 = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, keywords: ['x'] });
    expect(res2.status).toBe(400);
    expect(configTs()).toBe(before);
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('⑥ timeZone=13 → 400（值域）', async () => {
    reset();
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, timeZone: 13 });
    expect(res.status).toBe(400);
    expect(configTs()).toBe(before);
  });

  it('⑦ siteURL 无尾斜杠 → 400；title 空串 → 400', async () => {
    reset();
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, siteURL: 'https://new.example.com' });
    expect(res.status).toBe(400);
    const res2 = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, title: '' });
    expect(res2.status).toBe(400);
    expect(configTs()).toBe(before);
  });

  it('⑧ toc.depth=4 → 400（1~3 值域）', async () => {
    reset();
    const res = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, toc: { ...SITE_INFO_BODY.toc, depth: 4 } });
    expect(res.status).toBe(400);
    expect(configTs()).toContain('depth: 2');
  });

  it('⑨ PUT profile → 200 整档置换 + links=[] 合法清空 + 原文本留档', async () => {
    reset();
    const res = await server()
      .put('/api/v1/admin/config/profile')
      .send({
        name: '新名字',
        bio: '新简介',
        avatar: 'assets/images/new-avatar.webp',
        links: [],
      });
    expect(res.status).toBe(200);
    const view = res.body as View;
    expect(view.profile).toMatchObject({ name: '新名字', links: [] });
    const text = configTs();
    expect(text).toContain('name: "新名字"');
    expect(text).toContain('links: []');
    const carrier = readCarrier();
    expect(carrier['profile']).toMatchObject({ name: '新名字' });
    const originals = carrier['originals'] as Record<string, string>;
    expect(originals['profileConfig']).toContain('测试站');
  });

  it('⑩ profile 越界键 → 400 且零物化', async () => {
    reset();
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/profile')
      .send({ name: 'x', links: [], typewriter: { enable: true, extra: 1 } });
    expect(res.status).toBe(400);
    expect(configTs()).toBe(before);
  });

  it('⑪ PUT announcement → 200 整档置换 + 原文本留档', async () => {
    reset();
    const res = await server()
      .put('/api/v1/admin/config/announcement')
      .send({
        title: '公告标题',
        content: '<p>公告内容</p>',
        type: 'warning',
        closable: false,
        link: { enable: true, text: '详情', url: 'https://example.com/', external: true },
      });
    expect(res.status).toBe(200);
    const view = res.body as View;
    expect(view.announcement).toMatchObject({ type: 'warning', closable: false });
    const text = configTs();
    expect(text).toContain('type: "warning"');
    expect(text).toContain('content: "<p>公告内容</p>"');
    const originals = readCarrier()['originals'] as Record<string, string>;
    expect(originals['announcementConfig']).toContain('欢迎');
  });

  it('⑫ announcement content 空串 / 非法 type → 400', async () => {
    reset();
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/announcement')
      .send({ content: '' });
    expect(res.status).toBe(400);
    const res2 = await server()
      .put('/api/v1/admin/config/announcement')
      .send({ content: 'x', type: 'fatal' });
    expect(res2.status).toBe(400);
    expect(configTs()).toBe(before);
  });

  it('⑬ 探针门禁：siteConfig 初始化器非对象 → 409 且零物化', async () => {
    reset(BASELINE_SITE_NON_OBJECT);
    const before = configTs();
    const res = await server().put('/api/v1/admin/config/site-info').send(SITE_INFO_BODY);
    expect(res.status).toBe(409);
    const detail = (res.body as { detail?: { probes?: { target: string }[] } }).detail;
    expect(detail?.probes?.some((probe) => probe.target === 'siteConfig')).toBe(true);
    expect(configTs()).toBe(before);
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('⑭ 探针门禁：profileConfig 声明缺失 → 409 且零物化', async () => {
    reset(BASELINE_NO_PROFILE);
    const before = configTs();
    const res = await server()
      .put('/api/v1/admin/config/profile')
      .send({ name: 'x', links: [] });
    expect(res.status).toBe(409);
    const detail = (res.body as { detail?: { probes?: { target: string }[] } }).detail;
    expect(detail?.probes?.some((probe) => probe.target === 'profileConfig')).toBe(true);
    expect(configTs()).toBe(before);
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('⑮ 旧侧车（仅 lang/comments/nav 键）兼容：GET 不炸 + PUT 后旧键保留', async () => {
    reset();
    fs.writeFileSync(
      overridePath,
      JSON.stringify(
        {
          version: 1,
          siteConfig: { lang: 'ja' },
          commentConfig: { enable: false },
          nav: { links: [] },
          originals: { 'siteConfig.lang': 'SITE_LANG' },
        },
        null,
        2,
      ),
    );
    const get = await server().get('/api/v1/admin/config');
    expect(get.status).toBe(200);
    const view = get.body as View;
    expect(view.siteInfo?.['title']).toBe('Mizuki'); // 无 siteInfo override → 回基线
    expect(view.profile?.['name']).toBe('测试站');
    expect(view.announcement?.['content']).toBe('欢迎');

    const put = await server()
      .put('/api/v1/admin/config/site-info')
      .send({ ...SITE_INFO_BODY, title: '兼容态' });
    expect(put.status).toBe(200);
    const carrier = readCarrier();
    expect(carrier['siteConfig']).toMatchObject({ lang: 'ja' }); // 旧键保留（只增不改）
    expect(carrier['commentConfig']).toMatchObject({ enable: false });
    expect(carrier['nav']).toMatchObject({ links: [] });
    expect(carrier['siteInfo']).toMatchObject({ title: '兼容态' });
  });
});
