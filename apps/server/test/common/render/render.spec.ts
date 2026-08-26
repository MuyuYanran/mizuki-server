import { renderMarkdownToSafeHtml, renderTipTapDoc, sanitizeHtmlFragment } from '../../../src/common/render/render';

/**
 * P8 §3.8 安全红线单元依据：公开输出任何未经 sanitize 的 HTML 一律禁止——
 * script 标签 / on* 事件属性 / javascript: 协议必须被清除。
 */

describe('common/render（渲染统一安全出口）', () => {
  it('Markdown 渲染：<script> 注入被清除，正常排版保留', () => {
    const html = renderMarkdownToSafeHtml('# 标题\n\n正文段落。\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('<h1');
    expect(html).toContain('<p>');
  });

  it('Markdown 渲染：javascript: 链接协议被剥离', () => {
    const html = renderMarkdownToSafeHtml('[点我](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('Markdown 渲染：内联事件属性被剥离', () => {
    const html = renderMarkdownToSafeHtml('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('TipTap 渲染：文本中的 HTML 被转义（<script> 不成为标签）', () => {
    const html = renderTipTapDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '<script>alert(1)</script> 与 <b>加粗尝试</b>' }],
        },
      ],
    });
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<p>');
  });

  it('TipTap 渲染：link 的 javascript: 协议被 sanitize 剥离', () => {
    const html = renderTipTapDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '链接',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    });
    expect(html).not.toContain('javascript:');
  });

  it('TipTap 渲染：image 属性注入被转义（onerror 不成为属性）', () => {
    const html = renderTipTapDoc({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: '" onerror="alert(1)', alt: 'x' },
        },
      ],
    });
    expect(html).not.toContain('onerror="');
    expect(html).toContain('&quot;');
  });

  it('TipTap 渲染：结构标签正常输出（标题/列表/加粗）', () => {
    const html = renderTipTapDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '小节' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: '加粗项', marks: [{ type: 'bold' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(html).toContain('<h2>小节</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>加粗项</strong>');
  });

  it('sanitizeHtmlFragment：未知标签与 iframe 被剥离', () => {
    const html = sanitizeHtmlFragment('<iframe src="https://evil.example"></iframe><p>保留</p>');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<p>保留</p>');
  });
});
