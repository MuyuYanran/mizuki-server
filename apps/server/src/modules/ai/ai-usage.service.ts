/**
 * [U4-AI3/A] ai/ai-usage.service — AI 用量台账（写入 + 查询聚合）
 *
 * [写入纪律：**旁路，绝不阻断主业务**]
 *   用量记录是「事后记账」，不是业务的一部分。任何失败（DB 忙、磁盘满、schema 漂移）
 *   都只 `logger.warn`，绝不抛出、绝不改变主响应。理由：
 *   用户来润色文章，不该因为「记账失败」而拿不到结果 —— 台账不能成为单点故障。
 *   为把这条纪律做**可验证**：`record()` 返回 void 且**内部全 try/catch**；
 *   单测里用「DB 已关闭」构造失败路径，断言主流程仍正常返回。
 *
 * [保留策略]
 *   每次写入后检查行数，超过 `AI_USAGE_KEEP` 就按时间删最旧的一批（批量删、非逐行）。
 *   为什么用「行数上限」而不是「按天保留」：用量表是**可再生的观测数据**，
 *   用户真正在意的是「最近发生了什么」；行数上限让库体积有硬边界，
 *   而按天保留在低频使用时会留下大量空白天。
 *
 * [为什么聚合在 SQL 里做而不是全查出来在内存算]
 *   台账可达数千行，全量取回再算会随保留上限线性变慢。
 *   聚合只回 `byAction` 的分组行（≤6 行）与 totals 一行，与台账总行数无关。
 */
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  AI_USAGE_KEEP,
  AI_USAGE_PAGE_MAX,
  AI_USAGE_WINDOW_DEFAULT_DAYS,
  type AiUsageByAction,
  type AiUsageRecord,
  type AiUsageRow,
  type AiUsageStatus,
  type AiUsageTotals,
  type AiUsageView,
  computeSuccessRate,
} from '@mizuki/shared';
import { logger } from '../../common/logger';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { aiUsage } from '../../infra/db/schema';

/** 聚合中间形态（SQL 结果 → 视图字段的过渡） */
interface AggregateRow {
  action: string | null;
  calls: number;
  okCalls: number;
  errorCalls: number;
  abortedCalls: number;
  tokenSamples: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
}

@Injectable()
export class AiUsageService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  /**
   * 记一笔用量。**永不抛出**（见文件头「写入纪律」）。
   *
   * @param record 已由调用方构造好的记录（字段语义见 shared/ai-usage.ts）
   */
  async record(record: AiUsageRecord): Promise<void> {
    try {
      await this.db.insert(aiUsage).values({
        id: nanoid(),
        createdAt: new Date(),
        action: record.action,
        scene: record.scene,
        profileId: record.profileId,
        model: record.model,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        durationMs: record.durationMs,
        status: record.status,
        errorCode: record.errorCode,
      });
    } catch (error) {
      // 只 warn：记账失败不得影响主响应
      logger.warn({ err: error, scene: record.scene }, 'AI 用量记录写入失败（已忽略，不影响主流程）');
      return;
    }
    // 保留策略同样在旁路里：清理失败也不能影响主流程
    try {
      await this.enforceRetention();
    } catch (error) {
      logger.warn({ err: error }, 'AI 用量台账清理失败（已忽略）');
    }
  }

  /**
   * 保留策略：行数超过上限时，删除最旧的超出部分。
   * 一次性批量删（`lt(cutoff)`），不逐行 —— 逐行删在超限多时会是 N 次写事务。
   */
  private async enforceRetention(): Promise<void> {
    const [countRow] = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(aiUsage);
    const total = countRow?.value ?? 0;
    if (total <= AI_USAGE_KEEP) {
      return;
    }
    // 找出「第 AI_USAGE_KEEP 新」那一行的时间，删掉比它更旧的全部
    const boundary = await this.db
      .select({ createdAt: aiUsage.createdAt })
      .from(aiUsage)
      .orderBy(desc(aiUsage.createdAt))
      .limit(1)
      .offset(AI_USAGE_KEEP - 1);
    const cutoff = boundary[0]?.createdAt;
    if (cutoff === undefined) {
      return;
    }
    await this.db.delete(aiUsage).where(lt(aiUsage.createdAt, cutoff));
    logger.info({ total, cutoff: cutoff.toISOString() }, 'AI 用量台账超出上限，已清理最旧记录');
  }

  /**
   * 查询用量视图（窗口内 totals + byAction + 最近明细）。
   *
   * @param days 窗口天数（缺省 `AI_USAGE_WINDOW_DEFAULT_DAYS`）
   */
  async query(days?: number): Promise<AiUsageView> {
    const windowDays = days ?? AI_USAGE_WINDOW_DEFAULT_DAYS;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const windowFilter = gte(aiUsage.createdAt, since);

    const grouped = await this.db
      .select({
        action: aiUsage.action,
        calls: sql<number>`count(*)`,
        okCalls: sql<number>`sum(case when ${aiUsage.status} = 'ok' then 1 else 0 end)`,
        errorCalls: sql<number>`sum(case when ${aiUsage.status} = 'error' then 1 else 0 end)`,
        abortedCalls: sql<number>`sum(case when ${aiUsage.status} = 'aborted' then 1 else 0 end)`,
        // token 样本量：**只数非 null 的行**（见 shared/ai-usage.ts 文件头 ②）
        tokenSamples: sql<number>`sum(case when ${aiUsage.totalTokens} is not null then 1 else 0 end)`,
        // coalesce 保证「无 token 样本」时求和为 0 而非 null
        promptTokens: sql<number>`coalesce(sum(${aiUsage.promptTokens}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${aiUsage.completionTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)`,
        avgDurationMs: sql<number>`coalesce(round(avg(${aiUsage.durationMs})), 0)`,
      })
      .from(aiUsage)
      .where(windowFilter)
      .groupBy(aiUsage.action)
      .orderBy(desc(sql`count(*)`));

    const byAction = grouped.map((row) => this.toByAction(row));

    const recent = await this.db
      .select()
      .from(aiUsage)
      .where(windowFilter)
      .orderBy(desc(aiUsage.createdAt))
      .limit(AI_USAGE_PAGE_MAX);

    const [retained] = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(aiUsage);

    return {
      windowDays,
      totals: this.sumTotals(byAction),
      byAction,
      recent: recent.map((row) => this.toRow(row)),
      retainedRows: retained?.value ?? 0,
      keepLimit: AI_USAGE_KEEP,
    };
  }

  /** SQL 分组行 → 视图行（数字字段统一走 Number，防 better-sqlite3 的 number|null） */
  private toByAction(row: AggregateRow): AiUsageByAction {
    return {
      action: (row.action ?? null) as AiUsageByAction['action'],
      calls: Number(row.calls ?? 0),
      okCalls: Number(row.okCalls ?? 0),
      errorCalls: Number(row.errorCalls ?? 0),
      abortedCalls: Number(row.abortedCalls ?? 0),
      tokenSamples: Number(row.tokenSamples ?? 0),
      promptTokens: Number(row.promptTokens ?? 0),
      completionTokens: Number(row.completionTokens ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      avgDurationMs: Number(row.avgDurationMs ?? 0),
    };
  }

  /** 由分组行累加出总计（避免再发一次全表聚合查询） */
  private sumTotals(byAction: readonly AiUsageByAction[]): AiUsageTotals {
    const totals = byAction.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        okCalls: acc.okCalls + row.okCalls,
        errorCalls: acc.errorCalls + row.errorCalls,
        abortedCalls: acc.abortedCalls + row.abortedCalls,
        tokenSamples: acc.tokenSamples + row.tokenSamples,
        promptTokens: acc.promptTokens + row.promptTokens,
        completionTokens: acc.completionTokens + row.completionTokens,
        totalTokens: acc.totalTokens + row.totalTokens,
        durationSum: acc.durationSum + row.avgDurationMs * row.calls,
      }),
      {
        calls: 0,
        okCalls: 0,
        errorCalls: 0,
        abortedCalls: 0,
        tokenSamples: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationSum: 0,
      },
    );
    return {
      calls: totals.calls,
      okCalls: totals.okCalls,
      errorCalls: totals.errorCalls,
      abortedCalls: totals.abortedCalls,
      tokenSamples: totals.tokenSamples,
      promptTokens: totals.promptTokens,
      completionTokens: totals.completionTokens,
      totalTokens: totals.totalTokens,
      avgDurationMs: totals.calls === 0 ? 0 : Math.round(totals.durationSum / totals.calls),
      successRate: computeSuccessRate(totals.okCalls, totals.errorCalls),
    };
  }

  /** 明细行 → 视图行（时间转 ISO 字符串，前端无需处理时间戳） */
  private toRow(row: typeof aiUsage.$inferSelect): AiUsageRow {
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      scene: row.scene as AiUsageRow['scene'],
      action: (row.action ?? null) as AiUsageRow['action'],
      profileId: row.profileId,
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      durationMs: row.durationMs,
      status: row.status as AiUsageStatus,
      errorCode: row.errorCode,
    };
  }

  /** 按状态计数（供单测与将来「只看失败」筛选用） */
  async countByStatus(status: AiUsageStatus): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(aiUsage)
      .where(and(eq(aiUsage.status, status)));
    return row?.value ?? 0;
  }
}
