import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [T3b-2b] 主题配置域读写 e2e（ADR-028 §17.6）—— 本批的**装配面**验收。
 *
 * [为什么必须有这一层] 单元 spec（`test/modules/theme/config-writer.spec.ts`，24 用例）用
 *   `new ConfigWriterService({...})` 直接构造服务 ⇒ **Nest 的 DI 完全没被走过**。
 *   而 `emitDecoratorMetadata: true` 下，构造参数的运行期元数据来自 `design:paramtypes`：
 *   若把 `BackupService` 写成 `import type`，值会被编译期擦除、元数据退化为 `Object`，
 *   装配期即抛「can't resolve dependencies」——**四条闸全绿也测不出来**。
 *   本文件是唯一能证明该链路成立的测试（实测：本批确实借此发现并修掉了那个 type-only 导入）。
 *
 * [fixture] 临时域内造 Mizuki HEAD 形态：`src/config/overrideLoader.ts`（HEAD 独有判据）
 *   + `content/`（默认内容目录，**不带 `.git`**，否则被「内容目录是 git 工作副本」拒绝）。
 *   零 fixture 变更、绝不触碰真实主题目录（仓规红线 9）。
 * [状态] ACTIVE
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-config-write-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');

// 落点解析会读 CONTENT_DIR / CONTENT_REPO_URL / ENABLE_CONTENT_SYNC（文件键优先，其次进程 env）。
// 同 worker 内其他 spec 可能留下这些键 ⇒ 显式清掉，避免形态被外部环境改写。
delete process.env['CONTENT_DIR'];
delete process.env['CONTENT_REPO_URL'];
delete process.env['ENABLE_CONTENT_SYNC'];

const themeRoot = path.join(tmp, 'theme');
const contentRoot = path.join(themeRoot, 'content');
const overridesDir = path.join(contentRoot, 'overrides');

/** HEAD 判据：`src/config/overrideLoader.ts` 是文件（legacy 判 `src/config.ts`，Shirone 判 integrationsConfig/index） */
function makeHeadTheme(): void {
  fs.mkdirSync(path.join(themeRoot, 'src', 'config'), { recursive: true });
  fs.mkdirSync(overridesDir, { recursive: true });
  // init 端点的「Mizuki 项目检测」四项：package.json（含 astro 依赖）/ astro.config.* /
  // src/data/（含 diary.ts + friends.ts）/ src/content/posts/
  fs.mkdirSync(path.join(themeRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(themeRoot, 'src', 'content', 'posts'), { recursive: true });
  fs.writeFileSync(
    path.join(themeRoot, 'package.json'),
    `${JSON.stringify({ name: 'theme-fixture', version: '0.0.0', dependencies: { astro: '7.1.3' } }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(themeRoot, 'src', 'data', 'diary.ts'), 'export const diaryData = [];\n', 'utf8');
  fs.writeFileSync(
    path.join(themeRoot, 'src', 'data', 'friends.ts'),
    'export const friendsData = [];\n',
    'utf8',
  );
  fs.writeFileSync(path.join(themeRoot, 'astro.config.mjs'), 'export default {};\n', 'utf8');
  fs.writeFileSync(
    path.join(themeRoot, 'src', 'config', 'overrideLoader.ts'),
    'export function withOverride<T>(_name: string, base: T): T {\n  return base;\n}\n',
    'utf8',
  );
}

describe('T3b-2b 主题配置域读写 e2e（/admin/config/domains*）', () => {
  let app: INestApplication;
  let token: string | undefined;
  let server: request.SuperTest<request.Test>;

  beforeAll(async () => {
    makeHeadTheme();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = withAuth(request(app.getHttpServer()), () => token);
    token = await initAndLogin(request(app.getHttpServer()), themeRoot);
  });

  afterAll(async () => {
    await app.close();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  it('① 域清单：HEAD 档 18 个域、needsSync=true，且响应体内不含任何绝对路径字段', async () => {
    const res = await server.get('/api/v1/admin/config/domains');
    expect(res.status).toBe(200);
    expect(res.body.form).toBe('mizuki-head');
    expect(res.body.sink).toBe('mizuki-head-override');
    expect(res.body.needsSync).toBe(true);
    expect(res.body.domains).toHaveLength(18);
    expect(res.body.domains.every((d: { hasOverride: boolean }) => d.hasOverride === false)).toBe(true);

    const nav = res.body.domains.find((d: { domain: string }) => d.domain === 'navBarConfig');
    expect(nav.panelSupport).toBe('none');
    expect(nav.fileName).toBe('navBarConfig.ts');
    expect(Object.keys(nav)).not.toContain('dirAbs');
    expect(JSON.stringify(res.body)).not.toContain(tmp);
  });

  it('② 写域：落盘到内容仓 overrides/，生成物含同步后基准的 import 路径', async () => {
    const res = await server
      .put('/api/v1/admin/config/domains/siteConfig')
      .send({ values: { title: '我的站点' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      form: 'mizuki-head',
      domain: 'siteConfig',
      fileName: 'siteConfig.ts',
      needsSync: true,
    });

    const written = fs.readFileSync(path.join(overridesDir, 'siteConfig.ts'), 'utf8');
    expect(written).toContain('import type { DeepPartial, SiteConfig } from "../../types/config";');
    expect(written).toContain('satisfies DeepPartial<SiteConfig>;');
    expect(written).toContain('title: "我的站点"');
  });

  it('③ 读域：hasOverride=true、值往返、parseError 为 null', async () => {
    const res = await server.get('/api/v1/admin/config/domains/siteConfig');
    expect(res.status).toBe(200);
    expect(res.body.hasOverride).toBe(true);
    expect(res.body.parseError).toBeNull();
    expect(res.body.values).toEqual({ title: '我的站点' });
  });

  it('④ panelSupport:none —— navBarConfig 读回原文不解析、API 不报错', async () => {
    const res = await server.get('/api/v1/admin/config/domains/navBarConfig');
    expect(res.status).toBe(200);
    expect(res.body.panelSupport).toBe('none');
    expect(res.body.values).toBeNull();
    expect(res.body.parseError).toBeNull();
    expect(res.body.hasOverride).toBe(false);
  });

  it('⑤ panelSupport:none —— navBarConfig 写入被拒，且指引到内容仓', async () => {
    const res = await server
      .put('/api/v1/admin/config/domains/navBarConfig')
      .send({ values: { links: [{ name: 'Home', url: '/' }] } });
    expect(res.status).toBe(400);
    expect(res.body.detail.reason).toBe('panel-unsupported');
    expect(res.body.message).toContain('overrides/navBarConfig.ts');
    expect(JSON.stringify(res.body)).not.toContain(tmp);
  });

  it('⑥ 空对象被拒（reason=empty-values），且**不得**以「构建/报错」为由（回归钉）', async () => {
    const res = await server.put('/api/v1/admin/config/domains/siteConfig').send({ values: {} });
    expect(res.status).toBe(400);
    expect(res.body.detail.reason).toBe('empty-values');
    expect(res.body.message).toContain('DELETE');
    // 上游 config-overlay.mjs:216-217 会把空映射 continue 掉 ⇒ 两档写空对象都是无副作用的空操作。
    // 该拒绝是语义判断，理由一旦被写成「会弄挂构建」即为复犯（见 ADR-028 §17.7）。
    expect(res.body.message).not.toContain('构建');
    expect(res.body.message).not.toContain('报错');
  });

  it('⑦ 未知域被拒（reason=unknown-domain）', async () => {
    const res = await server.put('/api/v1/admin/config/domains/notADomain').send({ values: { a: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.detail.reason).toBe('unknown-domain');
  });

  it('⑧ 信封校验：缺 values / 多顶层键 一律 400（shared schema .strict()）', async () => {
    const missing = await server.put('/api/v1/admin/config/domains/siteConfig').send({ title: 'x' });
    expect(missing.status).toBe(400);
    const extra = await server
      .put('/api/v1/admin/config/domains/siteConfig')
      .send({ values: { title: 'x' }, unexpected: 1 });
    expect(extra.status).toBe(400);
  });

  it('⑨ 恢复默认：删除覆盖文件（removed=true），再次调用幂等（removed=false，不 404）', async () => {
    const first = await server.delete('/api/v1/admin/config/domains/siteConfig');
    expect(first.status).toBe(200);
    expect(first.body.removed).toBe(true);
    expect(fs.existsSync(path.join(overridesDir, 'siteConfig.ts'))).toBe(false);

    const second = await server.delete('/api/v1/admin/config/domains/siteConfig');
    expect(second.status).toBe(200);
    expect(second.body.removed).toBe(false);
    expect(second.body.needsSync).toBe(true);
  });

  it('⑩ panelSupport:none 的域仍可 DELETE（不解析 ⇒ 删除是唯一的逃生门）', async () => {
    const res = await server.delete('/api/v1/admin/config/domains/navBarConfig');
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe('navBarConfig');
    expect(res.body.fileName).toBe('navBarConfig.ts');
  });

  it('⑪ 路由共存：本控制器只占 /admin/config/domains*，未吞掉同级其它子路径', async () => {
    // 未注册的子路径必须是路由级 404（证明 `domains/:domain` 没有退化成 `:anything` 把同级路径吃掉）
    const res = await server.get('/api/v1/admin/config/nope');
    expect(res.status).toBe(404);
  });

  // [无碰撞的正面证据在别处，不在此文件] `site-config` 与本控制器共用 `@Controller('admin/config')`
  // 前缀，两者的共存由既有套件承载：`test/p4d3-nav.e2e-spec.ts`（6 用例）与
  // `test/p7f-config-override.e2e-spec.ts`（16 用例）**大量打 `GET /api/v1/admin/config`**，
  // 实测 22/22 全绿 ⇒ 既有端点未被本批吞掉。
  // ⚠ 本文件的 fixture 是 **Mizuki HEAD 形态**（无 `src/config.ts`），而 `site-config` 面向
  // legacy 单文件配置 —— 它会因 `configTsPath()` 找不到文件而**合理地**抛 `NotFoundException`（404）。
  // 故**不得**在此断言 `GET /admin/config` 为 200：那是断言前提错，不是产品缺陷（本批踩过一次）。
});
