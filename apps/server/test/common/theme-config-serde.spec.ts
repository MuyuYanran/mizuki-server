/**
 * [T4] theme-config-serde 单测：两张权威登记表的完整性与覆盖模块的生成 / 解析。
 * 全程纯内存（ts-morph `useInMemoryFileSystem`），不落任何临时文件（仓规红线 9）。
 */
import { describe, expect, it } from 'vitest';
import {
  MIZUKI_HEAD_OVERRIDE_BY_NAME,
  MIZUKI_HEAD_OVERRIDE_DOMAINS,
  SHIRONE_CONFIG_DOMAIN_KEYS,
  SHIRONE_CONFIG_DOMAINS,
  SHIRONE_DOMAIN_BY_FILE,
} from '../../src/common/theme/config-domains';
import {
  buildMizukiHeadOverrideSource,
  parseMizukiHeadOverrideSource,
} from '../../src/common/theme/config-serde';

function mustGet<T>(map: ReadonlyMap<string, T>, key: string): T {
  const found = map.get(key);
  if (found === undefined) throw new Error(`missing map entry: ${key}`);
  return found;
}

function mustBuild(domain: string, values: Readonly<Record<string, unknown>>): string {
  const result = buildMizukiHeadOverrideSource(domain, values);
  if (!result.ok) throw new Error(`build failed: ${result.reason} ${result.message}`);
  return result.source;
}

function mustParse(source: string): Record<string, unknown> {
  const result = parseMizukiHeadOverrideSource(source);
  if (!result.ok) throw new Error(`parse failed: ${result.reason} ${result.message}`);
  return result.values;
}

const SITE_IMPORT = 'import type { DeepPartial, SiteConfig } from "../../types/config";';

describe('config-domains 表完整性', () => {
  it('1) Mizuki HEAD 覆盖表 18 行且 name 互不重复', () => {
    expect(MIZUKI_HEAD_OVERRIDE_DOMAINS).toHaveLength(18);
    const names = MIZUKI_HEAD_OVERRIDE_DOMAINS.map((d) => d.name);
    expect(new Set(names).size).toBe(18);
  });

  it('2) Shirone 表 32 行且 key / file 互不重复', () => {
    expect(SHIRONE_CONFIG_DOMAINS).toHaveLength(32);
    expect(new Set(SHIRONE_CONFIG_DOMAINS.map((d) => d.key)).size).toBe(32);
    expect(new Set(SHIRONE_CONFIG_DOMAINS.map((d) => d.file)).size).toBe(32);
    expect(SHIRONE_CONFIG_DOMAIN_KEYS).toEqual(SHIRONE_CONFIG_DOMAINS.map((d) => d.key));
  });

  it('3) key ≠ file 恰好 5 组，且就是那 5 组', () => {
    const mismatched = SHIRONE_CONFIG_DOMAINS.filter((d) => d.key !== d.file).map((d) => `${d.key}->${d.file}`);
    expect(mismatched).toHaveLength(5);
    expect([...mismatched].sort()).toEqual(
      [
        'expressiveCode->expressive-code',
        'postList->post-list',
        'contextMenu->context-menu',
        'imageBloom->image-bloom',
        'navBar->nav-bar',
      ].sort(),
    );
  });

  it('4) 18 行里恰好 4 行 name ≠ sourceFile（去扩展名）', () => {
    const renamed = MIZUKI_HEAD_OVERRIDE_DOMAINS.filter((d) => `${d.name}.ts` !== d.sourceFile).map(
      (d) => `${d.name}<-${d.sourceFile}`,
    );
    expect(renamed).toHaveLength(4);
    expect([...renamed].sort()).toEqual(
      [
        'fullscreenWallpaperConfig<-backgroundWallpaper.ts',
        'musicPlayerConfig<-musicConfig.ts',
        'sidebarLayoutConfig<-sidebarConfig.ts',
        'sakuraConfig<-effectsConfig.ts',
      ].sort(),
    );
  });

  it('5) markdownConfig 的类型模块是 ../../config/markdownConfig', () => {
    expect(mustGet(MIZUKI_HEAD_OVERRIDE_BY_NAME, 'markdownConfig').typeModule).toBe('../../config/markdownConfig');
    expect(mustGet(MIZUKI_HEAD_OVERRIDE_BY_NAME, 'markdownConfig').typeName).toBe('MarkdownEnhancementConfig');
  });

  it('6) 另 17 行 typeModule 一律 ../../types/config', () => {
    const others = MIZUKI_HEAD_OVERRIDE_DOMAINS.filter((d) => d.name !== 'markdownConfig');
    expect(others).toHaveLength(17);
    expect(others.every((d) => d.typeModule === '../../types/config')).toBe(true);
  });

  it('7) 反查 nav-bar → navBar；navBar 是唯一 partial === false', () => {
    expect(mustGet(SHIRONE_DOMAIN_BY_FILE, 'nav-bar').key).toBe('navBar');
    expect(SHIRONE_CONFIG_DOMAINS.filter((d) => d.partial === false).map((d) => d.key)).toEqual(['navBar']);
    expect(mustGet(SHIRONE_DOMAIN_BY_FILE, 'site').key).toBe('site');
  });

  it('7a) panelSupport：17 literal + 1 none，唯一 none 是 HEAD 的 navBarConfig', () => {
    expect(MIZUKI_HEAD_OVERRIDE_DOMAINS.filter((d) => d.panelSupport === 'none').map((d) => d.name)).toEqual([
      'navBarConfig',
    ]);
    expect(MIZUKI_HEAD_OVERRIDE_DOMAINS.filter((d) => d.panelSupport === 'literal')).toHaveLength(17);
  });

  it('7b) 回归钉：panelSupport 按「档位 × 域」持有，不得外推到 Shirone 的同名概念域', () => {
    // HEAD：links 用 TS 枚举成员 LinkPreset.Home ⇒ 面板既读不回也写不出
    expect(mustGet(MIZUKI_HEAD_OVERRIDE_BY_NAME, 'navBarConfig').panelSupport).toBe('none');
    // Shirone：links 用字符串引用 preset:"Home" / "$t:home" ⇒ 纯 YAML 可表达 ⇒ 面板可读写
    //   （上游 src/types/navBarConfig.ts:20-41 逐字：「无法用 YAML 直接表达，因此内容仓写的是
    //     这份「引用 + 字面量」的中间形态」）
    expect(mustGet(SHIRONE_DOMAIN_BY_FILE, 'nav-bar').partial).toBe(false);
    // 结构上分离：Shirone 表不携带 HEAD 的标志位，两档各持己见
    expect(Object.keys(mustGet(SHIRONE_DOMAIN_BY_FILE, 'nav-bar'))).not.toContain('panelSupport');
  });
});

describe('buildMizukiHeadOverrideSource', () => {
  it('8) siteConfig 生成物逐字包含 import type 行', () => {
    expect(mustBuild('siteConfig', { title: '我的站点' })).toContain(SITE_IMPORT);
  });

  it('9) 回归钉：navBarConfig 的 import 路径必须是 ../../types/config', () => {
    const source = mustBuild('navBarConfig', { links: [] });
    expect(source.startsWith('import type { DeepPartial, NavBarConfig } from "../../types/config";')).toBe(true);
  });

  it('10) markdownConfig 的 import 指向 ../../config/markdownConfig', () => {
    const source = mustBuild('markdownConfig', { enable: true });
    expect(source).toContain(
      'import type { DeepPartial, MarkdownEnhancementConfig } from "../../config/markdownConfig";',
    );
  });

  it('11) 未知域名 ⇒ unknown-domain（不抛错）', () => {
    const result = buildMizukiHeadOverrideSource('notAnOverride', { a: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown-domain');
      expect(result.message).toContain('notAnOverride');
    }
  });

  it('12) undefined 值的键被整键丢弃', () => {
    const source = mustBuild('siteConfig', { a: 1, b: undefined, c: null });
    expect(source).not.toContain('b:');
    expect(source).toContain('c: null');
    expect(mustParse(source)).toEqual({ a: 1, c: null });
  });

  it('13) 嵌套对象 + 数组逐字发射（2 空格缩进）', () => {
    const source = mustBuild('siteConfig', { site: { theme: { hue: 205, dark: false } }, tags: ['a', 'b'] });
    expect(source).toBe(
      `${SITE_IMPORT}\n\n` +
        'export default {\n' +
        '  site: {\n' +
        '    theme: {\n' +
        '      hue: 205,\n' +
        '      dark: false,\n' +
        '    },\n' +
        '  },\n' +
        '  tags: [\n' +
        '    "a",\n' +
        '    "b",\n' +
        '  ],\n' +
        '} satisfies DeepPartial<SiteConfig>;\n',
    );
  });

  it('14) 非标识符键加引号，标识符键不加', () => {
    const source = mustBuild('siteConfig', { 'kebab-key': 'x', ok_key: 1 });
    expect(source).toContain('"kebab-key": "x"');
    expect(source).toContain('ok_key: 1');
    expect(mustParse(source)).toEqual({ 'kebab-key': 'x', ok_key: 1 });
  });

  it('15) 字符串转义（双引号 / 换行 / 反斜杠 / 中文）往返正确', () => {
    const weird = { a: 'he said "hi"\nline\\slash 中文', b: 'tab\there' };
    const source = mustBuild('siteConfig', weird);
    expect(source).toContain('\\"hi\\"');
    expect(source).toContain('\\n');
    expect(mustParse(source)).toEqual(weird);
  });

  it('16) 非有限数字 ⇒ unsupported-value，message 含非法路径', () => {
    const nan = buildMizukiHeadOverrideSource('siteConfig', { n: Number.NaN });
    expect(nan.ok).toBe(false);
    if (!nan.ok) {
      expect(nan.reason).toBe('unsupported-value');
      expect(nan.message).toContain('$.n');
    }
    const inf = buildMizukiHeadOverrideSource('siteConfig', { nested: { m: Number.POSITIVE_INFINITY } });
    expect(inf.ok).toBe(false);
    if (!inf.ok) expect(inf.message).toContain('$.nested.m');
  });

  it('17) 生成物以 satisfies 结尾行 + 换行收尾', () => {
    const source = mustBuild('siteConfig', { title: 'x' });
    expect(source.endsWith('satisfies DeepPartial<SiteConfig>;\n')).toBe(true);
    expect(source.endsWith('\n\n')).toBe(false);
  });
});

describe('parseMizukiHeadOverrideSource', () => {
  it('18) 无 export default ⇒ no-default-export', () => {
    const result = parseMizukiHeadOverrideSource('export const config = { a: 1 };\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-default-export');
  });

  it('19) 值是标识符 ⇒ non-literal-value', () => {
    const result = parseMizukiHeadOverrideSource('export default { a: someIdentifier };\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('non-literal-value');
      expect(result.message).toContain('$.a');
    }
  });

  it('20) 值是箭头函数 ⇒ non-literal-value', () => {
    const result = parseMizukiHeadOverrideSource('export default { onClick: () => 1 };\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('non-literal-value');
  });

  it('21) 模板串带插值 ⇒ non-literal-value', () => {
    const result = parseMizukiHeadOverrideSource('export default { url: `/p/${slug}` };\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('non-literal-value');
  });

  it('22) 带 satisfies 的生成物能被解析（剥壳生效）', () => {
    const source = mustBuild('commentConfig', { enable: true, provider: 'giscus' });
    expect(source).toContain('satisfies DeepPartial<CommentConfig>;');
    expect(mustParse(source)).toEqual({ enable: true, provider: 'giscus' });
  });

  it('23) as const 包裹能被解析', () => {
    expect(mustParse('export default { a: 1, b: "x" } as const;\n')).toEqual({ a: 1, b: 'x' });
  });

  it('24) 空对象 ⇒ values 为 {}', () => {
    expect(mustParse('export default {};\n')).toEqual({});
  });

  it('25) 语法错误 ⇒ parse-error（不抛错）', () => {
    const broken = 'export default {\n  title: "x",\n';
    let result: ReturnType<typeof parseMizukiHeadOverrideSource> | undefined;
    expect(() => {
      result = parseMizukiHeadOverrideSource(broken);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.reason).toBe('parse-error');
  });

  it('26) 往返 + 幂等两条性质', () => {
    const sample: Record<string, unknown> = {
      title: '我的站点 "引号"',
      count: 42,
      ratio: -1.5,
      big: 1e21,
      enabled: true,
      disabled: false,
      nothing: null,
      nested: { deep: { list: [1, 'two', false, null] } },
      tags: ['a', 'b'],
      'kebab-key': 'quoted key',
      中文键: '值',
      emptyObject: {},
      emptyArray: [],
    };
    const source = mustBuild('profileConfig', sample);
    const parsed = mustParse(source);
    expect(parsed).toEqual(sample);
    expect(source).toContain('"kebab-key"');
    expect(mustBuild('profileConfig', parsed)).toBe(source);
    expect(mustParse(mustBuild('profileConfig', parsed))).toEqual(sample);
  });

  it('E1) 默认导出非对象字面量 ⇒ not-object-literal', () => {
    const result = parseMizukiHeadOverrideSource('export default [1, 2];\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-object-literal');
  });
});
