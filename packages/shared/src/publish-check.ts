/**
 * [U4-AI3/B] shared/publish-check — 发布前检查清单（纯函数，两端共用）
 *
 * [职责] 在用户点「发布」之前，把「这篇文章还缺什么」一次性列清楚。
 *
 * [为什么是纯函数放 L0]
 *   检查规则需要被两处消费：编辑器页展示清单、将来可能的服务端预校验。
 *   更重要的是：**规则必须可被单测穷举**。「什么算可以发布」是业务判定，
 *   写在组件里就只能靠手点验证，规则一多必然漏。
 *
 * [为什么检查项要按主题能力分化]
 *   Shirone 的 `postsCollection` 里 `published: z.date()` 是**必填** —— 缺它的文章
 *   在上游构建期就是坏的。Mizuki 档则允许缺 `published`（可作草稿）。
 *   若清单写死一套规则，就会出现「Mizuki 下报缺失、Shirone 下漏报」这类偏差。
 *   ⇒ 检查项按**能力面**参数化（`extensions` 判扩展名、`requirePublished` 判必填），
 *     而不是按档位名写死。
 *
 * [分级：error 阻止发布，warning 只提示]
 *   `error` 是「发出去就是坏的」（缺标题、Shirone 缺 published）；
 *   `warning` 是「能发但不理想」（缺摘要、缺标签、正文过短）。
 *   把 warning 也做成阻止项会让用户为了发一篇文章被迫编造摘要与标签 —— 那是坏产品。
 *
 * 纪律：本文件只放纯函数与类型，不引入任何 IO。
 */

/** 检查项级别 */
export type PublishCheckLevel = 'error' | 'warning' | 'info';

/** 单个检查项 */
export interface PublishCheckItem {
  /** 稳定 id（前端据此做定位/折叠；不参与展示） */
  id: string;
  level: PublishCheckLevel;
  /** 人读标题（短） */
  label: string;
  /** 结论说明（缺什么 / 已满足） */
  detail: string;
  /** 已通过（清单里两者都要展示：未通过的才是待办） */
  passed: boolean;
}

/** 检查输入 */
export interface PublishCheckInput {
  frontmatter: Record<string, unknown>;
  /** 正文（Markdown 源或纯文本均可；只用来判空与长度） */
  content: string;
  /** 当前主题可纳管的扩展名（如 `['.md','.mdx']`）；空数组表示无从判断（不检查） */
  extensions?: readonly string[];
  /**
   * 是否要求 `published` 必填。
   * Shirone 为 true（上游 `published: z.date()` 必填）；Mizuki 为 false。
   */
  requirePublished?: boolean;
  /** 正文的建议最短字数（缺省 50；仅作 warning） */
  minContentChars?: number;
}

/** 检查结果 */
export interface PublishCheckResult {
  items: PublishCheckItem[];
  /** 是否可以发布（无 error 即可；warning 不阻止） */
  canPublish: boolean;
  errorCount: number;
  warningCount: number;
}

/** 取字符串字段（非字符串视为空） */
function textOf(frontmatter: Record<string, unknown>, key: string): string {
  const value = frontmatter[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** 取字符串数组字段（用于标签数） */
function arrayOf(frontmatter: Record<string, unknown>, key: string): unknown[] {
  const value = frontmatter[key];
  return Array.isArray(value) ? value : [];
}

/**
 * 生成发布前检查清单。
 *
 * 顺序固定（error 在前、warning 在后；同级别按业务重要性），
 * 界面上**已通过项也展示**——那让用户知道「系统确实检查了这一项」，
 * 而不是只看到一堆红字不知道还有什么没查。
 */
export function checkPublishReadiness(input: PublishCheckInput): PublishCheckResult {
  const { frontmatter, content } = input;
  const minContentChars = input.minContentChars ?? 50;
  const items: PublishCheckItem[] = [];

  // ── error 级（缺了就是坏的）────────────────────────────────────────────
  const title = textOf(frontmatter, 'title');
  items.push({
    id: 'title',
    level: 'error',
    label: '标题',
    detail: title === '' ? '标题为空：列表与详情都会显示成占位文本' : `已填写（${title.length} 字）`,
    passed: title !== '',
  });

  const published = frontmatter['published'];
  const hasPublished =
    published instanceof Date ||
    (typeof published === 'string' && published.trim() !== '') ||
    published === true;
  if (input.requirePublished === true) {
    items.push({
      id: 'published',
      level: 'error',
      label: '发布日期',
      detail: hasPublished ? '已设置' : '当前主题要求发布日期必填（Shirone 的构建期 schema 会拒绝缺该项的文章）',
      passed: hasPublished,
    });
  } else {
    items.push({
      id: 'published',
      level: 'info',
      label: '发布日期',
      detail: hasPublished ? '已设置' : '未设置：本主题允许（将以草稿形态存在）',
      passed: hasPublished,
    });
  }

  const bodyChars = content.trim().length;
  items.push({
    id: 'content',
    level: 'error',
    label: '正文',
    detail: bodyChars === 0 ? '正文为空：发出去是一篇没有内容的文章' : `已填写（${bodyChars} 字）`,
    passed: bodyChars > 0,
  });

  // ── warning 级（能发但不理想）──────────────────────────────────────────
  const description = textOf(frontmatter, 'description');
  items.push({
    id: 'description',
    level: 'warning',
    label: '摘要',
    detail:
      description === ''
        ? '未填写摘要：列表页与分享卡片会缺少简介（可用 AI 的「标题·描述·标签」生成）'
        : `已填写（${description.length} 字）`,
    passed: description !== '',
  });

  // 摘要过长只提示，不阻止：主题侧会自行截断
  if (description.length > 200) {
    items.push({
      id: 'description-length',
      level: 'warning',
      label: '摘要长度',
      detail: `摘要 ${description.length} 字，偏长（建议 ≤120 字）`,
      passed: false,
    });
  }

  const tags = arrayOf(frontmatter, 'tags');
  items.push({
    id: 'tags',
    level: 'warning',
    label: '标签',
    detail: tags.length === 0 ? '未设置标签：不利于归档与检索' : `已设置 ${tags.length} 个`,
    passed: tags.length > 0,
  });

  if (bodyChars > 0 && bodyChars < minContentChars) {
    items.push({
      id: 'content-length',
      level: 'warning',
      label: '正文长度',
      detail: `正文仅 ${bodyChars} 字，偏短（建议 ≥${minContentChars} 字）`,
      passed: false,
    });
  }

  const category = textOf(frontmatter, 'category');
  items.push({
    id: 'category',
    level: 'info',
    label: '分类',
    detail: category === '' ? '未设置分类（可选）' : `已设置：${category}`,
    passed: category !== '',
  });

  const errorCount = items.filter((item) => item.level === 'error' && !item.passed).length;
  const warningCount = items.filter((item) => item.level === 'warning' && !item.passed).length;

  return {
    items,
    // 只有 error 级未通过才阻止发布；warning 与 info 不阻止
    canPublish: errorCount === 0,
    errorCount,
    warningCount,
  };
}
