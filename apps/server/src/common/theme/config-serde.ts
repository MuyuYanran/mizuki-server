/**
 * [T4] common/theme/config-serde — Mizuki HEAD 覆盖模块的**生成**与**解析**（L0 单源，纯函数，零磁盘 IO）
 * [职责] `src/config/overrides/<name>.ts` 的文本 ⟷ 值对象：
 *   - `buildMizukiHeadOverrideSource(name, values)` → 覆盖模块源码（确定性，同输入同输出）；
 *   - `parseMizukiHeadOverrideSource(source)` → 读回当前覆盖值（供 GET 用）。
 * [为什么不用 JSON/YAML] 上游覆盖文件是**带类型标注的 TS 模块**，类型标注让拼错的键变成编译错误
 *   （`overrideLoader.ts` 直接 import 它）⇒ 文本形态必须是 TS，且必须能被 `tsc` 接受。
 * [拒绝语义，对齐上游]
 *   - 未知覆盖名 ⇒ `unknown-domain`（**不抛错**）。上游 `overrideLoader.ts:50-58` 对未知覆盖名
 *     构建期 `throw` ⇒ 写进去等于弄坏用户的构建，因此生成端必须更早拒绝；
 *   - 解析端没有 `export default` ⇒ `no-default-export`（上游同款硬要求）。
 * [本文件不写盘] 生成只返回字符串，落盘由调用方走既有原子写管线（仓规 §4.1）；
 *   解析用 ts-morph **内存文件系统**（`useInMemoryFileSystem: true`），不在 cwd 落任何临时文件。
 * [状态] ACTIVE
 */
import { Node, Project, SyntaxKind, ts, type Expression, type ObjectLiteralExpression } from 'ts-morph';
import { MIZUKI_HEAD_OVERRIDE_BY_NAME } from './config-domains';

/** 生成结果：成功给源码，失败给可判定的原因（不抛错） */
export type BuildHeadOverrideResult =
  | { ok: true; source: string }
  | { ok: false; reason: 'unknown-domain' | 'unsupported-value'; message: string };

/** 解析结果：成功给值对象，失败给可判定的原因（不抛错） */
export type ParseHeadOverrideResult =
  | { ok: true; values: Record<string, unknown> }
  | {
      ok: false;
      reason: 'parse-error' | 'no-default-export' | 'not-object-literal' | 'non-literal-value';
      message: string;
    };

/** 合法标识符键：不加引号；其余键一律 `JSON.stringify` 加引号 */
const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 先发行的负数字面量文本（`String(-1.5)` ⇒ `-1.5`）；其余一元表达式（`-x` / `+1` / `!a`）一律拒绝 */
const NEGATIVE_NUMBER_TEXT = /^-\d[\d_]*(\.\d+)?([eE][+-]?\d+)?$/;

const INDENT_UNIT = '  ';

/** 值路径根：错误信息里用它定位（`$` / `$.nested[0]` / `$["kebab-key"]`） */
const ROOT_PATH = '$';

function indent(level: number): string {
  return INDENT_UNIT.repeat(level);
}

/** 键名文本：标识符原样，其余加引号 */
function emitKeyText(key: string): string {
  return IDENTIFIER_KEY.test(key) ? key : JSON.stringify(key);
}

function childPath(parent: string, key: string): string {
  return IDENTIFIER_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

type EmitResult = { ok: true; text: string } | { ok: false; path: string };

/**
 * 发射一个字面量。`level` = 该值**自身收尾花括号/方括号所在缩进级别**
 * （顶层对象为 0，其成员为 1，以此类推）。
 */
function emitValue(value: unknown, level: number, path: string): EmitResult {
  if (value === null) return { ok: true, text: 'null' };
  switch (typeof value) {
    case 'string':
      // JSON 转义串在 TS 里逐字合法（引号 / 换行 / 反斜杠 / 中文都覆盖）
      return { ok: true, text: JSON.stringify(value) };
    case 'number':
      // NaN / Infinity 无 TS 字面量形态，发射出来必然不可编译
      // 整数走 BigInt 十进制展开：否则 1e21 这类值被 String() 写成指数形态，
      // 数字字面量的指数 token 在往返上留歧义（`1e+21` 的解析结果视解析器而定）。
      if (!Number.isFinite(value)) return { ok: false, path };
      return { ok: true, text: Number.isInteger(value) ? String(BigInt(value)) : String(value) };
    case 'boolean':
      return { ok: true, text: value ? 'true' : 'false' };
    case 'object':
      return Array.isArray(value)
        ? emitArray(value, level, path)
        : emitObject(value as Record<string, unknown>, level, path);
    default:
      // undefined（数组元素）/ bigint / function / symbol
      return { ok: false, path };
  }
}

function emitArray(items: readonly unknown[], level: number, path: string): EmitResult {
  if (items.length === 0) return { ok: true, text: '[]' };
  const inner = level + 1;
  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const emitted = emitValue(items[i], inner, `${path}[${i}]`);
    if (!emitted.ok) return emitted;
    lines.push(`${indent(inner)}${emitted.text},`);
  }
  return { ok: true, text: `[\n${lines.join('\n')}\n${indent(level)}]` };
}

/** 普通对象：`undefined` 值的键**整键丢弃**（上游 deepMerge 对显式 undefined 是跳过，写它无意义且破坏幂等） */
function emitObject(record: Readonly<Record<string, unknown>>, level: number, path: string): EmitResult {
  const inner = level + 1;
  const lines: string[] = [];
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === undefined) continue;
    const emitted = emitValue(value, inner, childPath(path, key));
    if (!emitted.ok) return emitted;
    lines.push(`${indent(inner)}${emitKeyText(key)}: ${emitted.text},`);
  }
  if (lines.length === 0) return { ok: true, text: '{}' };
  return { ok: true, text: `{\n${lines.join('\n')}\n${indent(level)}}` };
}

/**
 * 生成 Mizuki HEAD 覆盖模块源码（确定性；结尾带换行）。
 * `values` 的键序即输出键序，同一输入必然同一输出 ⇒ 可做幂等回归钉。
 */
export function buildMizukiHeadOverrideSource(
  domain: string,
  values: Readonly<Record<string, unknown>>,
): BuildHeadOverrideResult {
  const target = MIZUKI_HEAD_OVERRIDE_BY_NAME.get(domain);
  if (!target) {
    return { ok: false, reason: 'unknown-domain', message: `unknown override domain: ${domain}` };
  }
  const body = emitObject(values, 0, ROOT_PATH);
  if (!body.ok) {
    return {
      ok: false,
      reason: 'unsupported-value',
      message: `unsupported value at "${body.path}": only strings, finite numbers, booleans, null, arrays and plain objects can be emitted`,
    };
  }
  const source =
    `import type { DeepPartial, ${target.typeName} } from "${target.typeModule}";\n` +
    `\nexport default ${body.text} satisfies DeepPartial<${target.typeName}>;\n`;
  return { ok: true, source };
}

/** 语法诊断（只做语法，不做类型检查：`../../types/config` 解析不到不算语法错） */
function syntacticDiagnostics(source: string): readonly ts.Diagnostic[] {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  return result.diagnostics ?? [];
}

/** 剥壳：`satisfies` / `as` / 括号（我们的生成物带 `satisfies`，`as const` 也要能读回） */
function unwrapExpression(expression: Expression): Expression {
  if (Node.isSatisfiesExpression(expression)) return unwrapExpression(expression.getExpression());
  if (Node.isAsExpression(expression)) return unwrapExpression(expression.getExpression());
  if (Node.isParenthesizedExpression(expression)) return unwrapExpression(expression.getExpression());
  return expression;
}

type LiteralResult = { ok: true; value: unknown } | { ok: false; path: string };

/**
 * 字面量求值：只认字面量。标识符（含 `NaN` / `Infinity`）、模板串、箭头函数、调用表达式、展开元素
 * 一律 `non-literal-value` —— **不猜测、不求值**，只报路径。
 */
function evalLiteral(node: Node, path: string): LiteralResult {
  if (Node.isStringLiteral(node)) return { ok: true, value: node.getLiteralValue() };
  // 数字按 token 文本自行求值：`0x10` / `1_000` / 1e21 都要读回同一个数
  if (Node.isNumericLiteral(node)) return { ok: true, value: Number(node.getText().replace(/_/g, '')) };
  if (Node.isArrayLiteralExpression(node)) {
    const items: unknown[] = [];
    const elements = node.getElements();
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (!element) return { ok: false, path: `${path}[${i}]` };
      const evaluated = evalLiteral(element, `${path}[${i}]`);
      if (!evaluated.ok) return evaluated;
      items.push(evaluated.value);
    }
    return { ok: true, value: items };
  }
  if (Node.isObjectLiteralExpression(node)) return evalObjectLiteral(node, path);

  const kind = node.getKind();
  if (kind === SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (kind === SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (kind === SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (kind === SyntaxKind.PrefixUnaryExpression) {
    // 负数：发射端 `String(-1)` ⇒ `-1`，读不回就让往返性质在负数上断掉
    const text = node.getText();
    return NEGATIVE_NUMBER_TEXT.test(text)
      ? { ok: true, value: Number(text.replace(/_/g, '')) }
      : { ok: false, path };
  }
  return { ok: false, path };
}

function evalObjectLiteral(node: ObjectLiteralExpression, path: string): LiteralResult {
  const values: Record<string, unknown> = {};
  for (const property of node.getProperties()) {
    // 展开元素 / 简写 / 方法 / getter / setter 一律拒绝
    if (!Node.isPropertyAssignment(property)) return { ok: false, path };
    const nameNode = property.getNameNode();
    let key: string;
    if (Node.isStringLiteral(nameNode)) key = nameNode.getLiteralValue();
    else if (Node.isIdentifier(nameNode) || Node.isNumericLiteral(nameNode)) key = nameNode.getText();
    else return { ok: false, path }; // 计算属性名
    const evaluated = evalLiteral(property.getInitializer() ?? property, childPath(path, key));
    if (!evaluated.ok) return evaluated;
    values[key] = evaluated.value;
  }
  return { ok: true, value: values };
}

/**
 * 解析覆盖模块源码（**内存文件系统**，不碰磁盘）。语法错 / 无默认导出 / 非对象字面量 /
 * 非字面量值都返回可判定原因，绝不抛错。
 */
export function parseMizukiHeadOverrideSource(source: string): ParseHeadOverrideResult {
  const diagnostics = syntacticDiagnostics(source);
  const firstDiagnostic = diagnostics[0];
  if (firstDiagnostic) {
    const text = ts.flattenDiagnosticMessageText(firstDiagnostic.messageText, ' ');
    const line = firstDiagnostic.start === undefined ? null : source.slice(0, firstDiagnostic.start).split('\n').length;
    return { ok: false, reason: 'parse-error', message: line === null ? text : `${text} (line ${line})` };
  }

  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { noEmit: true },
    });
    const file = project.createSourceFile('head-override.ts', source);
    let expression: Expression | null = null;
    for (const statement of file.getStatements()) {
      // `export =` 不算默认导出
      if (Node.isExportAssignment(statement) && !statement.isExportEquals()) {
        expression = unwrapExpression(statement.getExpression());
        break;
      }
    }
    if (expression === null) {
      return { ok: false, reason: 'no-default-export', message: 'override module has no `export default`' };
    }
    if (!Node.isObjectLiteralExpression(expression)) {
      return {
        ok: false,
        reason: 'not-object-literal',
        message: '`export default` must be an object literal',
      };
    }
    const evaluated = evalObjectLiteral(expression, ROOT_PATH);
    if (!evaluated.ok) {
      return {
        ok: false,
        reason: 'non-literal-value',
        message: `non-literal value at "${evaluated.path}": only literal values can be read back`,
      };
    }
    return { ok: true, values: evaluated.value as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      reason: 'parse-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
