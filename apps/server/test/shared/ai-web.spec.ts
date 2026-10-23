/**
 * [U4-AI2/K11] shared/ai 的纯函数单测（前端无测试运行器 ⇒ 由 server 的 vitest 覆盖）
 *
 * 覆盖面（`apps/web` 里最容易被写错、又最难手验的两块）：
 * - `parseSseChunk`：跨块半帧 / `\r\n` / 多 data 行 / 空 data / 无 event / 一次多帧；
 * - `truncateForContext`：未超限原样、超限取前、口径与 zod 的 `max` 一致（码元数）。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_ACTION_LABELS,
  AI_ACTIONS,
  AI_LIMITS,
  parseSseChunk,
  truncateForContext,
} from '@mizuki/shared';

describe('P10f [U4-AI2] parseSseChunk', () => {
  it('单帧：event + data 正确提取', () => {
    const { frames, rest } = parseSseChunk('event: delta\ndata: {"text":"A"}\n\n');
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"A"}' }]);
    expect(rest).toBe('');
  });

  it('跨块半帧：不完整时 frames 为空、rest 保留原样，拼上后续后能出帧', () => {
    const first = parseSseChunk('event: del');
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe('event: del');

    const second = parseSseChunk(`${first.rest}ta\ndata: {"text":"A"}\n\n`);
    expect(second.frames).toEqual([{ event: 'delta', data: '{"text":"A"}' }]);
    expect(second.rest).toBe('');
  });

  it('一次读到多帧：全部按序返回', () => {
    const { frames } = parseSseChunk(
      'event: delta\ndata: {"text":"A"}\n\nevent: delta\ndata: {"text":"B"}\n\nevent: done\ndata: {}\n\n',
    );
    expect(frames.map((f) => f.event)).toEqual(['delta', 'delta', 'done']);
    expect(frames.map((f) => f.data)).toEqual(['{"text":"A"}', '{"text":"B"}', '{}']);
  });

  it('两帧之间夹半帧：完整帧出、半帧留 rest', () => {
    const { frames, rest } = parseSseChunk('event: done\ndata: {}\n\nevent: del');
    expect(frames).toEqual([{ event: 'done', data: '{}' }]);
    expect(rest).toBe('event: del');
  });

  it('\\r\\n 行尾被归一（网关改写场景）', () => {
    const { frames } = parseSseChunk('event: delta\r\ndata: {"text":"A"}\r\n\r\n');
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"A"}' }]);
  });

  it('多 data 行按 SSE 规范用 \\n 连接', () => {
    const { frames } = parseSseChunk('event: delta\ndata: line1\ndata: line2\n\n');
    expect(frames[0]?.data).toBe('line1\nline2');
  });

  it('data 为空串时保留空串（不丢帧）', () => {
    const { frames } = parseSseChunk('event: done\ndata:\n\n');
    expect(frames).toEqual([{ event: 'done', data: '' }]);
  });

  it('无 event 字段的帧：event 为空串', () => {
    const { frames } = parseSseChunk('data: [DONE]\n\n');
    expect(frames).toEqual([{ event: '', data: '[DONE]' }]);
  });

  it('空块（连续多个 \\n\\n）被忽略，不产生空帧', () => {
    const { frames } = parseSseChunk('\n\nevent: done\ndata: {}\n\n\n\n');
    expect(frames).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('注释行（: 开头）与 id:/retry: 字段被忽略', () => {
    const { frames } = parseSseChunk(': heartbeat\nid: 7\nretry: 100\nevent: delta\ndata: x\n\n');
    expect(frames).toEqual([{ event: 'delta', data: 'x' }]);
  });

  it('data 冒号后的一个空格被吃掉，其余空白保留（正文前导空格不丢）', () => {
    expect(parseSseChunk('data:  two\n\n').frames[0]?.data).toBe(' two');
    expect(parseSseChunk('data:none\n\n').frames[0]?.data).toBe('none');
  });
});

describe('P10f [U4-AI2] truncateForContext', () => {
  it('未超限：原样返回且 truncated=false', () => {
    const slice = truncateForContext('短文本', 100);
    expect(slice).toEqual({ text: '短文本', truncated: false, originalChars: 3, sentChars: 3 });
  });

  it('恰好等于上限：不算截断（边界）', () => {
    const slice = truncateForContext('abcdef', 6);
    expect(slice.truncated).toBe(false);
    expect(slice.text).toBe('abcdef');
  });

  it('超限：取前 N 字、截断标记为真、字数如实', () => {
    const text = 'A'.repeat(50);
    const slice = truncateForContext(text, 10);
    expect(slice.text).toBe('A'.repeat(10));
    expect(slice.truncated).toBe(true);
    expect(slice.originalChars).toBe(50);
    expect(slice.sentChars).toBe(10);
  });

  it('口径与 zod 的 max 一致（码元数）：emoji 按 2 个码元计，截断后长度不超 max', () => {
    const emoji = '🙂'.repeat(5); // length === 10
    expect(emoji.length).toBe(10);
    const slice = truncateForContext(emoji, 4);
    expect(slice.sentChars).toBe(4);
    expect(slice.text.length).toBeLessThanOrEqual(4);
    expect(slice.truncated).toBe(true);
  });

  it('用 AI_LIMITS.maxContextChars 时：不超限的大文本不截断', () => {
    const text = 'x'.repeat(AI_LIMITS.maxContextChars);
    expect(truncateForContext(text, AI_LIMITS.maxContextChars).truncated).toBe(false);
    expect(truncateForContext(text + 'y', AI_LIMITS.maxContextChars).truncated).toBe(true);
  });
});

describe('P10f [U4-AI2] 动作标签', () => {
  it('每个动作都有中文标签，且键集与 AI_ACTIONS 完全一致', () => {
    expect(Object.keys(AI_ACTION_LABELS).sort()).toEqual([...AI_ACTIONS].sort());
    for (const action of AI_ACTIONS) {
      expect(AI_ACTION_LABELS[action].length).toBeGreaterThan(0);
    }
  });
});
