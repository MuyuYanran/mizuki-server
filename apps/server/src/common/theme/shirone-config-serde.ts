/**
 * [T3b-2c] common/theme/shirone-config-serde — Shirone 上游内容仓 `config/<file>.yaml` 的
 *   **生成**与**解析**（L0 单源，纯函数，零磁盘 IO）
 * [状态] ACTIVE
 * [职责] `config/<file>.yaml` 全文 ⟷ 值对象：
 *   - `buildShironeConfigYaml(domainKey, values)` → YAML 全文（确定性，同输入同输出）；
 *   - `parseShironeConfigYaml(source)` → 读回该域的覆盖值（供 GET 用）；
 *   - `shironeDomainFileName(domainKey)` → 文件基名反查（**由 32 行表派生，禁硬拼 kebab-case**）。
 * [上游依据] `.test-tmp/upstream-Shirone-20261029/scripts/content/config-overlay.mjs`
 *   `:26` `import { parse as parseYaml } from "yaml"`（同库同大版本，本仓 `yaml@2.9.1`）
 *   `:170-215` `readConfigOverrides()`（按文件名反查域名 / `.yaml` 与 `.yml` 都认 /
 *     空文件 ⇒ 视作「没有覆盖」而不是错误 / 顶层必须是 key-value mapping）
 *   `:122-160` `assertSerializable()`（本文件逐条镜像其拒绝语义与措辞，便于用户对照上游报错）
 * [⚠ 与 Mizuki HEAD 档（config-serde.ts）规则相反之处]
 *   Shirone 上游 `assertSerializable` **拒绝 `null`**（`:128-133`：漏填的键解析成 null，
 *   深合并会把该键抹掉 ⇒ 视为事故；上游要求写 `""` 清文本、写 `[]` 清列表）；
 *   而 HEAD 档的合并语义**允许 `null` 整体替换**（`config-serde.ts` 的 `emitValue` 直接发射 `null`）。
 *   ⇒ **两档不得统一**：两个 serde 各自只依赖 `config-domains.ts`，
 *   **本文件禁止 import `config-serde.ts`**（规则相反，合并会写坏一侧的文件）。
 * [发射即用同一个 yaml 包] `stringify`：禁锚点/别名（`aliasDuplicateObjects: false`）、
 *   禁折行（`lineWidth: 0`，便于 diff 与幂等）、键序 = 输入键序。
 * [本文件不写盘] 生成只返回字符串，落盘由调用方走既有原子写管线（仓规 §4.1）。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { SHIRONE_CONFIG_DOMAINS, type ShironeConfigDomain } from './config-domains';

/** 生成结果：成功给 YAML 全文，失败给可判定的原因（不抛错） */
export type BuildShironeResult =
  | { ok: true; yaml: string }
  | { ok: false; reason: 'unknown-domain' | 'unsupported-value'; message: string };

/** 解析结果：成功给值对象，失败给可判定的原因（不抛错） */
export type ParseShironeResult =
  | { ok: true; values: Record<string, unknown> }
  | {
      ok: false;
      reason: 'invalid-yaml' | 'not-mapping' | 'null-value' | 'non-finite-number' | 'non-serializable';
      message: string;
    };

/** 域 key 的反查表 —— 从**同一张 32 行权威表**派生，不另立第二份名单 */
const DOMAIN_BY_KEY: ReadonlyMap<string, ShironeConfigDomain> = new Map(
  SHIRONE_CONFIG_DOMAINS.map((domain) => [domain.key, domain]),
);

/** 值路径根：与上游 `assertSerializable(value, "", …)` 的定位口径对齐（上游为空串，此处带 `$` 便于阅读） */
const ROOT_PATH = '$';

/** 解析端没有文件名可报（契约只收 source）⇒ 用中性主语，句子结构仍与上游一致 */
const PARSE_SUBJECT = 'YAML document';

function fail(reason: ValueProblemKind, message: string): ValueProblem {
  return { reason, message };
}

type ValueProblemKind = 'null-value' | 'non-finite-number' | 'non-serializable';

interface ValueProblem {
  readonly reason: ValueProblemKind;
  readonly message: string;
}

/** 与上游 `isPlainObject` 等价：数组、Date、Map、Set、类实例一律不算 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function childPath(parent: string, key: string): string {
  return `${parent}.${key}`;
}

/**
 * 递归校验一个值是否只含 JSON 可表达的类型 —— 逐条镜像上游 `assertSerializable`。
 * `seen` 进对象时加、离开时删 ⇒ **只拦真正的循环引用**（同一对象被两个键共享不算）。
 * 任何违规都在**进入下一层之前**返回，因此循环输入不会无限递归。
 */
function inspectValue(
  value: unknown,
  path: string,
  subject: string,
  seen: Set<object>,
): ValueProblem | null {
  if (value === null) {
    return fail(
      'null-value',
      `${subject}'s ${path} is null.` +
        ' Keys without values in YAML parse to null; use "" to clear text, or [] to clear lists.',
    );
  }
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') {
    if (kind === 'number' && !Number.isFinite(value)) {
      return fail('non-finite-number', `${subject}'s ${path} is not a finite number.`);
    }
    return null;
  }
  if (kind !== 'object') {
    return fail(
      'non-serializable',
      `${subject}'s ${path} is of type ${kind} which cannot be represented as configuration.`,
    );
  }

  const node = value as object;
  if (seen.has(node)) {
    return fail(
      'non-serializable',
      `${subject}'s ${path} forms a circular reference (YAML anchor points to itself).`,
    );
  }
  seen.add(node);
  try {
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) {
        const problem = inspectValue(node[index], `${path}[${index}]`, subject, seen);
        if (problem) return problem;
      }
      return null;
    }
    if (isPlainObject(node)) {
      for (const [key, item] of Object.entries(node)) {
        const problem = inspectValue(item, childPath(path, key), subject, seen);
        if (problem) return problem;
      }
      return null;
    }
    return fail(
      'non-serializable',
      `${subject}'s ${path} is ${Object.prototype.toString.call(node)}, ` +
        'configuration only accepts strings, numbers, booleans, arrays, and mappings.',
    );
  } finally {
    seen.delete(node);
  }
}

/** 领域 key → 内容仓文件基名（由 32 行表反查；未知 key ⇒ null。**禁止**接收调用方传入文件名） */
export function shironeDomainFileName(domainKey: string): string | null {
  return DOMAIN_BY_KEY.get(domainKey)?.file ?? null;
}

/**
 * 生成内容仓 `config/<file>.yaml` 的全文。`domainKey` 是领域 key（如 `'navBar'`），**不是**文件名。
 * 生成前先跑一遍与上游 `assertSerializable` 等价的校验：任何违规 ⇒ `unsupported-value`，
 * **绝不产出上游会拒绝的文件**。结尾带换行；键序 = 输入键序。
 */
export function buildShironeConfigYaml(
  domainKey: string,
  values: Readonly<Record<string, unknown>>,
): BuildShironeResult {
  const domain = DOMAIN_BY_KEY.get(domainKey);
  if (!domain) {
    return { ok: false, reason: 'unknown-domain', message: `unknown config domain: ${domainKey}` };
  }
  const problem = inspectValue(values, ROOT_PATH, `${domain.file}.yaml`, new Set());
  if (problem) {
    return { ok: false, reason: 'unsupported-value', message: problem.message };
  }
  const yaml = stringifyYaml(values, {
    // 禁锚点/别名：同一对象被两个键共享时也逐份展开，输出才与「值」一一对应
    aliasDuplicateObjects: false,
    // 0 = 不折行：长字符串不被切碎，diff 稳定、幂等可钉
    lineWidth: 0,
  });
  return { ok: true, yaml };
}

/**
 * 解析内容仓 `config/<file>.yaml` 的全文。
 * 空文件 / 只有注释 / 只有空白 ⇒ `{ok:true, values:{}}`（上游口径：视作无覆盖，不是错误）。
 * 顶层非 plain object ⇒ `not-mapping`。**任何异常都被捕获转成返回值，绝不抛错。**
 */
export function parseShironeConfigYaml(source: string): ParseShironeResult {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-yaml',
      message: `not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // 上游 `:210-212`：空文件解析成 undefined/null，视作「没有覆盖」而不是错误
  if (document === null || document === undefined) return { ok: true, values: {} };
  if (!isPlainObject(document)) {
    return { ok: false, reason: 'not-mapping', message: 'Top level must be a key-value mapping.' };
  }
  // 上游 `:217`：空映射与空文件一样跳过
  if (Object.keys(document).length === 0) return { ok: true, values: {} };

  const problem = inspectValue(document, ROOT_PATH, PARSE_SUBJECT, new Set());
  if (problem) return { ok: false, reason: problem.reason, message: problem.message };
  return { ok: true, values: document };
}
