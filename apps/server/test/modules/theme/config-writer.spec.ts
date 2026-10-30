/**
 * [T4] config-writer 单测：全部在 mkdtemp 临时域内构造（仓规红线 9，绝不碰真实主题目录）。
 * 覆盖：总闸透传 · legacy 空表 · HEAD 17 literal + navBarConfig 三态 · Shirone 32 域与
 * 5 组 key≠file 文件名 · 路径监狱 · 空对象回归钉 · serde 拒绝透传 · 备份前置 · 读回解析失败 ·
 * reset 幂等 · 对外文案不含绝对路径。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpException } from '@nestjs/common';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  MIZUKI_HEAD_OVERRIDE_DOMAINS,
  SHIRONE_CONFIG_DOMAINS,
} from '../../../src/common/theme/config-domains';
import { buildMizukiHeadOverrideSource } from '../../../src/common/theme/config-serde';
import { MANIFEST_FILE } from '../../../src/common/theme/content-source';
import type { BackupService } from '../../../src/infra/backup/backup.service';
import { ConfigWriterService } from '../../../src/modules/theme/config-writer.service';

/** getAppConfig 单例被 mock：主题根由每个用例写进 state（不读真实 config.json） */
const state = vi.hoisted(() => ({ mizukiRoot: '' }));

vi.mock('../../../src/config/app-config', () => ({
  getAppConfig: (): { mizukiRoot: string } => ({ mizukiRoot: state.mizukiRoot }),
}));

const tmpRoots: string[] = [];
const ENV_KEYS = ['ENABLE_CONTENT_SYNC', 'CONTENT_DIR', 'CONTENT_REPO_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function makeRoot(prefix = 'theme-config-writer-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function touch(file: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, '', 'utf8');
}

function writeText(file: string, text: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, 'utf8');
}

function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** mizuki legacy（单文件 src/config.ts） */
function makeLegacy(): string {
  const root = makeRoot('legacy-');
  touch(path.join(root, 'src', 'config.ts'));
  return root;
}

interface HeadFixture {
  root: string;
  contentDir: string;
  overridesDir: string;
}

/** mizuki HEAD：内容目录存在（无 .git）⇒ sink=mizuki-head-override，落点 <内容目录>/overrides */
function makeMizukiHead(): HeadFixture {
  const root = makeRoot('head-');
  touch(path.join(root, 'src', 'config', 'overrideLoader.ts'));
  const contentDir = path.join(root, 'content');
  const overridesDir = path.join(contentDir, 'overrides');
  ensureDir(overridesDir);
  return { root, contentDir, overridesDir };
}

/** HEAD 但**没有**内容目录（总闸应拒绝） */
function makeMizukiHeadWithoutContent(): string {
  const root = makeRoot('head-no-content-');
  touch(path.join(root, 'src', 'config', 'overrideLoader.ts'));
  return root;
}

interface ShironeFixture {
  root: string;
  contentRepo: string;
  configDir: string;
}

/** shirone：source.type=path ⇒ sink=shirone-yaml，落点 <内容仓>/config */
function makeShirone(manifest?: unknown): ShironeFixture {
  const root = makeRoot('shirone-');
  touch(path.join(root, 'src', 'config', 'integrationsConfig.ts'));
  const contentRepo = makeRoot('shirone-content-');
  writeJson(
    path.join(root, MANIFEST_FILE),
    manifest ?? { schemaVersion: 1, source: { type: 'path', path: contentRepo } },
  );
  return { root, contentRepo, configDir: path.join(contentRepo, 'config') };
}

interface Harness {
  service: ConfigWriterService;
  spy: Mock<(abs: string, note?: string) => Promise<undefined>>;
}

/** BackupService 用桩替换：断言「写/删前必调 preWriteBackup」，且不碰真实备份目录 */
function makeHarness(): Harness {
  const spy = vi.fn<(abs: string, note?: string) => Promise<undefined>>(async () => undefined);
  const service = new ConfigWriterService({ preWriteBackup: spy } as unknown as BackupService);
  return { service, spy };
}

/** 展开目录树（目录带尾斜杠），用于「零越界产物」断言 */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort();
}

interface Rejection {
  reason: string;
  message: string;
}

/** 取拒绝载荷：`detail.reason` + 人话 message（异常类型必须是 Nest HttpException） */
async function rejectionOf(run: () => Promise<unknown> | unknown): Promise<Rejection> {
  let payload: Rejection | null = null;
  try {
    await run();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body: unknown = error.getResponse();
    const record: Record<string, unknown> =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const detail: Record<string, unknown> =
      typeof record['detail'] === 'object' && record['detail'] !== null
        ? (record['detail'] as Record<string, unknown>)
        : {};
    payload = {
      reason: typeof detail['reason'] === 'string' ? detail['reason'] : '',
      message: typeof record['message'] === 'string' ? record['message'] : error.message,
    };
  }
  if (payload === null) throw new Error('期望被拒，但调用成功了');
  return payload;
}

/** 对外文案红线 6：不含任何磁盘绝对路径 */
function expectNoAbsPath(message: string, ...roots: string[]): void {
  for (const root of roots) {
    expect(message.includes(root)).toBe(false);
    expect(message.includes(root.replace(/\\/g, '/'))).toBe(false);
  }
  expect(/[A-Za-z]:[\\/]/.test(message)).toBe(false);
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  state.mizukiRoot = '';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => {
  for (const dir of tmpRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ConfigWriterService — 总闸（落点单源不 ok ⇒ 一律拒绝）', () => {
  it('主题根为空 ⇒ 四个动作全部以 theme-form-unsupported 拒绝，message 原样透传', async () => {
    const { service } = makeHarness();
    for (const action of [
      (): unknown => service.listDomains(),
      (): unknown => service.readDomain('siteConfig'),
      (): Promise<unknown> => service.writeDomain('siteConfig', { a: 1 }),
      (): Promise<unknown> => service.resetDomain('siteConfig'),
    ]) {
      const rejected = await rejectionOf(action);
      expect(rejected.reason).toBe('theme-form-unsupported');
      expect(rejected.message).toContain('下一步');
      expectNoAbsPath(rejected.message);
    }
  });

  it('HEAD 但无内容目录 ⇒ mizuki-head-no-content-dir，且文案不含主题根绝对路径', async () => {
    const root = makeMizukiHeadWithoutContent();
    state.mizukiRoot = root;
    const { service } = makeHarness();
    const rejected = await rejectionOf(() => service.writeDomain('siteConfig', { a: 1 }));
    expect(rejected.reason).toBe('mizuki-head-no-content-dir');
    expect(rejected.message).toContain('内容目录');
    expectNoAbsPath(rejected.message, root);
  });

  it('ENABLE_CONTENT_SYNC=false ⇒ mizuki-head-content-sync-disabled（透传理由与下一步）', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    process.env.ENABLE_CONTENT_SYNC = 'false';
    const { service } = makeHarness();
    const rejected = await rejectionOf(() => service.readDomain('siteConfig'));
    expect(rejected.reason).toBe('mizuki-head-content-sync-disabled');
    expect(rejected.message).toContain('ENABLE_CONTENT_SYNC');
    expectNoAbsPath(rejected.message, fixture.root);
  });

  it('Shirone 无清单（local 模式）⇒ shirone-local-mode', async () => {
    const root = makeRoot('shirone-local-');
    touch(path.join(root, 'src', 'config', 'integrationsConfig.ts'));
    state.mizukiRoot = root;
    const { service } = makeHarness();
    const rejected = await rejectionOf(() => service.listDomains());
    expect(rejected.reason).toBe('shirone-local-mode');
    expectNoAbsPath(rejected.message, root);
  });
});

describe('ConfigWriterService — legacy 档（空表 + 全拒）', () => {
  it('listDomains 为空表（sink=mizuki-legacy-ts-morph，needsSync=false）', () => {
    const root = makeLegacy();
    state.mizukiRoot = root;
    const { service } = makeHarness();
    const list = service.listDomains();
    expect(list.form).toBe('mizuki-legacy');
    expect(list.sink).toBe('mizuki-legacy-ts-morph');
    expect(list.needsSync).toBe(false);
    expect(list.domains).toEqual([]);
    expect(JSON.stringify(list).includes(root)).toBe(false);
  });

  it('任一 domain 的 read / write / reset 全被拒（theme-form-unsupported），文案不泄绝对路径', async () => {
    const root = makeLegacy();
    state.mizukiRoot = root;
    const { service } = makeHarness();
    for (const action of [
      (): unknown => service.readDomain('siteInfo'),
      (): Promise<unknown> => service.writeDomain('siteInfo', { a: 1 }),
      (): Promise<unknown> => service.resetDomain('siteConfig'),
    ]) {
      const rejected = await rejectionOf(action);
      expect(rejected.reason).toBe('theme-form-unsupported');
      expect(rejected.message).toContain('站点配置');
      expectNoAbsPath(rejected.message, root);
    }
  });
});

describe('ConfigWriterService — Mizuki HEAD 档', () => {
  it('listDomains 返回 18 域（navBarConfig 为 none，其余 literal），且无 dirAbs 外泄', () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const list = service.listDomains();

    expect(list.form).toBe('mizuki-head');
    expect(list.sink).toBe('mizuki-head-override');
    expect(list.needsSync).toBe(true);
    expect(list.domains.length).toBe(18);
    expect(list.domains.filter((d) => d.panelSupport === 'literal').length).toBe(17);
    expect(list.domains.find((d) => d.domain === 'navBarConfig')?.panelSupport).toBe('none');
    expect(list.domains.find((d) => d.domain === 'navBarConfig')?.fileName).toBe('navBarConfig.ts');
    expect(list.domains.every((d) => d.hasOverride === false)).toBe(true);
    expect(JSON.stringify(list).includes(fixture.root)).toBe(false);
  });

  it('未知 domain ⇒ unknown-domain（读/写/删三路一致）', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    for (const action of [
      (): unknown => service.readDomain('nopeConfig'),
      (): Promise<unknown> => service.writeDomain('nopeConfig', { a: 1 }),
      (): Promise<unknown> => service.resetDomain('nopeConfig'),
    ]) {
      const rejected = await rejectionOf(action);
      expect(rejected.reason).toBe('unknown-domain');
      expectNoAbsPath(rejected.message, fixture.root);
    }
  });

  it('17 个 literal 域：写入后文件确实存在且内容 = 生成物，读回往返，删除（reset）成功', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const literal = MIZUKI_HEAD_OVERRIDE_DOMAINS.filter((d) => d.panelSupport === 'literal');
    expect(literal.length).toBe(17);

    for (const domain of literal) {
      const values = { sample: 1, flag: true, nested: { text: 'ok' } };
      const written = await service.writeDomain(domain.name, values);
      expect(written.needsSync).toBe(true);
      expect(written.fileName).toBe(`${domain.name}.ts`);

      const abs = path.join(fixture.overridesDir, `${domain.name}.ts`);
      expect(fs.existsSync(abs)).toBe(true);
      const built = buildMizukiHeadOverrideSource(domain.name, values);
      expect(built.ok).toBe(true);
      expect(fs.readFileSync(abs, 'utf8')).toBe(built.ok ? built.source : '');

      const read = service.readDomain(domain.name);
      expect(read.values).toEqual(values);
      expect(read.parseError).toBeNull();
      expect(read.hasOverride).toBe(true);

      const reset = await service.resetDomain(domain.name);
      expect(reset.removed).toBe(true);
      expect(fs.existsSync(abs)).toBe(false);
      expect(service.readDomain(domain.name).values).toEqual({});
    }
  });

  it('navBarConfig：read 返回 panelSupport:none 且不解析（文件在也不解析）', () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();

    const absent = service.readDomain('navBarConfig');
    expect(absent.panelSupport).toBe('none');
    expect(absent.hasOverride).toBe(false);
    expect(absent.values).toBeNull();
    expect(absent.rawSource).toBeNull();
    expect(absent.parseError).toBeNull();

    const raw = 'export default { links: [LinkPreset.Home] };\n';
    writeText(path.join(fixture.overridesDir, 'navBarConfig.ts'), raw);
    const present = service.readDomain('navBarConfig');
    expect(present.hasOverride).toBe(true);
    expect(present.rawSource).toBe(raw);
    expect(present.values).toBeNull();
    expect(present.parseError).toBeNull();
  });

  it('navBarConfig：write 被拒且 message 提到内容仓与枚举原因；reset 放行（成功删除）', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();

    const rejected = await rejectionOf(() => service.writeDomain('navBarConfig', { links: [] }));
    expect(rejected.reason).toBe('panel-unsupported');
    expect(rejected.message).toContain('LinkPreset.Home');
    expect(rejected.message).toContain('内容仓');
    expect(rejected.message).toContain('navBarConfig.ts');
    expectNoAbsPath(rejected.message, fixture.root);

    const abs = path.join(fixture.overridesDir, 'navBarConfig.ts');
    expect(fs.existsSync(abs)).toBe(false);
    await service.writeDomain('footerConfig', { a: 1 });
    writeText(abs, 'export default { links: [LinkPreset.Home] };\n');
    const reset = await service.resetDomain('navBarConfig');
    expect(reset.removed).toBe(true);
    expect(fs.existsSync(abs)).toBe(false);
  });

  it('read：文件在但含标识符值 ⇒ values:null + parseError，不抛错、不报 4xx', () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    writeText(
      path.join(fixture.overridesDir, 'siteConfig.ts'),
      'export default { title: someIdentifier };\n',
    );

    const read = service.readDomain('siteConfig');
    expect(read.hasOverride).toBe(true);
    expect(read.values).toBeNull();
    expect(read.parseError?.reason).toBe('non-literal-value');
    expect(read.parseError?.message).toContain('$.title');
    expectNoAbsPath(read.parseError?.message ?? '', fixture.root);
  });

  it('write：空对象被拒，且理由**不得**再提「构建 / 报错」（回归钉）', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const rejected = await rejectionOf(() => service.writeDomain('siteConfig', {}));
    expect(rejected.reason).toBe('empty-values');
    expect(rejected.message).toContain('hasOverride');
    expect(rejected.message).toContain('DELETE');
    expect(rejected.message.includes('构建')).toBe(false);
    expect(rejected.message.includes('报错')).toBe(false);
    expect(fs.existsSync(path.join(fixture.overridesDir, 'siteConfig.ts'))).toBe(false);
  });

  it('write：serde 拒绝原样透传（NaN ⇒ unsupported-value，message 含键路径）', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const rejected = await rejectionOf(() => service.writeDomain('siteConfig', { x: Number.NaN }));
    expect(rejected.reason).toBe('unsupported-value');
    expect(rejected.message).toContain('"$.x"');
    expect(fs.existsSync(path.join(fixture.overridesDir, 'siteConfig.ts'))).toBe(false);
  });

  it('写入与删除前都调用 preWriteBackup（note 带域名），且临时域外零产物', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service, spy } = makeHarness();

    await service.writeDomain('siteConfig', { a: 1 });
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spy.mock.calls[0]?.[0]).toBe(path.join(fixture.overridesDir, 'siteConfig.ts'));
    expect(spy.mock.calls[0]?.[1]).toContain('siteConfig');

    const before = spy.mock.calls.length;
    await service.resetDomain('siteConfig');
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(spy.mock.calls.at(-1)?.[1]).toContain('siteConfig');

    expect(snapshot(fixture.overridesDir)).toEqual([]);
  });
});

describe('ConfigWriterService — Shirone 档', () => {
  it('listDomains 返回 32 域，navBar 的文件名是 nav-bar.yaml', () => {
    const fixture = makeShirone();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const list = service.listDomains();

    expect(list.form).toBe('shirone');
    expect(list.sink).toBe('shirone-yaml');
    expect(list.needsSync).toBe(true);
    expect(list.domains.length).toBe(32);
    expect(list.domains.every((d) => d.panelSupport === 'literal')).toBe(true);
    expect(list.domains.find((d) => d.domain === 'navBar')?.fileName).toBe('nav-bar.yaml');
    expect(JSON.stringify(list).includes(fixture.contentRepo)).toBe(false);
  });

  it('32 个域可写；5 组 key≠file 的文件名逐条正确（禁按 kebab-case 硬拼）', async () => {
    const fixture = makeShirone();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();

    const expectedFileName: Record<string, string> = {
      expressiveCode: 'expressive-code.yaml',
      postList: 'post-list.yaml',
      contextMenu: 'context-menu.yaml',
      imageBloom: 'image-bloom.yaml',
      navBar: 'nav-bar.yaml',
    };

    for (const domain of SHIRONE_CONFIG_DOMAINS) {
      const written = await service.writeDomain(domain.key, { preset: 'Home' });
      expect(written.fileName).toBe(expectedFileName[domain.key] ?? `${domain.key}.yaml`);
      const abs = path.join(fixture.configDir, written.fileName);
      expect(fs.existsSync(abs)).toBe(true);
      if (expectedFileName[domain.key] === undefined) {
        expect(fs.existsSync(path.join(fixture.configDir, `${domain.key}.yaml`))).toBe(true);
      }
    }

    // navBar 的 kebab-case 误拼产物绝不存在
    expect(fs.existsSync(path.join(fixture.configDir, 'navBar.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.configDir, 'expressiveCode.yaml'))).toBe(false);
    expect(snapshot(fixture.configDir).length).toBe(32);
  });

  it('写出的 YAML 能被解析端往返（read 回同一 values）', async () => {
    const fixture = makeShirone();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const values = { nested: { list: [1, 2, 3], text: '中文' }, flag: false };
    await service.writeDomain('expressiveCode', values);

    const read = service.readDomain('expressiveCode');
    expect(read.fileName).toBe('expressive-code.yaml');
    expect(read.hasOverride).toBe(true);
    expect(read.values).toEqual(values);
    expect(read.parseError).toBeNull();
  });

  it('write：serde 拒绝透传（null 值 ⇒ 含上游原句「is null.」与补救写法）', async () => {
    const fixture = makeShirone();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const rejected = await rejectionOf(() => service.writeDomain('navBar', { a: null }));
    expect(rejected.reason).toBe('unsupported-value');
    expect(rejected.message).toContain('is null.');
    expect(rejected.message).toContain('use "" to clear text');
    expect(fs.existsSync(path.join(fixture.configDir, 'nav-bar.yaml'))).toBe(false);
  });

  it('read：文件在但 YAML 非法 ⇒ values:null + parseError，不抛错', () => {
    const fixture = makeShirone();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    writeText(path.join(fixture.configDir, 'footer.yaml'), '- a\n- b\n');

    const read = service.readDomain('footer');
    expect(read.hasOverride).toBe(true);
    expect(read.values).toBeNull();
    expect(read.parseError?.reason).toBe('not-mapping');
    expect(read.parseError?.message).toContain('key-value mapping');
  });

  it('未知 domain（含 Windows 风格分隔符）⇒ unknown-domain，且不产生越界文件', async () => {
    const fixture = makeShirone();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    const outside = path.join(fixture.contentRepo, 'evil.yaml');

    for (const domain of ['..\\evil', '../evil', 'a/b', 'nav-bar']) {
      const rejected = await rejectionOf(() => service.writeDomain(domain, { a: 1 }));
      expect(rejected.reason).toBe('unknown-domain');
      expectNoAbsPath(rejected.message, fixture.root, fixture.contentRepo);
    }
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.existsSync(path.join(fixture.contentRepo, 'config', 'a'))).toBe(false);
    // 全部被拒 ⇒ 内容仓里连 config/ 都不该被建出来
    expect(snapshot(fixture.contentRepo)).toEqual([]);
  });
});

describe('ConfigWriterService — 路径监狱与 reset 幂等', () => {
  it('HEAD：domain 为 ../evil / ..\\evil / a/b ⇒ 全被拒，jail 外零文件', async () => {
    const fixture = makeMizukiHead();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();

    for (const domain of ['../evil', '..\\evil', 'a/b', '../../../etc/passwd']) {
      const rejected = await rejectionOf(() => service.writeDomain(domain, { a: 1 }));
      expect(rejected.reason).toBe('unknown-domain');
      expectNoAbsPath(rejected.message, fixture.root, fixture.contentDir);
    }

    expect(fs.existsSync(path.join(fixture.root, 'evil.ts'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.contentDir, 'evil.ts'))).toBe(false);
    expect(fs.existsSync(path.join(os.tmpdir(), 'evil.ts'))).toBe(false);
    expect(snapshot(fixture.overridesDir)).toEqual([]);
  });

  it('reset：对不存在的文件 ⇒ 幂等成功（removed:false，不抛 404）', async () => {
    const head = makeMizukiHead();
    state.mizukiRoot = head.root;
    const { service } = makeHarness();
    const headReset = await service.resetDomain('markdownConfig');
    expect(headReset.removed).toBe(false);
    expect(headReset.needsSync).toBe(true);

    const shirone = makeShirone();
    state.mizukiRoot = shirone.root;
    const shironeReset = await service.resetDomain('series');
    expect(shironeReset.removed).toBe(false);
    expect(shironeReset.fileName).toBe('series.yaml');
  });

  it('reset：写后删除真的移除文件，且删除路径经 jail（父目录 = 内容目录）', async () => {
    const fixture = makeShirone();
    state.mizukiRoot = fixture.root;
    const { service } = makeHarness();
    await service.writeDomain('series', { a: 1 });
    const abs = path.join(fixture.configDir, 'series.yaml');
    expect(fs.existsSync(abs)).toBe(true);

    const reset = await service.resetDomain('series');
    expect(reset.removed).toBe(true);
    expect(path.dirname(abs)).toBe(fixture.configDir);
    expect(fs.existsSync(abs)).toBe(false);
    expect(snapshot(fixture.contentRepo)).toEqual(['config/']);
  });
});
