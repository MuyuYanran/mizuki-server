/**
 * [阶段 P8] common/render — 渲染统一安全出口（L0 纯工具）
 * [职责] 公开输出一律经此：
 *   - Markdown → marked 渲染 → sanitize-html 过滤；
 *   - TipTap doc_json → 最小安全 HTML 渲染（文本/属性全部转义）→ sanitize；
 *   - 任意 HTML 片段 → sanitize-html 过滤。
 * [状态] ACTIVE
 *
 * 安全红线（P8 §3.8）：剥离 script 标签（不在白名单）、事件处理器属性
 * （on* 不在属性白名单）、javascript: 协议（不在 allowedSchemes）。
 */
import { marked } from 'marked';
import sanitizeHtml, { type SanitizeOptions } from 'sanitize-html';

/**
 * sanitize 白名单（取舍见交付报告疑问清单）：
 * 常见排版标签 + a/img 受限属性；scheme 仅 http/https/mailto/tel。
 * 未列入的标签（script/style/iframe 等）与属性（on* 等）一律剥离。
 */
const SANITIZE_OPTIONS: SanitizeOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li',
    'a', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'sub', 'sup', 'span',
    'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    div: ['class'],
    span: ['class'],
    code: ['class'],
    pre: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  disallowedTagsMode: 'discard',
};

/** Markdown → 安全 HTML（公开输出统一出口） */
export function renderMarkdownToSafeHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false });
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}

/** 任意 HTML 片段 → 安全 HTML（如 html_cache 重建） */
export function sanitizeHtmlFragment(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * TipTap doc_json → 安全 HTML（最小渲染器）：
 * 只输出已知节点的结构化标签，文本与属性值全部转义，未知节点只渲染子节点；
 * 结果再过 sanitize（纵深防御）。深层结构按「信任源」不再过度校验（取舍记报告）。
 */
export function renderTipTapDoc(doc: unknown): string {
  return sanitizeHtmlFragment(renderNode(doc));
}

// ── 内部实现 ──

interface TiptapNode {
  type?: unknown;
  text?: unknown;
  marks?: unknown;
  attrs?: unknown;
  content?: unknown;
}

function renderNode(node: unknown): string {
  if (!isRecord(node)) {
    return '';
  }
  const typed = node as TiptapNode;
  if (typeof typed.type !== 'string') {
    return '';
  }
  const children = Array.isArray(typed.content)
    ? (typed.content as unknown[]).map((child) => renderNode(child)).join('')
    : '';

  switch (typed.type) {
    case 'doc':
      return children;
    case 'paragraph':
      return `<p>${children}</p>`;
    case 'heading': {
      const level = headingLevel(typed.attrs);
      return `<h${level}>${children}</h${level}>`;
    }
    case 'text':
      return renderText(typed);
    case 'bulletList':
      return `<ul>${children}</ul>`;
    case 'orderedList':
      return `<ol>${children}</ol>`;
    case 'listItem':
      return `<li>${children}</li>`;
    case 'blockquote':
      return `<blockquote>${children}</blockquote>`;
    case 'codeBlock':
      // 代码块内为纯文本（children 已由 text 分支转义）
      return `<pre><code>${children}</code></pre>`;
    case 'hardBreak':
      return '<br>';
    case 'horizontalRule':
      return '<hr>';
    case 'image': {
      const attrs = recordOf(typed.attrs);
      const src = escapeAttr(stringOf(attrs['src']));
      const alt = escapeAttr(stringOf(attrs['alt']));
      const title = escapeAttr(stringOf(attrs['title']));
      return `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''}>`;
    }
    default:
      // 未知节点：只渲染子节点，不产生任何原始 HTML（保守）
      return children;
  }
}

/** 文本节点：转义后按 marks 包裹（link 的 href 亦转义并受 sanitize scheme 约束） */
function renderText(node: TiptapNode): string {
  let html = escapeText(typeof node.text === 'string' ? node.text : '');
  const marks = Array.isArray(node.marks) ? (node.marks as unknown[]) : [];
  for (const mark of marks) {
    if (!isRecord(mark) || typeof (mark as TiptapNode).type !== 'string') {
      continue;
    }
    const typedMark = mark as TiptapNode;
    switch (typedMark.type) {
      case 'bold':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
        html = `<em>${html}</em>`;
        break;
      case 'code':
        html = `<code>${html}</code>`;
        break;
      case 'strike':
        html = `<s>${html}</s>`;
        break;
      case 'link': {
        const attrs = recordOf(typedMark.attrs);
        const href = escapeAttr(stringOf(attrs['href']));
        html = `<a href="${href}">${html}</a>`;
        break;
      }
      default:
        break; // 未知 mark 忽略（不包裹）
    }
  }
  return html;
}

// ── 纯工具 ──

function headingLevel(attrs: unknown): number {
  const level = Number(recordOf(attrs)['level']);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** HTML 文本转义 */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** HTML 属性值转义（含引号） */
function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}
