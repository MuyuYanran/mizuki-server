/**
 * [U4-AI3/B] `parseMetaOutput` / `planMetaBackfill` 单测
 *
 * 两组钉子：
 * ① **解析容错**：模型输出不是结构化数据 —— 行首标签、Markdown 包裹、列表符号、
 *    空行、缺行都要能对付；完全无内容时**返回全 null 而不是抛错**（调用方据此提示重试）；
 * ② **非破坏性回填（本文件的重心）**：把「绝不静默覆盖用户已写内容」这条铁律
 *    钉死在纯函数上 —— 四态 fill / conflict / same / empty 各有用例，
 *    并显式断言「用户已写的非空内容**不会**出现在 fill 里」。
 *
 * 为什么这条必须由单测守：它是**用户劳动的保护**，一旦被改坏（比如有人图省事让
 * 生成结果直接覆盖），界面上看不出来，但用户手写的内容会在点一下按钮后消失。
 */
import { describe, expect, it } from 'vitest';
import {
  formatParsedMeta,
  parseMetaOutput,
  planMetaBackfill,
  splitTags,
} from '@mizuki/shared';

describe('[U4-AI3/B] parseMetaOutput — 三行解析', () => {
  it('① 标准三行：标题 / 摘要 / 标签', () => {
    const parsed = parseMetaOutput(
      '用 Astro 搭建个人博客\n本文介绍了用 Astro 搭建博客的完整流程，涵盖主题选择与部署。\nastro,博客,前端',
    );
    expect(parsed.title).toBe('用 Astro 搭建个人博客');
    expect(parsed.summary).toContain('完整流程');
    expect(parsed.tags).toEqual(['astro', '博客', '前端']);
  });

  it('① 剥掉行首标签（第X行 / 标题 / Title / 摘要 / Tags…）', () => {
    const parsed = parseMetaOutput(
      '第一行：我的标题\n第二行：我的摘要\n第三行：a,b',
    );
    expect(parsed.title).toBe('我的标题');
    expect(parsed.summary).toBe('我的摘要');
    expect(parsed.tags).toEqual(['a', 'b']);
  });

  it('① 剥掉 Markdown 包裹与列表符号', () => {
    const parsed = parseMetaOutput(
      '**粗体标题**\n- 列表式摘要\n* `tag1`, tag2',
    );
    expect(parsed.title).toBe('粗体标题');
    expect(parsed.summary).toBe('列表式摘要');
    expect(parsed.tags).toEqual(['tag1', 'tag2']);
  });

  it('① 忽略空行与首尾空白', () => {
    const parsed = parseMetaOutput('\n\n  标题行  \n\n  摘要行  \n\n  x,y  \n\n');
    expect(parsed.title).toBe('标题行');
    expect(parsed.summary).toBe('摘要行');
    expect(parsed.tags).toEqual(['x', 'y']);
  });

  it('① 缺行：不足三行时缺的字段为 null / []', () => {
    expect(parseMetaOutput('只有标题')).toEqual({ title: '只有标题', summary: null, tags: [] });
    expect(parseMetaOutput('标题\n摘要')).toEqual({
      title: '标题',
      summary: '摘要',
      tags: [],
    });
  });

  it('① **完全无内容 ⇒ 全 null**（不抛错，调用方据此提示重试）', () => {
    for (const empty of ['', '   ', '\n\n\n', '   \n  \n']) {
      const parsed = parseMetaOutput(empty);
      expect(parsed.title, JSON.stringify(empty)).toBeNull();
      expect(parsed.summary).toBeNull();
      expect(parsed.tags).toEqual([]);
    }
  });

  it('① 标签分隔符：中英文逗号、顿号、分号都认，且去重保序', () => {
    expect(splitTags('a,b，c、d；e;a')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitTags('x,,x, ,y')).toEqual(['x', 'y']);
    expect(splitTags('')).toEqual([]);
  });

  it('① formatParsedMeta 与解析器互逆（可读化展示）', () => {
    const parsed = parseMetaOutput('标题\n摘要\na,b');
    const text = formatParsedMeta(parsed);
    expect(text).toContain('标题：标题');
    expect(text).toContain('摘要：摘要');
    expect(text).toContain('标签：a、b');
  });
});

describe('[U4-AI3/B] planMetaBackfill — 非破坏性回填（核心铁律）', () => {
  const parsed = { title: '新标题', summary: '新摘要', tags: ['x', 'y'] };
  const empty = { title: '', summary: '', tags: [] as string[] };

  it('② 全空表单 ⇒ 三项都是 fill（可安全填入）', () => {
    const plan = planMetaBackfill(parsed, empty);
    expect(plan.title.action).toBe('fill');
    expect(plan.summary.action).toBe('fill');
    expect(plan.tags.action).toBe('fill');
    expect(plan.hasConflicts).toBe(false);
    expect(plan.hasChanges).toBe(true);
  });

  it('② **表单非空且不同 ⇒ conflict（绝不 fill）** —— 这是用户劳动保护的核心断言', () => {
    const plan = planMetaBackfill(parsed, {
      title: '用户手写的标题',
      summary: '用户手写的摘要',
      tags: ['用户标签'],
    });
    // 三个都必须是 conflict，绝不能是 fill
    expect(plan.title.action).toBe('conflict');
    expect(plan.summary.action).toBe('conflict');
    expect(plan.tags.action).toBe('conflict');
    expect(plan.hasConflicts).toBe(true);
    // 且原值必须被完整带出（界面据此展示「A → B」差异）
    expect(plan.title.current).toBe('用户手写的标题');
    expect(plan.title.next).toBe('新标题');
    expect(plan.tags.current).toBe('用户标签');
  });

  it('② 表单非空且相同 ⇒ same（无需动作，不当作冲突）', () => {
    const plan = planMetaBackfill(parsed, {
      title: '新标题',
      summary: '新摘要',
      tags: ['x', 'y'],
    });
    expect(plan.title.action).toBe('same');
    expect(plan.summary.action).toBe('same');
    expect(plan.tags.action).toBe('same');
    expect(plan.hasConflicts).toBe(false);
    expect(plan.hasChanges).toBe(false);
  });

  it('② 模型没给出该字段 ⇒ empty，且**不动**用户已写内容', () => {
    const plan = planMetaBackfill(
      { title: null, summary: null, tags: [] },
      { title: '用户标题', summary: '用户摘要', tags: ['用户标签'] },
    );
    expect(plan.title).toEqual({ action: 'empty', current: '用户标题', next: '' });
    expect(plan.summary.action).toBe('empty');
    expect(plan.tags.action).toBe('empty');
    expect(plan.hasConflicts).toBe(false);
    expect(plan.hasChanges).toBe(false);
  });

  it('② 混合态：空的可填、非空的要确认', () => {
    const plan = planMetaBackfill(parsed, {
      title: '',
      summary: '已有摘要',
      tags: [],
    });
    expect(plan.title.action).toBe('fill');
    expect(plan.summary.action).toBe('conflict');
    expect(plan.tags.action).toBe('fill');
    expect(plan.hasConflicts).toBe(true);
    expect(plan.hasChanges).toBe(true);
  });

  it('② 只有空白字符的当前值视为空（不会误判成冲突）', () => {
    const plan = planMetaBackfill(parsed, { title: '   ', summary: '\t', tags: [] });
    expect(plan.title.action).toBe('fill');
    expect(plan.summary.action).toBe('fill');
  });

  it('② 全无建议值 ⇒ hasChanges=false（界面提示「没有可回填的内容」）', () => {
    const plan = planMetaBackfill({ title: null, summary: null, tags: [] }, empty);
    expect(plan.hasChanges).toBe(false);
    expect(plan.hasConflicts).toBe(false);
  });
});
