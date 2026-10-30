/**
 * [U4-AI3/B] `checkPublishReadiness` 单测 —— 发布前检查清单
 *
 * 四组钉子：
 * ① **error 才阻止发布**，warning 不阻止（否则用户为了发文章被迫编造摘要与标签 —— 坏产品）；
 * ② **主题能力分化**：`requirePublished` 为真时缺发布日期是 error，为假时只是 info
 *    （Shirone 的构建期 schema 把 published 定为必填，Mizuki 允许为空）；
 * ③ 边界：空正文 / 空标题 / 超长摘要 / 过短正文各自命中正确项；
 * ④ **已通过项也出现在清单里**（让用户知道系统确实查了这一项）。
 */
import { describe, expect, it } from 'vitest';
import { checkPublishReadiness } from '@mizuki/shared';

/** 一篇「基本合格」的文章（用于逐项制造缺陷） */
function healthy(): Parameters<typeof checkPublishReadiness>[0] {
  return {
    frontmatter: {
      title: '一个标题',
      description: '一段摘要',
      tags: ['a', 'b'],
      category: '技术',
      published: '2026-10-31',
    },
    content: 'x'.repeat(120),
    requirePublished: true,
  };
}

describe('[U4-AI3/B] checkPublishReadiness — 基线', () => {
  it('① 健康文章：可发布，零 error 零 warning', () => {
    const result = checkPublishReadiness(healthy());
    expect(result.canPublish).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('④ 已通过项也出现在清单里（不是只列问题）', () => {
    const result = checkPublishReadiness(healthy());
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain('title');
    expect(ids).toContain('content');
    expect(ids).toContain('tags');
    // 且这些项 marked passed
    expect(result.items.find((i) => i.id === 'title')?.passed).toBe(true);
    expect(result.items.find((i) => i.id === 'tags')?.passed).toBe(true);
  });

  it('① 每个检查项都有非空 id / label / detail', () => {
    for (const item of checkPublishReadiness(healthy()).items) {
      expect(item.id.length, item.id).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('[U4-AI3/B] checkPublishReadiness — error 阻止 / warning 不阻止', () => {
  it('① 缺标题 ⇒ error 且阻止发布', () => {
    const input = healthy();
    input.frontmatter.title = '';
    const result = checkPublishReadiness(input);
    expect(result.canPublish).toBe(false);
    expect(result.items.find((i) => i.id === 'title')?.level).toBe('error');
  });

  it('① 空正文 ⇒ error 且阻止发布', () => {
    const input = healthy();
    input.content = '   ';
    const result = checkPublishReadiness(input);
    expect(result.canPublish).toBe(false);
    expect(result.items.find((i) => i.id === 'content')?.passed).toBe(false);
  });

  it('① **缺摘要只有 warning，不阻止发布**', () => {
    const input = healthy();
    input.frontmatter.description = '';
    const result = checkPublishReadiness(input);
    expect(result.canPublish).toBe(true);
    expect(result.warningCount).toBe(1);
    expect(result.items.find((i) => i.id === 'description')?.level).toBe('warning');
  });

  it('① **缺标签只有 warning，不阻止发布**', () => {
    const input = healthy();
    input.frontmatter.tags = [];
    const result = checkPublishReadiness(input);
    expect(result.canPublish).toBe(true);
    expect(result.warningCount).toBe(1);
  });

  it('① 只有 warning 时 canPublish 仍为 true（关键产品语义）', () => {
    const input = healthy();
    input.frontmatter.description = '';
    input.frontmatter.tags = [];
    const result = checkPublishReadiness(input);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(2);
    expect(result.canPublish).toBe(true);
  });
});

describe('[U4-AI3/B] checkPublishReadiness — 主题能力分化', () => {
  it('② requirePublished=true（Shirone）且缺发布日期 ⇒ error', () => {
    const input = healthy();
    delete input.frontmatter.published;
    input.requirePublished = true;
    const result = checkPublishReadiness(input);
    expect(result.canPublish).toBe(false);
    const item = result.items.find((i) => i.id === 'published');
    expect(item?.level).toBe('error');
    expect(item?.passed).toBe(false);
    // 文案要点明「当前主题要求」
    expect(item?.detail).toContain('当前主题要求');
  });

  it('② requirePublished=false（Mizuki）且缺发布日期 ⇒ 只是 info，不阻止', () => {
    const input = healthy();
    delete input.frontmatter.published;
    input.requirePublished = false;
    const result = checkPublishReadiness(input);
    expect(result.canPublish).toBe(true);
    const item = result.items.find((i) => i.id === 'published');
    expect(item?.level).toBe('info');
    expect(item?.detail).toContain('本主题允许');
  });

  it('② published 为 Date 对象也算已设置（YAML 裸日期解析产物）', () => {
    const input = healthy();
    input.frontmatter.published = new Date('2026-10-31T00:00:00Z');
    expect(checkPublishReadiness(input).items.find((i) => i.id === 'published')?.passed).toBe(true);
  });

  it('② published 为空白字符串不算已设置', () => {
    const input = healthy();
    input.frontmatter.published = '   ';
    input.requirePublished = true;
    expect(checkPublishReadiness(input).canPublish).toBe(false);
  });
});

describe('[U4-AI3/B] checkPublishReadiness — 边界', () => {
  it('③ 摘要超 200 字 ⇒ warning', () => {
    const input = healthy();
    input.frontmatter.description = 'x'.repeat(201);
    const result = checkPublishReadiness(input);
    expect(result.items.find((i) => i.id === 'description-length')?.level).toBe('warning');
    expect(result.canPublish).toBe(true);
  });

  it('③ 摘要恰好 200 字 ⇒ 不触发长度提示（边界不含）', () => {
    const input = healthy();
    input.frontmatter.description = 'x'.repeat(200);
    expect(checkPublishReadiness(input).items.find((i) => i.id === 'description-length')).toBeUndefined();
  });

  it('③ 正文过短 ⇒ warning（阈值可配）', () => {
    const input = healthy();
    input.content = 'x'.repeat(10);
    const result = checkPublishReadiness({ ...input, minContentChars: 50 });
    expect(result.items.find((i) => i.id === 'content-length')?.level).toBe('warning');
    expect(result.canPublish).toBe(true);
  });

  it('③ 正文恰好等于阈值 ⇒ 不触发（边界不含）', () => {
    const input = healthy();
    input.content = 'x'.repeat(50);
    expect(
      checkPublishReadiness({ ...input, minContentChars: 50 }).items.find(
        (i) => i.id === 'content-length',
      ),
    ).toBeUndefined();
  });

  it('③ 全空输入不抛错，且给出明确的 error 项', () => {
    const result = checkPublishReadiness({ frontmatter: {}, content: '', requirePublished: true });
    expect(result.canPublish).toBe(false);
    expect(result.errorCount).toBeGreaterThanOrEqual(2); // 标题 + 正文（+ published）
  });

  it('③ 非字符串 title（如数字）视为空 ⇒ error（不把数字渲染成标题）', () => {
    const result = checkPublishReadiness({
      frontmatter: { title: 123, published: '2026-01-01' },
      content: 'x'.repeat(100),
    });
    expect(result.items.find((i) => i.id === 'title')?.passed).toBe(false);
  });
});
