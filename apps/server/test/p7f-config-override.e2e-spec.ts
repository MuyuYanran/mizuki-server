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
 * [Phase3-C7] 站点配置受控子集（override 批，ADR-020）：
 * lang：① PUT lang='en' → 200 且回读一致；② lang='e n' → 400 零物化；
 * ③ lang='' → 归一缺省（还原原文本、侧车不落键）。
 * 生效链：⑨ 保存 → override 载体（侧车）内容变更 + config.ts 定点物化（T2.2 形态）。
 * commentConfig：④ GET 全字段回读（基线常量代入：SITE_LANG → 'zh_CN'）；
 * ⑤ 全字段保存往返一致；⑥ 非法值 → 400；⑦ 官方字段面零删减锚（15 键全往返）。
 * 禁蔓延：⑩ 受控子集外键 → 400（.strict()）。留档卫生：⑪ 重复覆盖不污染原文本留档。
 * ⑫⑬ [Phase3-F] siteLang 拆分锚：'zh_CN' 下划线形（C7 疑问①）与 'zh-Hans' 连字符形双兼容。
 * ⑭⑮ [Phase4-D4/A4] 净态字节锚：设→清→siteConfig 声明段字节全等还原（=== 基线声明段；
 * commentConfig 经 ⑤⑥⑦ valueToTsLiteral 合法重写、字节形态不同属 comments 面遗留态，
 * 不属 lang 清除分支验收面）+ 侧车键消失 + originals 留档保留；
 * 清除后 GET 呈现断言（lang=null + baselineLang 常量代入）。
 * ⑧ 掩码写回 → 判定注记替代（T1.1：commentConfig 无真 secret 性质键，脱敏义务不触发）。
 * 注：主题根用 mizuki fixture cpSync 后内联写入最小 src/config.ts（零 fixture 变更）；
 * 用例按文件序执行且共享状态（①②③④⑨ lang 面 → ⑤⑥⑦ comments 面 → ⑩⑪）。
 */

// 主题 config.ts 基线（对齐基线源形态：非导出简单常量 + 导出对象字面量 + 标识符引用）
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
`;

// 基线 siteConfig 声明字节段（⑭ 断言源：从基线全文切出，同源零漂移；含声明与尾随空行）
const BASELINE_SITE_DECL = BASELINE_CONFIG_TS.slice(
  BASELINE_CONFIG_TS.indexOf('export const siteConfig'),
  BASELINE_CONFIG_TS.indexOf('export const commentConfig'),
);

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p7f-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const overridePath = process.env['MIZUKI_CONFIG_OVERRIDE_PATH'];

describe('Phase3-C7：站点配置受控子集（override）e2e', () => {
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
    // Windows 句柄释放延迟：重试清理，最终失败不阻塞套件（.tmpvitest 已 gitignore）
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

  const issuesOf = (res: { body: unknown }): { path: string }[] => {
    const body = res.body as { detail?: { issues?: { path: string }[] } };
    return body.detail?.issues ?? [];
  };

  const readCarrier = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(overridePath, 'utf8')) as Record<string, unknown>;

  it('① PUT lang="en" → 200 且回读一致（PUT 响应 + GET 复读同值）', async () => {
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: 'en' });
    expect(put.status).toBe(200);
    expect((put.body as { siteConfig?: { lang?: string | null } }).siteConfig?.lang).toBe('en');

    const get = await server().get('/api/v1/admin/config');
    expect(get.status).toBe(200);
    const view = get.body as { siteConfig: { lang: string | null; baselineLang: string | null } };
    expect(view.siteConfig.lang).toBe('en');
    expect(view.siteConfig.baselineLang).toBe('zh_CN'); // 基线代入对照（SITE_LANG → zh_CN）
  });

  it('② PUT lang="e n"（内嵌空白）→ 400 且零物化零落键', async () => {
    const configBefore = fs.readFileSync(configTsPath, 'utf8');
    const carrierBefore = fs.readFileSync(overridePath, 'utf8');
    const res = await server().put('/api/v1/admin/config/lang').send({ lang: 'e n' });
    expect(res.status).toBe(400);
    expect(issuesOf(res).some((issue) => issue.path === 'lang')).toBe(true);
    expect(fs.readFileSync(configTsPath, 'utf8')).toBe(configBefore); // 失败路径零物化
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(carrierBefore); // 侧车零变更
  });

  it('③ PUT lang="" → 归一缺省：config.ts 还原原文本、侧车不落键、GET 回 null', async () => {
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: '' });
    expect(put.status).toBe(200);
    const view = (put.body as { siteConfig: { lang: string | null } }).siteConfig;
    expect(view.lang).toBeNull();
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('lang: SITE_LANG'); // 原文本还原
    const carrier = readCarrier();
    expect(carrier).not.toHaveProperty('siteConfig'); // 不落键
    expect((carrier.originals as Record<string, string>)?.['siteConfig.lang']).toBe('SITE_LANG');
  });

  it('④ GET 全字段回读：commentConfig 基线有效值（SITE_LANG 常量代入 zh_CN）', async () => {
    const get = await server().get('/api/v1/admin/config');
    expect(get.status).toBe(200);
    const view = get.body as { commentConfig: Record<string, unknown> | null };
    expect(view.commentConfig).not.toBeNull();
    expect(view.commentConfig).toMatchObject({ enable: false, system: 'twikoo' });
    const twikoo = view.commentConfig?.['twikoo'] as Record<string, unknown>;
    expect(twikoo['envId']).toBe('https://twikoo.vercel.app');
    expect(twikoo['lang']).toBe('zh_CN'); // 标识符代入锚
    const giscus = view.commentConfig?.['giscus'] as Record<string, unknown>;
    expect(Object.keys(giscus).sort()).toEqual(
      [
        'category',
        'categoryId',
        'emitMetadata',
        'inputPosition',
        'lang',
        'loading',
        'mapping',
        'reactionsEnabled',
        'repo',
        'repoId',
        'strict',
        'theme',
      ],
    ); // 12 键零删减
    expect(giscus['lang']).toBe('zh_CN');
  });

  it('⑨ 生效链：保存 lang → override 载体（侧车）内容变更 + config.ts 定点物化', async () => {
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: 'en' });
    expect(put.status).toBe(200);
    const configTs = fs.readFileSync(configTsPath, 'utf8');
    expect(configTs).toContain('lang: "en"'); // siteConfig.lang 物化（替换 SITE_LANG 引用）
    expect(configTs).toContain('lang: SITE_LANG'); // commentConfig 内基线引用不受牵连（声明级置换）
    const carrier = readCarrier();
    expect((carrier.siteConfig as Record<string, unknown>)?.['lang']).toBe('en'); // 侧车状态变更
  });

  it('⑤ commentConfig 全字段保存往返一致（GET 基线 → PUT 同体 → GET 一致）', async () => {
    const first = await server().get('/api/v1/admin/config');
    const before = (first.body as { commentConfig: unknown }).commentConfig;
    expect(before).not.toBeNull();
    const put = await server().put('/api/v1/admin/config/comments').send(before);
    expect(put.status).toBe(200);
    const second = await server().get('/api/v1/admin/config');
    expect((second.body as { commentConfig: unknown }).commentConfig).toEqual(before);
    const carrier = readCarrier();
    expect(carrier.commentConfig).toEqual(before); // override 载体与回读一致
  });

  it('⑥ commentConfig 非法值 → 400 且零物化', async () => {
    const before = fs.readFileSync(configTsPath, 'utf8');
    const res = await server().put('/api/v1/admin/config/comments').send({ enable: 'yes' });
    expect(res.status).toBe(400);
    expect(issuesOf(res).some((issue) => issue.path === 'enable')).toBe(true);
    expect(fs.readFileSync(configTsPath, 'utf8')).toBe(before);
  });

  it('⑦ 官方字段面零删减锚：15 键全量对象逐键往返', async () => {
    const full = {
      enable: true,
      system: 'giscus',
      twikoo: { envId: 'https://tw.example.com', region: 'sh', lang: 'en' },
      giscus: {
        repo: 'me/blog',
        repoId: 'R_1',
        category: 'Announcements',
        categoryId: 'DIC_1',
        mapping: 'pathname',
        strict: '1',
        reactionsEnabled: '1',
        emitMetadata: '0',
        inputPosition: 'bottom',
        theme: 'dark',
        lang: 'en',
        loading: 'eager',
      },
    };
    const put = await server().put('/api/v1/admin/config/comments').send(full);
    expect(put.status).toBe(200);
    const get = await server().get('/api/v1/admin/config');
    expect(get.status).toBe(200);
    const view = get.body as { commentConfig: Record<string, unknown> | null };
    expect(view.commentConfig).not.toBeNull();
    expect(view.commentConfig?.['enable']).toBe(true);
    expect(view.commentConfig?.['system']).toBe('giscus');
    expect(view.commentConfig?.['twikoo']).toEqual(full.twikoo); // region 可选键在面
    expect(view.commentConfig?.['giscus']).toEqual(full.giscus); // 12 键全往返
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('envId: "https://tw.example.com"');
  });

  it('⑩ 禁蔓延锚：受控子集外键 → 400（两分立写均 .strict()）', async () => {
    const resLang = await server()
      .put('/api/v1/admin/config/lang')
      .send({ lang: 'en', system: 'giscus' });
    expect(resLang.status).toBe(400);
    // zod v4 .strict() 越界键 issue：path=[]、message=Unrecognized key（按 message 断言）
    expect(issuesOf(resLang).some((issue) => issue.message.includes('system'))).toBe(true);

    const resComments = await server()
      .put('/api/v1/admin/config/comments')
      .send({ enable: false, siteConfig: {} });
    expect(resComments.status).toBe(400);
    expect(issuesOf(resComments).some((issue) => issue.message.includes('siteConfig'))).toBe(true);
  });

  it('⑪ 留档卫生：重复覆盖 lang 不污染原文本留档（首次留档语义）', async () => {
    const put1 = await server().put('/api/v1/admin/config/lang').send({ lang: 'ja' });
    expect(put1.status).toBe(200);
    const carrier = readCarrier();
    expect((carrier.originals as Record<string, string>)?.['siteConfig.lang']).toBe('SITE_LANG');
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('lang: "ja"');
  });

  // ── ⑫⑬ [Phase3-F] siteLang 拆分锚（C7 疑问① 收官落地：config 域 [-_] 双兼容） ──

  it('⑫ siteLang 拆分锚：lang="zh_CN"（下划线形）→ 200 物化且回读一致', async () => {
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: 'zh_CN' });
    expect(put.status).toBe(200);
    const view = (
      put.body as { siteConfig: { lang: string | null; baselineLang: string | null } }
    ).siteConfig;
    expect(view.lang).toBe('zh_CN'); // 下划线形合法（主题约定 SITE_LANG 形）
    expect(view.baselineLang).toBe('zh_CN'); // 原文本留档代入锚（SITE_LANG → zh_CN）
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('lang: "zh_CN"'); // 物化
  });

  it('⑬ siteLang 拆分锚：lang="zh-Hans"（连字符形）→ 200（双兼容不弃既有口径）', async () => {
    const put = await server().put('/api/v1/admin/config/lang').send({ lang: 'zh-Hans' });
    expect(put.status).toBe(200);
    expect((put.body as { siteConfig?: { lang?: string | null } }).siteConfig?.lang).toBe(
      'zh-Hans',
    );
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('lang: "zh-Hans"'); // 物化
  });

  // ── ⑭⑮ [Phase4-D4/A4] 净态字节锚（清除分支收口） ──

  it('⑭ [A4] 设→清→净态：siteConfig 声明段字节全等还原 + 侧车 siteConfig 键消失 + originals 留档保留', async () => {
    // 先设非缺省值（离开 ⑬ 遗留态，构成完整 设→清 往返）
    const set = await server().put('/api/v1/admin/config/lang').send({ lang: 'zh_TW' });
    expect(set.status).toBe(200);
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('lang: "zh_TW"'); // 已物化非基线态

    const clear = await server().put('/api/v1/admin/config/lang').send({ lang: '' });
    expect(clear.status).toBe(200);
    expect((clear.body as { siteConfig: { lang: string | null } }).siteConfig.lang).toBeNull();

    // A4 增量锚：siteConfig 声明字节级还原（既有 ③ 仅 contains 'lang:' 语义级；
    // 此处含基线声明段逐字节）。commentConfig 已被 ⑤⑥⑦ comments 用例合法重写
    // （valueToTsLiteral 序列化形态，语义等价但字节不同），不属 lang 清除分支验收面。
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain(BASELINE_SITE_DECL);

    const carrier = readCarrier();
    expect(carrier).not.toHaveProperty('siteConfig'); // 侧车 siteConfig 键消失（净态）
    expect((carrier.originals as Record<string, string>)?.['siteConfig.lang']).toBe(
      'SITE_LANG',
    ); // 首次留档保留（不因清除丢失）
  });

  it('⑮ [A4] 清除后 GET /admin/config 呈现：lang=null + baselineLang 常量代入', async () => {
    const get = await server().get('/api/v1/admin/config');
    expect(get.status).toBe(200);
    const view = get.body as {
      siteConfig: { lang: string | null; baselineLang: string | null };
    };
    expect(view.siteConfig.lang).toBeNull(); // 净态呈现：无 override
    expect(view.siteConfig.baselineLang).toBe('zh_CN'); // 还原后原文本探针求值（SITE_LANG 代入）
  });
});
