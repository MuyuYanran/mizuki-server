/**
 * [T3b-2c] theme-shirone-serde 单测：Shirone 侧车 `config/<file>.yaml` 的生成 / 解析 /
 * 文件名反查 / 幂等与往返性质。
 * 全程纯内存（无磁盘 IO、无临时文件），与上游 `config-overlay.mjs` 的拒绝语义逐条对齐。
 */
import { describe, expect, it } from 'vitest';
import {
  buildShironeConfigYaml,
  parseShironeConfigYaml,
  shironeDomainFileName,
  type BuildShironeResult,
  type ParseShironeResult,
} from '../../src/common/theme/shirone-config-serde';

const DOMAIN = 'navBar';
const FILE = 'nav-bar.yaml';

function mustBuild(domainKey: string, values: Readonly<Record<string, unknown>>): string {
  const result = buildShironeConfigYaml(domainKey, values);
  if (!result.ok) throw new Error(`build failed: ${result.reason} ${result.message}`);
  return result.yaml;
}

function mustParse(source: string): Record<string, unknown> {
  const result = parseShironeConfigYaml(source);
  if (!result.ok) throw new Error(`parse failed: ${result.reason} ${result.message}`);
  return result.values;
}

/** 断言生成被拒，并返回 message（供逐字核对上游措辞） */
function expectBuildRejected(values: Readonly<Record<string, unknown>>): string {
  const result: BuildShironeResult = buildShironeConfigYaml(DOMAIN, values);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.reason).toBe('unsupported-value');
  return result.message;
}

/** 断言解析被拒，并返回结果本体 */
function expectParseRejected(source: string): Extract<ParseShironeResult, { ok: false }> {
  const result = parseShironeConfigYaml(source);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  return result;
}

const TRICKY_STRINGS = [
  'yes',
  'no',
  'on',
  'null',
  '~',
  'true',
  'false',
  '123',
  '1.5',
  '0x10',
  '  前导空格',
  '尾部换行\n',
  '含 # 井号',
  '含 : 冒号后空格',
  '中文键值 —— 主题',
  '',
];

describe('[T3b-2c] shironeDomainFileName —— 由 32 行权威表反查', () => {
  it("navBar 的文件名是 nav-bar（不是 kebab 硬拼以外的任何东西）", () => {
    expect(shironeDomainFileName('navBar')).toBe('nav-bar');
  });

  it('5 组 key ≠ file 全部正确（禁按直觉推导）', () => {
    expect(shironeDomainFileName('expressiveCode')).toBe('expressive-code');
    expect(shironeDomainFileName('postList')).toBe('post-list');
    expect(shironeDomainFileName('contextMenu')).toBe('context-menu');
    expect(shironeDomainFileName('imageBloom')).toBe('image-bloom');
    expect(shironeDomainFileName('navBar')).toBe('nav-bar');
  });

  it('同名域原样返回，未知 key ⇒ null', () => {
    expect(shironeDomainFileName('site')).toBe('site');
    expect(shironeDomainFileName('nav-bar')).toBeNull();
    expect(shironeDomainFileName('')).toBeNull();
    expect(shironeDomainFileName('Site')).toBeNull();
  });
});

describe('[T3b-2c] build —— 未知域', () => {
  it('未知 domainKey ⇒ unknown-domain（含传进来的值，便于定位）', () => {
    const result = buildShironeConfigYaml('nav-bar', { a: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unknown-domain');
    expect(result.message).toContain('nav-bar');
  });
});

describe('[T3b-2c] build ↔ parse —— 往返', () => {
  it('简单映射往返相等', () => {
    const values = { title: '导航', subtitle: '副标题', count: 3, enabled: true };
    expect(mustParse(mustBuild(DOMAIN, values))).toEqual(values);
  });

  it('嵌套对象往返相等', () => {
    const values = {
      banner: { carousel: { interval: 3000, enable: false }, links: { home: '/', about: '/about' } },
    };
    expect(mustParse(mustBuild(DOMAIN, values))).toEqual(values);
  });

  it('数组（含混合类型 / 空数组 / 嵌套数组）往返相等', () => {
    const values = {
      empty: [],
      mixed: [1, 'two', true, 'x'],
      nested: [[1, 2], ['a']],
      objects: [{ url: '/', name: '首页' }, { url: '/about', name: '关于' }],
    };
    expect(mustParse(mustBuild(DOMAIN, values))).toEqual(values);
  });

  it('刁钻字符串逐字往返（不会被 YAML 隐式类型化）', () => {
    const values: Record<string, unknown> = {};
    for (const [index, text] of TRICKY_STRINGS.entries()) values[`k${index}`] = text;
    const parsed = mustParse(mustBuild(DOMAIN, values));
    expect(Object.keys(parsed)).toEqual(Object.keys(values));
    for (const [key, text] of Object.entries(values)) {
      expect(parsed[key]).toBe(text);
      expect(typeof parsed[key]).toBe('string');
    }
  });

  it('多行字符串往返相等', () => {
    const values = { note: '第一行\n第二行\n第三行', trailing: '结尾换行\n' };
    expect(mustParse(mustBuild(DOMAIN, values))).toEqual(values);
  });

  it('`$t:home` 逐字保留（i18n 标记不能被引号化或改写）', () => {
    const yaml = mustBuild(DOMAIN, { name: '$t:home', nested: { title: '$t:nav.about' } });
    expect(yaml).toContain('$t:home');
    expect(mustParse(yaml)).toEqual({ name: '$t:home', nested: { title: '$t:nav.about' } });
  });

  it('长字符串不折行（lineWidth: 0）且无锚点 / 别名', () => {
    const shared = { url: '/', name: '首页' };
    const long = 'x'.repeat(400);
    const yaml = mustBuild(DOMAIN, { long, a: shared, b: shared });
    expect(yaml.split('\n').some((line) => line.length > 300)).toBe(true);
    expect(yaml).not.toContain('&');
    expect(yaml).not.toContain('*');
    expect(mustParse(yaml)).toEqual({ long, a: shared, b: shared });
  });
});

describe('[T3b-2c] build —— 生成前校验（镜像上游 assertSerializable）', () => {
  it('null ⇒ 拒绝，message 含上游原句', () => {
    const message = expectBuildRejected({ title: null });
    expect(message).toContain(
      'Keys without values in YAML parse to null; use "" to clear text, or [] to clear lists.',
    );
    expect(message).toContain('$.title');
    expect(message).toContain(FILE);
  });

  it('顶层 null 与嵌套 null 都被拒（路径分别落在根与叶子）', () => {
    expect(expectBuildRejected({ profile: { name: null } })).toContain('$.profile.name');
    expect(expectBuildRejected({ list: [null] })).toContain('$.list[0]');
  });

  it('NaN / Infinity / -Infinity ⇒ 拒绝', () => {
    expect(expectBuildRejected({ a: Number.NaN })).toContain('is not a finite number.');
    expect(expectBuildRejected({ a: Number.POSITIVE_INFINITY })).toContain('$.a');
    expect(expectBuildRejected({ a: [1, Number.NEGATIVE_INFINITY] })).toContain('$.a[1]');
  });

  it('函数 / bigint / symbol / undefined ⇒ 拒绝（按上游类型措辞）', () => {
    expect(expectBuildRejected({ fn: () => 1 })).toContain(
      'is of type function which cannot be represented as configuration.',
    );
    expect(expectBuildRejected({ big: BigInt(1) })).toContain('is of type bigint');
    expect(expectBuildRejected({ sym: Symbol('s') })).toContain('is of type symbol');
    expect(expectBuildRejected({ missing: undefined })).toContain('is of type undefined');
  });

  it('Date / Map / Set ⇒ 拒绝（非 plain object，按上游 toString 措辞）', () => {
    expect(expectBuildRejected({ when: new Date(0) })).toContain('[object Date]');
    expect(expectBuildRejected({ m: new Map() })).toContain('[object Map]');
    expectBuildRejected({ s: new Set() });
  });

  it('循环引用对象 ⇒ 拒绝且不死循环', () => {
    const node: Record<string, unknown> = { name: 'x' };
    node['self'] = node;
    const message = expectBuildRejected({ a: node });
    expect(message).toContain('forms a circular reference (YAML anchor points to itself).');
  });

  it('同一对象被两个键共享**不算**循环（seen 离开即删）', () => {
    const shared = { url: '/' };
    expect(mustParse(mustBuild(DOMAIN, { a: shared, b: shared }))).toEqual({ a: shared, b: shared });
  });
});

describe('[T3b-2c] parse —— 空 / 垃圾 / 形状', () => {
  it('空串 / 纯空白 / 纯注释 ⇒ {ok:true, values:{}}', () => {
    expect(mustParse('')).toEqual({});
    expect(mustParse('   \n\t\n')).toEqual({});
    expect(mustParse('# 只有注释\n# 再来一行\n')).toEqual({});
    expect(mustParse('---\n')).toEqual({});
  });

  it('空映射也视作无覆盖 ⇒ {ok:true, values:{}}', () => {
    expect(mustParse('{}\n')).toEqual({});
    expect(mustParse('---\n{}\n')).toEqual({});
  });

  it('YAML 语法错 ⇒ invalid-yaml，且不抛错', () => {
    const result = expectParseRejected('a: [1, 2\nb: {');
    expect(result.reason).toBe('invalid-yaml');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('顶层数组 / 顶层标量 ⇒ not-mapping', () => {
    expect(expectParseRejected('- a\n- b\n').reason).toBe('not-mapping');
    expect(expectParseRejected('just a string\n').reason).toBe('not-mapping');
    expect(expectParseRejected('42\n').reason).toBe('not-mapping');
    expect(expectParseRejected('true\n').reason).toBe('not-mapping');
  });

  it('YAML 锚点自指（a: &x {b: *x}）⇒ 被拦，不栈溢出', () => {
    const result = parseShironeConfigYaml('a: &x\n  b: *x\n');
    expect(result.ok).toBe(false);
  });

  it('值里出现 null ⇒ null-value，message 含上游原句与键路径', () => {
    const result = expectParseRejected('banner:\n  title:\n  count: 1\n');
    expect(result.reason).toBe('null-value');
    expect(result.message).toContain('$.banner.title');
    expect(result.message).toContain('Keys without values in YAML parse to null;');
  });

  it('值里出现 .nan / .inf ⇒ non-finite-number', () => {
    expect(expectParseRejected('a: .nan\n').reason).toBe('non-finite-number');
    expect(expectParseRejected('a: .inf\n').reason).toBe('non-finite-number');
  });

  it('解析出的畸形类型（Date / Uint8Array / Map）⇒ non-serializable', () => {
    expect(expectParseRejected('a: !!timestamp 2026-10-29\n').reason).toBe('non-serializable');
    expect(expectParseRejected('a: !!binary "aGk="\n').reason).toBe('non-serializable');
    expect(expectParseRejected('a: !!omap [{x: 1}]\n').reason).toBe('non-serializable');
    // YAML 1.2 core 不把裸时间戳解析成 Date（上游同为 yaml 2）⇒ 它就是普通字符串，应当放行
    expect(mustParse('a: 2026-10-29T20:00:00Z\n')).toEqual({ a: '2026-10-29T20:00:00Z' });
  });

  it('`$t:home` 逐字保留（解析端不改写）', () => {
    expect(mustParse('name: $t:home\nnested:\n  title: $t:nav.about\n')).toEqual({
      name: '$t:home',
      nested: { title: '$t:nav.about' },
    });
  });

  it('一组垃圾输入逐个调用均不抛错', () => {
    const garbage = [
      '\t- [',
      '{{{{',
      'a: *missing-anchor',
      ':',
      'a:\n  - b\n c: d',
      '\u0000',
      '&a [*a]',
      '"unterminated',
      'a: !!unknown-tag x',
      '<<: *nope',
    ];
    for (const source of garbage) {
      const result = parseShironeConfigYaml(source);
      expect(typeof result.ok).toBe('boolean');
    }
  });
});

describe('[T3b-2c] 性质 —— 幂等与往返', () => {
  const samples: readonly Readonly<Record<string, unknown>>[] = [
    { title: '首页', url: '/' },
    { nested: { deep: { deeper: [1, 2.5, '三', false] } } },
    { tricky: TRICKY_STRINGS },
    { empty: {}, list: [], mixed: ['$t:home'] },
  ];

  it('往返：parse(build(x).yaml) 与 x 深等', () => {
    for (const sample of samples) {
      expect(mustParse(mustBuild(DOMAIN, sample))).toEqual(sample);
    }
  });

  it('幂等：build(parse(build(x).yaml)).yaml === build(x).yaml', () => {
    for (const sample of samples) {
      const first = mustBuild(DOMAIN, sample);
      const second = mustBuild(DOMAIN, mustParse(first));
      expect(second).toBe(first);
    }
  });

  it('确定性：同输入连跑两次逐字节相同', () => {
    const values = { b: '2', a: '1', c: { y: 'y', x: 'x' } };
    expect(mustBuild(DOMAIN, values)).toBe(mustBuild(DOMAIN, values));
  });
});
