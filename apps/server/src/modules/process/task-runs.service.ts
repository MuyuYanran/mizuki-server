/**
 * [U3-P3/K4] process/task-runs.service — 任务运行历史查询
 * [职责] task_run 表的读/删（列表分页、单条详情含 log_text、删除）。
 * [状态] ACTIVE
 *
 * 与 process-manager 的分工：
 *   - process-manager：写（启动行 / 退出更新，best-effort，不在失败路径抛错）；
 *   - 本服务：读/删（管理面 REST，独立于任务内存态——历史跨重启可见）。
 *
 * 分层：process（L3）仅依赖 L0（infra/db），不 import 其他领域模块。
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { taskRun } from '../../infra/db/schema';
import { truncateLogText } from './log-truncate';

/** 历史列表项（不含 log_text——列表端点零大字段，详情端点才给） */
export interface TaskRunListItem {
  id: string;
  task: string;
  commandSnapshot: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  /** 状态派生：finished_at 为空 → running（仍在跑）；否则按退出码区分 */
  status: 'running' | 'exited' | 'failed';
}

/** 历史详情（含完整 log_text） */
export interface TaskRunDetail extends TaskRunListItem {
  logText: string | null;
}

/** 分页响应 */
export interface TaskRunPage {
  page: number;
  limit: number;
  total: number;
  items: TaskRunListItem[];
}

@Injectable()
export class TaskRunsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  /**
   * 分页列表：started_at 倒序（最新在前）。
   * @param page 页码（≥1）
   * @param limit 每页条数（≤100，由控制器 clamp 口径保证）
   */
  async list(page: number, limit: number): Promise<TaskRunPage> {
    const rows = await this.db
      .select()
      .from(taskRun)
      .orderBy(desc(taskRun.startedAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const counted = await this.db.select({ total: sql<number>`count(*)` }).from(taskRun);
    return {
      page,
      limit,
      total: counted[0]?.total ?? 0,
      items: rows.map((row) => toListItem(row)),
    };
  }

  /** 单条详情（含 log_text）；不存在 → 404 */
  async detail(id: string): Promise<TaskRunDetail> {
    const row = await this.findById(id);
    if (row === undefined) {
      throw new NotFoundException('任务历史不存在');
    }
    // 读取端防御截断：写入侧已按 256KB 保尾截断（K3），此处再过一道同源截断，
    // 使「详情端点响应体 ≤256KB」成为强保证（脏数据/历史版本行也不外溢）。
    return { ...toListItem(row), logText: row.logText === null ? null : truncateLogText(row.logText) };
  }

  /** 删除单条历史；不存在 → 404 */
  async remove(id: string): Promise<{ deleted: true }> {
    const row = await this.findById(id);
    if (row === undefined) {
      throw new NotFoundException('任务历史不存在');
    }
    await this.db.delete(taskRun).where(eq(taskRun.id, id));
    return { deleted: true };
  }

  private async findById(id: string): Promise<typeof taskRun.$inferSelect | undefined> {
    const rows = await this.db.select().from(taskRun).where(eq(taskRun.id, id)).limit(1);
    return rows[0];
  }
}

/** 行 → 列表项（时间统一 ISO 字符串，与既有 TaskView / AlbumView 口径一致） */
function toListItem(row: typeof taskRun.$inferSelect): TaskRunListItem {
  const finished = row.finishedAt !== null;
  return {
    id: row.id,
    task: row.task,
    commandSnapshot: row.commandSnapshot,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    exitCode: row.exitCode,
    status: !finished ? 'running' : row.exitCode === 0 ? 'exited' : 'failed',
  };
}
