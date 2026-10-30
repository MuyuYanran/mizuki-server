/**
 * [U4-AI3/B] shared/ai-meta — `meta` 动作的**结构化契约**与非破坏性回填计划
 *
 * [职责] 把模型输出的「三行文本」解析为结构化字段，并**在回填前**算出一份
 *   「哪些字段可以填、哪些会覆盖用户已写内容」的计划，供界面展示差异与征求确认。
 *
 * [为什么解析器放 L0 而不是服务端]
 *   `meta` 走的是**流式**通道（与其他动作同一条 SSE），文本在浏览器里逐帧累积。
 *   若解析只在服务端做，就得为它单开一条非流式端点 —— 那会同时带来
 *   「同一动作两套实现」与「前端还得再拼一次」两个问题。
 *   放 L0 则两端共用同一份解析与同一份回填规则，且**可被单测直接覆盖**。
 *
 * [核心铁律：绝不静默覆盖用户已写内容]
 *   这是本文件存在的首要理由。用户可能已经手写了标题、摘要与标签，
 *   此时「一键生成」若直接写入就是**摧毁用户劳动**。
 *   ⇒ `planMetaBackfill()` 只产出**计划**，每个字段带明确动作：
 *     - `fill`     ：当前为空 ⇒ 可安全填入；
 *     - `conflict` ：当前非空且与新值不同 ⇒ **必须由用户确认**；
 *     - `same`     ：当前非空且与新值相同 ⇒ 无需动作（展示为「已一致」）。
 *   把这个判定做成纯函数，才能用单测把「不许静默覆盖」钉死 ——
 *   它不依赖界面，也就不可能被界面改坏。
 *
 * [解析的容错立场]
 *   模型输出**不是**可靠的结构化数据。上游可能出现：行首加「第一行：」标签、
 *   用 Markdown 粗体包裹、多出空行、少给标签行。解析器一律**尽力而为**，
 *   且在**完全解析不出**时返回全 null（而不是抛错）——
 *   调用方据此提示「未能识别，请重试」，而不是把整段原文塞进标题。
 *
 * 纪律：本文件只放纯函数与类型，不引入任何 IO。
 */

/** 解析结果：三个字段各自可空（解析不出即 null，不猜） */
export interface ParsedMeta {
  title: string | null;
  summary: string | null;
  tags: string[];
}

/** 回填动作（见文件头「核心铁律」） */
export type MetaFieldAction = 'fill' | 'conflict' | 'same' | 'empty';

/** 单个字段的回填计划 */
export interface MetaFieldPlan {
  action: MetaFieldAction;
  /** 当前表单里的值（用于展示差异） */
  current: string;
  /** 建议填入的值（`empty` 时为 ''） */
  next: string;
}

/** 回填计划（标题 / 摘要 / 标签三项；标签按整体比较） */
export interface MetaBackfillPlan {
  title: MetaFieldPlan;
  summary: MetaFieldPlan;
  tags: MetaFieldPlan;
  /** 是否存在需要用户确认的覆盖（界面据此决定是否弹确认框） */
  hasConflicts: boolean;
  /** 是否有任何可填入项（全无则界面提示「没有可回填的内容」） */
  hasChanges: boolean;
}

/** 去掉 Markdown 包裹与行首标签，得到裸值 */
function stripDecoration(raw: string): string {
  let value = raw.trim();
  // 行首标签：`第一行：` / `标题:` / `Title:` / `摘要：` / `标签:` / `Tags:` 等
  value = value.replace(
    /^\s*(第[一二三]行|标题|title|摘要|summary|tags?|标签)\s*[:：]\s*/i,
    '',
  );
  // Markdown 强调包裹：**x** / *x* / `x` / __x__
  value = value.replace(/^\s*(\*\*|__|\*|`)([\s\S]*?)(\1)\s*$/, '$2');
  // 去掉行首的列表符号（- / * / 数字.)，模型常自行加
  value = value.replace(/^\s*([-*+]|\d+[.、)])\s*/, '');
  return value.trim();
}

/** 把一行按中英文逗号/顿号切成标签，去掉空项与重复（保序） */
export function splitTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of stripDecoration(raw).split(/[,，、;；]/)) {
    const tag = stripDecoration(piece);
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * 解析 `meta` 动作的输出（三行：标题 / 摘要 / 标签）。
 *
 * 容错策略（逐条对应文件头「解析的容错立场」）：
 *   - 忽略空行；
 *   - 每行的行首标签、Markdown 包裹、列表符号一律剥掉；
 *   - 只取**前三行非空内容**；不足三行时缺的字段为 null/[]；
 *   - 标签行按逗号类分隔符切分并去重；
 *   - 完全无内容 ⇒ 全 null（调用方据此提示重试）。
 *
 * ⚠ 不做「按关键词猜哪行是标题」这类花活：模型的标签行不一定可靠，
 *   但**行序是提示词明确要求的**（第一行标题、第二行摘要、第三行标签）。
 *   按序取比按内容猜更稳，也比按内容猜更好解释。
 */
export function parseMetaOutput(text: string): ParsedMeta {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const title = lines[0] !== undefined ? stripDecoration(lines[0]) : '';
  const summary = lines[1] !== undefined ? stripDecoration(lines[1]) : '';
  const tags = lines[2] !== undefined ? splitTags(lines[2]) : [];

  return {
    title: title === '' ? null : title,
    summary: summary === '' ? null : summary,
    tags,
  };
}

/** 单字段计划：按「当前值 × 新值」四态判定 */
function planField(current: string, next: string | null): MetaFieldPlan {
  const currentTrimmed = current.trim();
  const nextValue = next ?? '';
  if (nextValue === '') {
    // 没有建议值：不动现有内容（`empty` 表示「本次没有该字段的建议」）
    return { action: 'empty', current: currentTrimmed, next: '' };
  }
  if (currentTrimmed === '') {
    return { action: 'fill', current: '', next: nextValue };
  }
  if (currentTrimmed === nextValue.trim()) {
    return { action: 'same', current: currentTrimmed, next: nextValue };
  }
  return { action: 'conflict', current: currentTrimmed, next: nextValue };
}

/**
 * 生成回填计划。**只算不写** —— 界面必须先把 `conflict` 展示给用户确认，
 * 用户勾选后才把对应字段写进表单状态。
 *
 * @param parsed     `parseMetaOutput()` 的结果
 * @param current    当前表单值（标题 / 摘要 / 标签）
 */
export function planMetaBackfill(
  parsed: ParsedMeta,
  current: { title: string; summary: string; tags: string[] },
): MetaBackfillPlan {
  const title = planField(current.title, parsed.title);
  const summary = planField(current.summary, parsed.summary);
  const tags = planField(current.tags.join(','), parsed.tags.length > 0 ? parsed.tags.join(',') : null);

  return {
    title,
    summary,
    tags,
    hasConflicts: [title, summary, tags].some((field) => field.action === 'conflict'),
    hasChanges: [title, summary, tags].some((field) => field.action === 'fill'),
  };
}

/**
 * 把 `meta` 结果渲染成可读文本（聊天栏展示用）。
 * 与解析器互逆：解析器把文本变结构，本函数把结构变文本。
 */
export function formatParsedMeta(parsed: ParsedMeta): string {
  const parts: string[] = [];
  if (parsed.title !== null) parts.push(`标题：${parsed.title}`);
  if (parsed.summary !== null) parts.push(`摘要：${parsed.summary}`);
  if (parsed.tags.length > 0) parts.push(`标签：${parsed.tags.join('、')}`);
  return parts.join('\n');
}
