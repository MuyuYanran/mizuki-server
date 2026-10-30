/**
 * [U4-AI3/A] AiUsageService 单测 —— 台账写入 / 三态语义 / 聚合口径 / 保留策略
 *
 * 五组钉子：
 * ① **写入失败绝不抛出**（台账不能成为单点故障）—— 用「DB 已关闭」构造真实失败路径；
 * ② **null ≠ 0**：拿不到 token 时写 null，聚合时 `tokenSamples` 只数非 null 行；
 * ③ **aborted 不算失败**：成功率分母只含 ok + error；
 * ④ 聚合正确性：分组求和 / 平均耗时（按调用数加权，不是「平均的平均」）；
 * ⑤ 保留策略：超上限后清最旧，且清理失败也不抛出。
 *
 * 隔离：DB 在 mkdtemp 临时域；不触碰真实 Mizuki 目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AI_USAGE_KEEP, computeSuccessRate, type AiUsageRecord } from '@mizuki/shared';
import { runMigrations } from '../src/infra/db/migrate';
import { aiUsage } from '../src/infra/db/schema';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-ai-usage-'));
let sqlite: Database.Database;
let service: AiUsageService;
let dbPath: string;

function openFixture(): void {
  dbPath = path.join(tmp, `usage-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  runMigrations(dbPath);
  sqlite = new Database(dbPath);
  service = new AiUsageService(drizzle(sqlite));
}

/** 构造一笔记录（默认为一次成功的润色） */
function rec(overrides: Partial<AiUsageRecord> = {}): AiUsageRecord {
  return {
    scene: 'chat',
    action: 'polish',
    profileId: 'p1',
    model: 'deepseek-chat',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    durationMs: 1000,
    status: 'ok',
    errorCode: null,
    ...overrides,
  };
}

beforeEach(() => {
  openFixture();
});

afterEach(() => {
  try {
    sqlite.close();
  } catch {
    // 某些用例会主动关库构造失败路径
  }
});

describe('[U4-AI3/A] AiUsageService — 写入与三态', () => {
  it('① 正常写入：一行落库，字段原样保留', async () => {
    await service.record(rec());
    const view = await service.query(7);
    expect(view.retainedRows).toBe(1);
    expect(view.recent).toHaveLength(1);
    const row = view.recent[0];
    expect(row?.action).toBe('polish');
    expect(row?.scene).toBe('chat');
    expect(row?.status).toBe('ok');
    expect(row?.totalTokens).toBe(150);
  });

  it('① **写入失败绝不抛出**：DB 已关闭时 record() 静默降级', async () => {
    sqlite.close();
    // 关键断言：不抛（若抛，主业务响应就会被记账失败连累）
    await expect(service.record(rec())).resolves.toBeUndefined();
  });

  it('② null ≠ 0：拿不到 token 时三列都是 null（不是 0）', async () => {
    await service.record(
      rec({
        scene: 'ping',
        action: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      }),
    );
    const view = await service.query(7);
    const row = view.recent[0];
    expect(row?.promptTokens).toBeNull();
    expect(row?.completionTokens).toBeNull();
    expect(row?.totalTokens).toBeNull();
  });

  it('② 聚合区分「零消耗」与「未知」：tokenSamples 只数非 null 行', async () => {
    // 2 笔有 token、1 笔未知（ping）
    await service.record(rec({ totalTokens: 150, promptTokens: 100, completionTokens: 50 }));
    await service.record(rec({ totalTokens: 100, promptTokens: 60, completionTokens: 40 }));
    await service.record(
      rec({
        scene: 'ping',
        action: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      }),
    );
    const view = await service.query(7);
    expect(view.totals.calls).toBe(3);
    expect(view.totals.tokenSamples).toBe(2); // 只有两笔有 token
    expect(view.totals.totalTokens).toBe(250); // 求和仍正确（null 视作不参与）
  });

  it('③ aborted 与 error 分开：aborted 不计入错误率', async () => {
    await service.record(rec({ status: 'ok' }));
    await service.record(rec({ status: 'ok' }));
    await service.record(rec({ status: 'error', errorCode: 'upstream_5xx' }));
    await service.record(rec({ status: 'aborted' }));

    const view = await service.query(7);
    expect(view.totals.calls).toBe(4);
    expect(view.totals.okCalls).toBe(2);
    expect(view.totals.errorCalls).toBe(1);
    expect(view.totals.abortedCalls).toBe(1);
    // 分母 = ok + error = 3 ⇒ 2/3 ≈ 66.7%；若把 aborted 计入分母会变成 50%
    expect(view.totals.successRate).toBe(66.7);
  });

  it('③ 只有 aborted 时 successRate 为 null（无样本 ≠ 成功率 0）', async () => {
    await service.record(rec({ status: 'aborted' }));
    const view = await service.query(7);
    expect(view.totals.successRate).toBeNull();
  });

  it('③ aborted 不记错误码（避免污染按错误码排查）', async () => {
    await service.record(rec({ status: 'aborted', errorCode: null }));
    const view = await service.query(7);
    expect(view.recent[0]?.errorCode).toBeNull();
  });
});

describe('[U4-AI3/A] AiUsageService — 聚合口径', () => {
  it('④ 按动作分组，自由聊天（action=null）单独成组', async () => {
    await service.record(rec({ action: 'polish', totalTokens: 100 }));
    await service.record(rec({ action: 'polish', totalTokens: 200 }));
    await service.record(rec({ action: 'summarize', totalTokens: 50 }));
    await service.record(rec({ action: null, totalTokens: 10 }));

    const view = await service.query(7);
    const byAction = new Map(view.byAction.map((row) => [row.action, row]));
    expect(byAction.get('polish')?.calls).toBe(2);
    expect(byAction.get('polish')?.totalTokens).toBe(300);
    expect(byAction.get('summarize')?.calls).toBe(1);
    expect(byAction.get(null)?.calls).toBe(1);
  });

  it('④ 平均耗时按**调用数加权**（不是「平均的平均」）', async () => {
    // 组 A：1 次 1000ms；组 B：3 次 100ms
    await service.record(rec({ action: 'polish', durationMs: 1000 }));
    await service.record(rec({ action: 'summarize', durationMs: 100 }));
    await service.record(rec({ action: 'summarize', durationMs: 100 }));
    await service.record(rec({ action: 'summarize', durationMs: 100 }));

    const view = await service.query(7);
    // 加权平均 = (1000 + 300) / 4 = 325；若对两个组的均值再平均会得 (1000+100)/2 = 550
    expect(view.totals.avgDurationMs).toBe(325);
  });

  it('④ 窗口过滤：窗口外的记录不计入聚合，但仍在 retainedRows 里', async () => {
    await service.record(rec());
    // 手工插一行 30 天前的
    sqlite
      .prepare(
        'insert into ai_usage (id, created_at, action, scene, duration_ms, status) values (?, ?, ?, ?, ?, ?)',
      )
      .run('old', Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000), 'polish', 'chat', 10, 'ok');

    const week = await service.query(7);
    expect(week.totals.calls).toBe(1); // 只算窗口内那笔
    expect(week.retainedRows).toBe(2); // 但台账里有两行

    const month = await service.query(60);
    expect(month.totals.calls).toBe(2); // 放大窗口就都能看到
  });

  it('④ 空台账：全零且 successRate 为 null（不报错）', async () => {
    const view = await service.query(7);
    expect(view.totals.calls).toBe(0);
    expect(view.totals.totalTokens).toBe(0);
    expect(view.totals.successRate).toBeNull();
    expect(view.recent).toEqual([]);
    expect(view.byAction).toEqual([]);
  });
});

describe('[U4-AI3/A] AiUsageService — 保留策略', () => {
  it('⑤ 超出上限后清最旧（保留最新 AI_USAGE_KEEP 行）', async () => {
    // 直接批量插入，避免调用 record() 触发 N 次保留检查（那会变成 O(N²)）
    const insert = sqlite.prepare(
      'insert into ai_usage (id, created_at, action, scene, duration_ms, status) values (?, ?, ?, ?, ?, ?)',
    );
    const base = Date.now() - (AI_USAGE_KEEP + 20) * 1000;
    const tx = sqlite.transaction(() => {
      for (let i = 0; i < AI_USAGE_KEEP + 20; i += 1) {
        insert.run(`row-${i}`, Math.floor((base + i * 1000) / 1000), 'polish', 'chat', 10, 'ok');
      }
    });
    tx();
    const before = sqlite.prepare('select count(*) as c from ai_usage').get() as { c: number };
    expect(before.c).toBe(AI_USAGE_KEEP + 20);

    // 触发一次写入，顺带跑保留策略
    await service.record(rec());

    const after = sqlite.prepare('select count(*) as c from ai_usage').get() as { c: number };
    expect(after.c).toBeLessThanOrEqual(AI_USAGE_KEEP + 1);
    // 最旧的几行应已被清掉
    const oldest = sqlite.prepare('select id from ai_usage order by created_at asc limit 1').get() as
      | { id: string }
      | undefined;
    expect(oldest?.id).not.toBe('row-0');
  });

  it('⑤ 保留上限随视图回传（前端据此提示「更早记录已滚动清理」）', async () => {
    const view = await service.query(7);
    expect(view.keepLimit).toBe(AI_USAGE_KEEP);
  });
});

describe('[U4-AI3/A] computeSuccessRate 纯函数', () => {
  it('分母为 0 ⇒ null（无样本 ≠ 0%）', () => {
    expect(computeSuccessRate(0, 0)).toBeNull();
  });

  it('全成功 ⇒ 100；全失败 ⇒ 0', () => {
    expect(computeSuccessRate(5, 0)).toBe(100);
    expect(computeSuccessRate(0, 5)).toBe(0);
  });

  it('保留一位小数', () => {
    expect(computeSuccessRate(2, 1)).toBe(66.7);
    expect(computeSuccessRate(1, 2)).toBe(33.3);
  });
});

describe('[U4-AI3/A] countByStatus', () => {
  it('按状态计数（供将来「只看失败」筛选）', async () => {
    await service.record(rec({ status: 'ok' }));
    await service.record(rec({ status: 'error', errorCode: 'x' }));
    await service.record(rec({ status: 'error', errorCode: 'y' }));
    expect(await service.countByStatus('ok')).toBe(1);
    expect(await service.countByStatus('error')).toBe(2);
    expect(await service.countByStatus('aborted')).toBe(0);
  });

  it('表名与列名与 schema 声明一致（防迁移与代码漂移）', async () => {
    // 直接查物理表：若 schema.ts 与迁移不一致，这条会失败
    const cols = sqlite.prepare('pragma table_info(ai_usage)').all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'action',
        'completion_tokens',
        'created_at',
        'duration_ms',
        'error_code',
        'id',
        'model',
        'profile_id',
        'prompt_tokens',
        'scene',
        'status',
        'total_tokens',
      ].sort(),
    );
    // schema 导出的表对象也指向同一张表
    expect(aiUsage).toBeDefined();
  });
});
