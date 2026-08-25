/**
 * [阶段 P3] data-files/serializer — JS 值 → TS 字面量文本
 * [职责] JSON 即合法 TS 字面量，直接序列化 + 纯美化去键引号
 *   （MASTER-PLAN §6.3 逐字实现）。
 * [状态] ACTIVE
 */

/**
 * JS 值 → TS 字面量文本。
 * JSON.stringify 双引号字符串天然合法；正则仅做纯美化——把
 * `"key":` 形式的键引号去掉（标识符安全的键），值中的引号不受影响。
 */
export function valueToTsLiteral(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  return json.replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:');
}
