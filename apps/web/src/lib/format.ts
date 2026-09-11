/**
 * [重构/Wave-4] lib/format — 展示层格式化单源
 * [职责] 把散落在各页面的格式化函数收敛到一处（原重复：formatTime 4 处、
 *   formatSize 2 处、日期选择器空值归并 3 处）。
 * [状态] ACTIVE
 *
 * 为什么单源：这些函数的输出直接构成用户可见文本，多份实现会导致同一数据在
 * 不同页面显示成不同形态（如体积单位精度不一致），且修一处漏一处。
 */

/** ISO 时间串 → 本地化展示（zh-CN 习惯格式） */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

/**
 * 字节数 → 人类可读体积（B / KB / MB，保留 1 位小数）。
 * @see 上限只到 MB：当前配置下（上传上限 10MB、备份为本地目录）不会出现 GB 级单文件
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Element Plus 日期选择器回调值 → 空串归并。
 * 选择器在「清空」时给出非字符串值（null/undefined），存储层需空串而非 null。
 */
export function dateOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
