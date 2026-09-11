import 'reflect-metadata';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { MizukiTier1Profile, ThemeProfileSchema } from '@mizuki/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { getVariableDeclarationOrThrow, loadSourceFile } from '../src/modules/data-files/evaluator';
import { valueToTsLiteral } from '../src/modules/data-files/serializer';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [Phase4-E3a] theme-lock 机制 e2e（Registry + Theme Profile + Mizuki Tier 1 档案，
 * ADR-024）：13 锚（387 基线 → ≥400 下限，1 锚 = 1 用例）+ ⑭ [Phase4-D4/配套2]。
 * ① Profile schema 往返 + 非法拒绝（unit 面，shared 档案自校验）；
 * ② fixture 扫描指纹集完整（编目 8 条目：5 文件 + 3 目录级）+ 重扫幂等（digest 全等）；
 * ③ 基线捕获 → 零漂移 round-trip；
 * ④ 漂移检出（fixture 变更 → path+kind 枚举：modified/added/removed 三态全覆盖）；
 * ⑤ 身份降级（package.json 无 version → 指纹代身份；运行期改写临时根副本，零 fixture 变更）；
 * ⑥ 无基线三态呈现（不 capture 即测：drift=no-baseline，探针轴照常运行）；
 * ⑦ 门禁 nav：navBarConfig 改名 → 409 含探针明细 + 三步指引且零物化；
 * ⑧ 门禁通过回归（字节级三重断言：(a) 物化产物与 valueToTsLiteral golden 逐字节一致；
 *    (b) 同请求重放响应体逐字节全等；(c) p4d3-nav/p7f 既有锚回归绿 = 前门禁基线
 *    行为字节级承载——全量回归承载，报告记录）；
 * ⑨ 门禁 lang：siteConfig 改名 → 409；
 * ⑩ 门禁 comments：commentConfig 改名 → 409；
 * ⑪ 洗白防护：nav 改名 → 409 → capture（漂移轴重置 clean）→ 探针仍失败（档案参照
 *    不被基线重置）→ 还原 → 通过（两轴正交实证）；
 * ⑫ 形态级门禁：navBarConfig 顶层完好、links 嵌套形态破坏（字符串非数组）→ 409；
 * ⑬ profileVersion 失配（capture 后手改基线 JSON version → 拒绝加载 + 重捕获指引）
 *    + 解析失败态（坏 JSON → 诊断明细）——R3 分派表非法两态。
 * ⑭ [Phase4-D4/配套2] i18nSupport 双断言：策展值 schema 往返保真 + optional 缺省合法
 *    （T1.3 additive 落档——旧档案零破坏、升版不受迫；siteLangUnion 即面板选项源）。
 * 注：主题根用 mizuki fixture cpSync 后内联写入最小 src/config.ts（零 fixture 变更，
 * 形态仿真实主题：LinkPreset 标识符 + 数组 + children 嵌套；探针结构性匹配——原始态
 * 与物化态均须通过，禁写特定配置值为预期）；用例按文件序执行且共享状态
 * （⑥②①⑤ 无基线态 → ③④⑬ 基线生命周期 → ⑦⑨⑩⑫⑪⑧ 门禁）。
 */

// 主题 config.ts 基线（对齐真实主题形态：非导出简单常量 + 导出对象字面量 +
// 标识符引用 + LinkPreset 标识符 + 数组字面量 + children 嵌套）
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

export const navBarConfig = {
\tlinks: [
\t\tLinkPreset.Home,
\t\t{
\t\t\tname: "Links",
\t\t\turl: "/links/",
\t\t\ticon: "material-symbols:link",
\t\t\tchildren: [
\t\t\t\t{
\t\t\t\t\tname: "GitHub",
\t\t\t\t\turl: "https://github.com/matsuzaka-yuki/Mizuki",
\t\t\t\t\texternal: true,
\t\t\t\t},
\t\t\t],
\t\t},
\t],
};
`;

// ⑫ 形态级门禁靶点：navBarConfig 顶层完好（声明 + 对象字面量），links 为字符串非数组
const LINKS_BROKEN_CONFIG_TS = `const SITE_LANG = "zh_CN";

export const siteConfig = {
  title: "Mizuki",
  lang: SITE_LANG,
};

export const commentConfig = {
  enable: false,
};

export const navBarConfig = {
\tlinks: "flat-string",
};
`;

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4e3a-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
process.env['MIZUKI_THEME_BASELINE_PATH'] = path.join(tmp, 'theme-baseline', 'baseline.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const overridePath = process.env['MIZUKI_CONFIG_OVERRIDE_PATH'];
const baselinePath = process.env['MIZUKI_THEME_BASELINE_PATH'];

/** theme-status 响应视图（宽松断言面，逐字段窄化） */
interface ThemeStatusLike {
  identity: { name: string | null; version: string | null; fallback: 'package.json' | 'fingerprint' };
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

describe('Phase4-E3a：theme-lock 机制（Registry + Tier 1 档案）e2e', () => {
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

  const statusOf = async (): Promise<{ res: request.Response; body: ThemeStatusLike }> => {
    const res = await server().get('/api/v1/admin/theme/status');
    return { res, body: res.body as ThemeStatusLike };
  };

  const sha256Of = (absPath: string): string =>
    createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');

  /** 侧车零变更断言（不存在态 = 保持不存在） */
  const expectCarrierUnchanged = (before: string | null): void => {
    if (before === null) {
      expect(fs.existsSync(overridePath)).toBe(false);
    } else {
      expect(fs.readFileSync(overridePath, 'utf8')).toBe(before);
    }
  };

  it('⑥ 无基线三态呈现：不 capture 即测 → drift=no-baseline，探针轴照常运行', async () => {
    const { res, body } = await statusOf();
    expect(res.status).toBe(200);
    expect(body.baseline.state).toBe('absent');
    expect(body.baseline.profileVersion).toBeNull();
    expect(body.drift.state).toBe('no-baseline');
    expect(body.drift.items).toEqual([]);
    // 探针轴独立于基线存在性：无基线仍产出探针结果（档案参照，非基线参照）
    expect(body.probes).toHaveLength(MizukiTier1Profile.declarationProbes.length);
    for (const probe of body.probes) {
      expect(probe.passed, probe.target).toBe(true); // 完好 fixture → 全通过
    }
  });

  it('② fixture 扫描指纹集完整（编目 8 条目）+ 重扫幂等（两次 digest 全等）', async () => {
    const first = await statusOf();
    const second = await statusOf();
    expect(first.res.status).toBe(200);
    expect(second.res.status).toBe(200);
    const f1 = first.body.fingerprint;
    const f2 = second.body.fingerprint;
    // 指纹集完整：T1.2 编目表终值（5 文件 + 3 目录级）
    expect(f1.entries).toHaveLength(8);
    const byPath = new Map(f1.entries.map((entry) => [entry.path, entry]));
    // (a) 物化链声明载体：present + 哈希与独立计算一致
    expect(byPath.get('src/config.ts')?.present).toBe(true);
    expect(byPath.get('src/config.ts')?.sha256).toBe(sha256Of(configTsPath));
    // (b) 身份文件：fixture 两者均在
    expect(byPath.get('package.json')?.present).toBe(true);
    expect(byPath.get('astro.config.mjs')?.present).toBe(true);
    // (c) 目录级结构假设：public/ 与 src/content/posts/ 存在、dist/ 不存在
    expect(byPath.get('public/')?.present).toBe(true);
    expect(byPath.get('src/content/posts/')?.present).toBe(true);
    expect(byPath.get('dist/')?.present).toBe(false);
    // (d) token 样式文件：fixture 缺失 → present=false + sha256=null
    expect(byPath.get('src/styles/main.css')?.present).toBe(false);
    expect(byPath.get('src/styles/main.css')?.sha256).toBeNull();
    expect(byPath.get('src/styles/variables.styl')?.present).toBe(false);
    // 重扫幂等：entries 与 digest 两次全等（scannedAt 时间戳不进 digest）
    expect(f1.digest).toBe(f2.digest);
    expect(f1.entries).toEqual(f2.entries);
  });

  it('① Profile schema 往返 + 非法拒绝（profileVersion 必填、seeds 非空、.strict() 越界键）', () => {
    const parsed = ThemeProfileSchema.safeParse(MizukiTier1Profile);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(MizukiTier1Profile); // 往返保真
    }
    // 非法：profileVersion 空（必填 min(1)）
    expect(ThemeProfileSchema.safeParse({ ...MizukiTier1Profile, profileVersion: '' }).success).toBe(false);
    // 非法：fingerprintSeeds 空数组（min(1)——空编目 = 无执法面）
    expect(ThemeProfileSchema.safeParse({ ...MizukiTier1Profile, fingerprintSeeds: [] }).success).toBe(false);
    // 非法：越界键（.strict()，幽灵字段禁入）
    expect(ThemeProfileSchema.safeParse({ ...MizukiTier1Profile, unknownKey: 1 }).success).toBe(false);
    // 非法：探针 checks 含未知形态级别
    const badProbe = MizukiTier1Profile.declarationProbes.map((probe) =>
      probe.target === 'siteConfig' ? { ...probe, checks: ['not-a-check'] } : probe,
    );
    expect(
      ThemeProfileSchema.safeParse({ ...MizukiTier1Profile, declarationProbes: badProbe }).success,
    ).toBe(false);
  });

  it('⑭ [Phase4-D4/配套2] i18nSupport 双断言：策展值往返保真 + optional 缺省合法（T1.3 additive）', () => {
    // 断言一：含 i18nSupport 的档案整体往返保真（策展节逐键过 schema，键序归一后 toEqual）
    const parsed = ThemeProfileSchema.safeParse(MizukiTier1Profile);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.i18nSupport).toEqual(MizukiTier1Profile.i18nSupport);
    }
    // 断言二：optional 缺省合法——省略 i18nSupport 仍可解析（旧档案零破坏，升版不受迫）
    const withoutI18n: Record<string, unknown> = { ...MizukiTier1Profile };
    delete withoutI18n['i18nSupport'];
    expect(ThemeProfileSchema.safeParse(withoutI18n).success).toBe(true);
    // 语义抽检：siteLangUnion（SiteConfigPage el-select 选项源）为非空字符串数组
    const union = MizukiTier1Profile.i18nSupport?.siteLangUnion ?? [];
    expect(union.length).toBeGreaterThan(0);
    expect(union.every((code) => typeof code === 'string' && code.length > 0)).toBe(true);
  });

  it('⑤ 身份降级：package.json 无 version → 指纹代身份（运行期改写临时根副本，零 fixture 变更）', async () => {
    const pkgPath = path.join(mizukiRoot, 'package.json');
    const original = fs.readFileSync(pkgPath, 'utf8');
    try {
      const pkg = JSON.parse(original) as Record<string, unknown>;
      delete pkg['version'];
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      const { body } = await statusOf();
      expect(body.identity.name).toBe('mizuki-fixture');
      expect(body.identity.version).toBeNull();
      expect(body.identity.fallback).toBe('fingerprint'); // 指纹代身份（降级态）
    } finally {
      fs.writeFileSync(pkgPath, original);
    }
    // 还原后身份恢复（Registry 运行期可重复语义：逐请求活读）
    const { body } = await statusOf();
    expect(body.identity.version).toBe('1.0.0');
    expect(body.identity.fallback).toBe('package.json');
  });

  it('③ 基线捕获 → 零漂移 round-trip（capture 201 → loaded + clean）', async () => {
    const cap = await server().post('/api/v1/admin/theme/capture');
    expect(cap.status).toBe(201);
    expect(fs.existsSync(baselinePath)).toBe(true); // 基线落盘注入路径
    const { body } = await statusOf();
    expect(body.baseline.state).toBe('loaded');
    expect(body.baseline.profileVersion).toBe(MizukiTier1Profile.profileVersion);
    expect(body.baseline.capturedAt).toBeTruthy();
    expect(body.drift.state).toBe('clean');
    expect(body.drift.items).toEqual([]);
    expect(body.probes.every((probe) => probe.passed)).toBe(true); // 完好态探针全绿
  });

  it('④ 漂移检出：fixture 变更 → 漂移项 path+kind 枚举（modified/added/removed 三态）', async () => {
    // modified：config.ts 追加注释（baseline 有、live 哈希异）
    const cfgOriginal = fs.readFileSync(configTsPath, 'utf8');
    fs.writeFileSync(configTsPath, `${cfgOriginal}\n// drift-probe\n`);
    // added：baseline 无（fixture 缺 styles）→ live 创建
    fs.mkdirSync(path.join(mizukiRoot, 'src', 'styles'), { recursive: true });
    fs.writeFileSync(path.join(mizukiRoot, 'src', 'styles', 'variables.styl'), ':root\n');
    // removed：baseline 有 → live 删除
    const astroOriginal = fs.readFileSync(path.join(mizukiRoot, 'astro.config.mjs'), 'utf8');
    fs.rmSync(path.join(mizukiRoot, 'astro.config.mjs'));
    try {
      const { body } = await statusOf();
      expect(body.drift.state).toBe('drifted');
      expect(body.drift.items).toHaveLength(3);
      expect(body.drift.items).toContainEqual({ path: 'src/config.ts', kind: 'modified' });
      expect(body.drift.items).toContainEqual({ path: 'src/styles/variables.styl', kind: 'added' });
      expect(body.drift.items).toContainEqual({ path: 'astro.config.mjs', kind: 'removed' });
    } finally {
      fs.writeFileSync(configTsPath, cfgOriginal);
      fs.rmSync(path.join(mizukiRoot, 'src', 'styles', 'variables.styl'));
      fs.writeFileSync(path.join(mizukiRoot, 'astro.config.mjs'), astroOriginal);
    }
    // 还原后回 clean（漂移为诊断轴：文件还原即消散）
    const after = await statusOf();
    expect(after.body.drift.state).toBe('clean');
    expect(after.body.drift.items).toEqual([]);
  });

  it('⑬ profileVersion 失配 → 拒绝加载 + 重捕获指引；坏 JSON → 解析失败态（R3 非法两态）', async () => {
    const baselineRaw = fs.readFileSync(baselinePath, 'utf8');
    // 失配：手改基线 JSON version 字段（运行时产物域内，零 fixture 变更）
    const baseline = JSON.parse(baselineRaw) as Record<string, unknown>;
    baseline['profileVersion'] = '9999-nonexistent';
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
    let { body } = await statusOf();
    expect(body.baseline.state).toBe('version-mismatch');
    expect(body.baseline.detail).toContain('重新捕获'); // 重捕获指引（分派表失配态）
    expect(body.drift.state).toBe('no-baseline'); // 拒绝加载 → 漂移轴退无基线态
    // 解析失败：写坏 JSON → 诊断明细（分派表解析失败态）
    fs.writeFileSync(baselinePath, '{ broken json');
    ({ body } = await statusOf());
    expect(body.baseline.state).toBe('parse-error');
    expect(body.baseline.detail ?? '').not.toBe('');
    // 恢复通道：重捕获覆盖写 → loaded + clean
    const cap = await server().post('/api/v1/admin/theme/capture');
    expect(cap.status).toBe(201);
    const after = await statusOf();
    expect(after.body.baseline.state).toBe('loaded');
    expect(after.body.drift.state).toBe('clean');
  });

  it('⑦ 门禁 nav：navBarConfig 改名 → 409 含探针明细 + 三步指引且零物化', async () => {
    const carrierBefore = fs.existsSync(overridePath) ? fs.readFileSync(overridePath, 'utf8') : null;
    fs.writeFileSync(
      configTsPath,
      BASELINE_CONFIG_TS.replace('export const navBarConfig', 'export const navBarConfigRenamed'),
    );
    const mutated = fs.readFileSync(configTsPath, 'utf8');
    try {
      const res = await server()
        .put('/api/v1/admin/config/nav')
        .send({ links: [{ name: 'X', url: '/x/' }] });
      expect(res.status).toBe(409);
      expect(String(res.body.message)).toContain('navBarConfig');
      const detail = res.body.detail as { probes: { target: string; passed: boolean }[]; guidance: string[] };
      const failed = detail.probes.filter((probe) => !probe.passed).map((probe) => probe.target);
      expect(failed).toContain('navBarConfig'); // 声明缺失
      expect(failed).toContain('navBarConfig.links'); // 嵌套目标连带失败
      expect(detail.guidance.join('\n')).toContain('重新捕获基线'); // 三步指引（①）
      expect(detail.guidance.join('\n')).toContain('Tier 1 档案'); // ② 核对并修订档案
      // 零物化：config.ts 与侧车字节不变（门禁先于一切写动作）
      expect(fs.readFileSync(configTsPath, 'utf8')).toBe(mutated);
      expectCarrierUnchanged(carrierBefore);
    } finally {
      fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS);
    }
  });

  it('⑨ 门禁 lang：siteConfig 改名 → 409 含探针明细且零物化', async () => {
    const carrierBefore = fs.existsSync(overridePath) ? fs.readFileSync(overridePath, 'utf8') : null;
    fs.writeFileSync(
      configTsPath,
      BASELINE_CONFIG_TS.replace('export const siteConfig', 'export const siteConfigRenamed'),
    );
    const mutated = fs.readFileSync(configTsPath, 'utf8');
    try {
      const res = await server().put('/api/v1/admin/config/lang').send({ lang: 'en' });
      expect(res.status).toBe(409);
      expect(String(res.body.message)).toContain('siteConfig');
      const detail = res.body.detail as { probes: { target: string; passed: boolean }[]; guidance: string[] };
      const failed = detail.probes.filter((probe) => !probe.passed).map((probe) => probe.target);
      expect(failed).toContain('siteConfig');
      expect(failed).toContain('siteConfig.lang');
      expect(fs.readFileSync(configTsPath, 'utf8')).toBe(mutated); // 零物化
      expectCarrierUnchanged(carrierBefore);
    } finally {
      fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS);
    }
  });

  it('⑩ 门禁 comments：commentConfig 改名 → 409 含探针明细且零物化', async () => {
    const carrierBefore = fs.existsSync(overridePath) ? fs.readFileSync(overridePath, 'utf8') : null;
    fs.writeFileSync(
      configTsPath,
      BASELINE_CONFIG_TS.replace('export const commentConfig', 'export const commentConfigRenamed'),
    );
    const mutated = fs.readFileSync(configTsPath, 'utf8');
    try {
      const res = await server()
        .put('/api/v1/admin/config/comments')
        .send({ enable: true, system: 'twikoo', twikoo: { envId: 'https://tw.example.com' } });
      expect(res.status).toBe(409);
      expect(String(res.body.message)).toContain('commentConfig');
      const detail = res.body.detail as { probes: { target: string; passed: boolean }[]; guidance: string[] };
      expect(detail.probes.some((probe) => probe.target === 'commentConfig' && !probe.passed)).toBe(true);
      expect(fs.readFileSync(configTsPath, 'utf8')).toBe(mutated); // 零物化
      expectCarrierUnchanged(carrierBefore);
    } finally {
      fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS);
    }
  });

  it('⑫ 形态级门禁：navBarConfig 顶层完好、links 嵌套形态破坏（字符串非数组）→ 409', async () => {
    fs.writeFileSync(configTsPath, LINKS_BROKEN_CONFIG_TS);
    const mutated = fs.readFileSync(configTsPath, 'utf8');
    try {
      const res = await server()
        .put('/api/v1/admin/config/nav')
        .send({ links: [{ name: 'X', url: '/x/' }] });
      expect(res.status).toBe(409);
      const detail = res.body.detail as { probes: { target: string; passed: boolean }[] };
      const failed = detail.probes.filter((probe) => !probe.passed).map((probe) => probe.target);
      expect(failed).toEqual(['navBarConfig.links']); // 顶层完好通过、仅嵌套形态失败
      expect(fs.readFileSync(configTsPath, 'utf8')).toBe(mutated); // 零物化
    } finally {
      fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS);
    }
  });

  it('⑪ 洗白防护：nav 改名 → 409 → capture（漂移轴重置 clean）→ 探针仍失败 → 还原 → 通过', async () => {
    const renamed = BASELINE_CONFIG_TS.replace(
      'export const navBarConfig',
      'export const navBarConfigRenamed',
    );
    fs.writeFileSync(configTsPath, renamed);
    try {
      // 改名 → 门禁 409
      const blocked = await server()
        .put('/api/v1/admin/config/nav')
        .send({ links: [{ name: 'X', url: '/x/' }] });
      expect(blocked.status).toBe(409);
      // capture：漂移轴重置（基线吸纳改名态 → live==baseline → clean）
      const cap = await server().post('/api/v1/admin/theme/capture');
      expect(cap.status).toBe(201);
      const still = await server()
        .put('/api/v1/admin/config/nav')
        .send({ links: [{ name: 'X', url: '/x/' }] });
      expect(still.status).toBe(409); // 探针轴不被基线重置（档案参照 ≠ 基线参照）
      // 两轴正交实证：同一时刻漂移 clean + 探针 failed
      const { body } = await statusOf();
      expect(body.drift.state).toBe('clean');
      expect(body.probes.some((probe) => probe.target === 'navBarConfig' && !probe.passed)).toBe(true);
    } finally {
      // 还原 → 门禁通过（唯一恢复通道 = 结构还原，非 capture）
      fs.writeFileSync(configTsPath, BASELINE_CONFIG_TS);
    }
    const restored = await server()
      .put('/api/v1/admin/config/nav')
      .send({ links: [{ name: '恢复', url: '/restored/' }] });
    expect(restored.status).toBe(200);
  });

  it('⑧ 门禁通过回归（字节级三重断言）：golden 物化 + 重放响应全等 + 既有锚回归承载', async () => {
    const nav = [
      {
        name: 'A',
        url: '/a/',
        icon: 'material-symbols:a',
        children: [{ name: 'A1', url: 'https://example.com/' }],
      },
      { name: 'B', url: '#' },
    ];
    // 测试内嵌 golden：valueToTsLiteral 确定性输出（JSON 2 空格缩进去键引号）经
    // ts-morph 声明位置重缩进后的落盘形态（探针实测，.test-tmp/e3a/probe-materialize.ts）
    const golden = [
      '{',
      '          links: [',
      '            {',
      '              name: "A",',
      '              url: "/a/",',
      '              icon: "material-symbols:a",',
      '              children: [',
      '                {',
      '                  name: "A1",',
      '                  url: "https://example.com/"',
      '                }',
      '              ]',
      '            },',
      '            {',
      '              name: "B",',
      '              url: "#"',
      '            }',
      '          ]',
      '        }',
    ].join('\n');
    // 序列化确定性对照（golden 与 valueToTsLiteral 同源：仅缩进差异）
    expect(valueToTsLiteral({ links: nav }).replace(/\n\s*/g, '\n')).toBe(
      golden.replace(/\n\s*/g, '\n'),
    );
    const first = await server().put('/api/v1/admin/config/nav').send({ links: nav });
    expect(first.status).toBe(200);
    // (a) 物化产物 nav 声明区域与 golden 逐字节一致
    const sf = loadSourceFile(configTsPath);
    const init = getVariableDeclarationOrThrow(sf, 'navBarConfig').getInitializerOrThrow();
    expect(init.getText()).toBe(golden);
    // (b) 同请求重放：响应体逐字节全等 + config.ts 重放零变更（before==after 跳写）
    const configAfterFirst = fs.readFileSync(configTsPath, 'utf8');
    const replay = await server().put('/api/v1/admin/config/nav').send({ links: nav });
    expect(replay.status).toBe(200);
    expect(replay.text).toBe(first.text);
    expect(fs.readFileSync(configTsPath, 'utf8')).toBe(configAfterFirst);
    // (c) p4d3-nav/p7f 既有锚回归绿 = 前门禁行为字节级承载（全量回归承载，本 spec 外）
  });
});
