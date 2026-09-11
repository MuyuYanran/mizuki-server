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
import { astToValue, getVariableDeclarationOrThrow, loadSourceFile } from '../src/modules/data-files/evaluator';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [Phase4-D3] 导航受控子集 e2e（#8，ADR-020 追加节；T4 数账决策表基础 6 锚）：
 * ① baselineNav 对照锚：fixture navBarConfig 含 LinkPreset.Home 标识符（PropertyAccess
 *    节点）+ 顶层数组（astToValueWithConsts 无数组分支）→ 基线不可得 null（降级分支）；
 * ② 合法 → 物化锚（含转义往返）：name/url 含引号/反斜杠（JSON.stringify 转义保证）
 *    物化后 config.ts 语法有效（ts-morph parse + astToValue 求值）且读回 deepEqual 一致；
 *    注：换行属控制字符（U+0000-U+001F）被 T2.1 值域拒绝，转义往返以引号/反斜杠承载
 *    （提示词锚④「换行」场景与值域约束冲突，按值域执行记 SESSIONS 偏差）；
 * ③ 空数组 → 合法清空锚（破坏性语义）：links: [] → 200 物化 links: []、GET 回空数组态；
 * ④ 非法 → 400 锚（P0-4 面全覆盖）：越界键/缺 name/缺 url/类型错/坏 scheme
 *    （javascript:/data:）/超长/控制字符（含换行）/越层 children 孙级，全部 400 零物化；
 * ⑤ 幽灵字段拒绝锚：links 元素越界键 → 400（.strict()）；
 * ⑥ 键缺失 → 还原锚：物化后 PUT {}（links 键缺失）→ config.ts 还原留档原文本
 *    （LinkPreset 引用回来）+ 侧车 nav 键移除 + originals 留档保留（仅首次语义）。
 * 注：主题根用 mizuki fixture cpSync 后内联写入最小 src/config.ts（零 fixture 变更，
 * 形态仿真实主题：LinkPreset 标识符引用 + 数组 + children 嵌套）；用例按文件序执行
 * 且共享状态（⑤降级 → ②物化 → ③清空 → ④⑤非法面 → ⑥还原）。
 */

// 主题 config.ts 基线（对齐真实主题形态：LinkPreset 标识符 + 数组字面量 + children）
const BASELINE_CONFIG_TS = `const SITE_LANG = "zh_CN";

export const siteConfig = {
  title: "Mizuki",
  lang: SITE_LANG,
};

export const commentConfig = {
  enable: false,
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

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4d3-nav-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
process.env['MIZUKI_CONFIG_OVERRIDE_PATH'] = path.join(tmp, 'config-override.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');
const overridePath = process.env['MIZUKI_CONFIG_OVERRIDE_PATH'];

describe('Phase4-D3：导航受控子集（nav override）e2e', () => {
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

  const issuesOf = (res: { body: unknown }): { path: string; message?: string }[] => {
    const body = res.body as { detail?: { issues?: { path: string; message?: string }[] } };
    return body.detail?.issues ?? [];
  };

  const readCarrier = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(overridePath, 'utf8')) as Record<string, unknown>;

  /** 物化后语法有效性 + 读回一致验证：ts-morph parse + astToValue 纯字面量求值 */
  const evalNavConfig = (): unknown => {
    const sf = loadSourceFile(configTsPath); // parse 失败（语法无效）即抛错
    const decl = getVariableDeclarationOrThrow(sf, 'navBarConfig');
    return astToValue(decl.getInitializerOrThrow(), configTsPath);
  };

  it('① baselineNav 对照锚：LinkPreset 标识符 + 数组 → 基线不可得 null（降级分支）', async () => {
    const get = await server().get('/api/v1/admin/config');
    expect(get.status).toBe(200);
    const view = get.body as {
      nav: { links: unknown[] } | null;
      baselineNav: { links: unknown[] } | null;
      siteConfig: { baselineLang: string | null };
    };
    expect(view.siteConfig.baselineLang).toBe('zh_CN'); // 常量代入链路完好（对照非破坏）
    expect(view.baselineNav).toBeNull(); // LinkPreset.PropertyAccess + 数组 → 不可求值
    expect(view.nav).toBeNull(); // 无 override → nav 态 = 基线 = null（空表单起步）
  });

  it('② 合法 → 物化锚（转义往返）：引号/反斜杠经字面量序列化，config.ts 语法有效读回一致', async () => {
    const nav = [
      {
        name: '引"号与\\反斜杠',
        url: '/path/"quote"/\\back/',
        icon: 'material-symbols:"link"',
        external: true,
        children: [{ name: '子项"引\\号', url: 'https://example.com/a\\b?q=1' }],
      },
      { name: '普通项', url: '#' },
    ];
    const put = await server().put('/api/v1/admin/config/nav').send({ links: nav });
    expect(put.status).toBe(200);
    // 物化文本转义形态（JSON.stringify 保证：引号 \"、反斜杠 \\）
    const configTs = fs.readFileSync(configTsPath, 'utf8');
    expect(configTs).toContain('name: "引\\"号与\\\\反斜杠"');
    expect(configTs).toContain('url: "https://example.com/a\\\\b?q=1"');
    // config.ts 语法有效且读回一致（parse + 纯字面量求值 deepEqual）
    expect(evalNavConfig()).toEqual({ links: nav });
    // 侧车 override 态与留档
    const carrier = readCarrier();
    expect(carrier.nav).toEqual({ links: nav });
    expect((carrier.originals as Record<string, string>)?.['navBarConfig']).toContain('LinkPreset.Home');
    // GET 回读：override 优先
    const get = await server().get('/api/v1/admin/config');
    expect((get.body as { nav: { links: unknown[] } | null }).nav).toEqual({ links: nav });
  });

  it('③ 空数组 → 合法清空锚（破坏性语义）：links: [] → 物化 links: []、回读空态', async () => {
    const put = await server().put('/api/v1/admin/config/nav').send({ links: [] });
    expect(put.status).toBe(200);
    const view = (put.body as { nav: { links: unknown[] } | null }).nav;
    expect(view).toEqual({ links: [] }); // 合法清空态（非 null）
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('links: []'); // 物化清空
    const carrier = readCarrier();
    expect((carrier.nav as { links: unknown[] }).links).toEqual([]); // 侧车记录空态
  });

  it('④ 非法 → 400 锚（P0-4 面全覆盖）：越界键/缺 name/缺 url/类型错/坏 scheme/超长/控制字符/越层 → 零物化', async () => {
    const configBefore = fs.readFileSync(configTsPath, 'utf8');
    const carrierBefore = fs.readFileSync(overridePath, 'utf8');
    const badPayloads: { label: string; body: unknown }[] = [
      { label: '越界键（body）', body: { links: [], foo: 1 } },
      { label: '缺 name', body: { links: [{ url: '/x/' }] } },
      { label: '缺 url', body: { links: [{ name: 'X' }] } },
      { label: '类型错（name 数字）', body: { links: [{ name: 123, url: '/x/' }] } },
      { label: '坏 scheme javascript:', body: { links: [{ name: 'X', url: 'javascript:alert(1)' }] } },
      { label: '坏 scheme data:', body: { links: [{ name: 'X', url: 'data:text/html;base64,PGI+' }] } },
      { label: 'name 超 64', body: { links: [{ name: 'a'.repeat(65), url: '/x/' }] } },
      { label: 'url 超 512', body: { links: [{ name: 'X', url: `/${'a'.repeat(512)}` }] } },
      { label: 'icon 超 128', body: { links: [{ name: 'X', url: '/x/', icon: 'i'.repeat(129) }] } },
      { label: '控制字符（换行）', body: { links: [{ name: 'a\nb', url: '/x/' }] } },
      { label: '控制字符（NUL）', body: { links: [{ name: 'a\u0000b', url: '/x/' }] } },
      {
        label: '越层 children（孙级）',
        body: {
          links: [
            {
              name: 'X',
              url: '/x/',
              children: [{ name: 'Y', url: '/y/', children: [{ name: 'Z', url: '/z/' }] }],
            },
          ],
        },
      },
    ];
    for (const { label, body } of badPayloads) {
      const res = await server().put('/api/v1/admin/config/nav').send(body);
      expect(res.status, label).toBe(400);
    }
    expect(fs.readFileSync(configTsPath, 'utf8')).toBe(configBefore); // 失败路径零物化
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(carrierBefore); // 侧车零变更
  });

  it('⑤ 幽灵字段拒绝锚：links 元素越界键 → 400（.strict() 越界禁入）', async () => {
    const res = await server()
      .put('/api/v1/admin/config/nav')
      .send({ links: [{ name: 'X', url: '/x/', target: '_blank' }] });
    expect(res.status).toBe(400);
    // zod v4 .strict() 越界键 issue：message 含键名（Unrecognized key）
    expect(issuesOf(res).some((issue) => (issue.message ?? '').includes('target'))).toBe(true);
  });

  it('⑥ 键缺失 → 还原锚：PUT {} → config.ts 还原原文本（LinkPreset 回归）+ 侧车移除 + 留档保留', async () => {
    // 先物化一个合法 nav（建立 override + 留档态）
    const putOk = await server()
      .put('/api/v1/admin/config/nav')
      .send({ links: [{ name: '临时', url: '/tmp/' }] });
    expect(putOk.status).toBe(200);
    expect(fs.readFileSync(configTsPath, 'utf8')).toContain('name: "临时"');
    // 键缺失 → 清除 override：还原留档原文本
    const put = await server().put('/api/v1/admin/config/nav').send({});
    expect(put.status).toBe(200);
    const view = (put.body as { nav: { links: unknown[] } | null }).nav;
    expect(view).toBeNull(); // override 清除 + 基线不可得 → null
    const configTs = fs.readFileSync(configTsPath, 'utf8');
    expect(configTs).toContain('LinkPreset.Home'); // 原文本还原（LinkPreset 引用回归）
    expect(configTs).not.toContain('临时'); // 物化文本消失
    const carrier = readCarrier();
    expect(carrier).not.toHaveProperty('nav'); // 侧车移除键
    expect((carrier.originals as Record<string, string>)?.['navBarConfig']).toContain(
      'LinkPreset.Home',
    ); // 留档保留（仅首次语义，还原后仍可追溯）
  });
});
