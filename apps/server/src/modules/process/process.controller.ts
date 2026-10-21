/**
 * [阶段 P9] process/process.controller — 子进程任务与 SSE 日志接口
 * [职责] MASTER-PLAN §5 Process 路由清单逐字（全部需认证，P6 全局守卫）：
 *   POST   /admin/process/tasks          启动（白名单校验）
 *   GET    /admin/process/tasks/:id      状态
 *   DELETE /admin/process/tasks/:id      停止（tree-kill 整组）
 *   GET    /admin/process/tasks/:id/logs SSE 日志（回放缓冲 + 实时推送）
 *   GET    /admin/process/ports/:port    端口占用检测
 * [U3-P3/K4] 增补任务运行历史（纯增量，既有路由一行不动）：
 *   GET    /admin/process/runs           历史分页列表（started_at 倒序，不含 log_text）
 *   GET    /admin/process/runs/:id       历史详情（含 log_text）
 *   DELETE /admin/process/runs/:id       删除单条历史
 * [U3-P3/K5] 增补任务模板（白名单任务命名预设，零新执行面）：
 *   GET    /admin/process/templates      模板列表（config.json tasks 键，活取）
 * [U3-P4a/K3] 增补任务级环境变量（写后不可读，值按 secret 处理）：
 *   GET    /admin/process/task-env       掩码列表（{ key, masked }，按 key 字典序）
 *   PUT    /admin/process/task-env       整表写入（entries + keep?；均空 = 清空；越界 400 零写盘）
 * [状态] ACTIVE
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, type MessageEvent, Param, Post, Put, Query, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { PutTaskEnvBodySchema, type PutTaskEnvBody, type TaskEnvView } from '@mizuki/shared';
import { clampIntParam } from '../../common/http/pagination';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { getAppConfig } from '../../config/app-config';
import {
  PortParamSchema,
  ProcessManagerService,
  ProcessTaskIdSchema,
  StartTaskBodySchema,
  type ProcessTaskName,
} from './process-manager.service';
import { TaskRunsService } from './task-runs.service';

/** [U3-P3/K4] 历史列表分页上限（防御深分页，同 /admin/system/logs 口径） */
const RUNS_MAX_LIMIT = 100;

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/process')
export class ProcessController {
  constructor(
    private readonly manager: ProcessManagerService,
    private readonly runs: TaskRunsService,
  ) {}

  @ApiOperation({ summary: '启动子进程任务（body.task 白名单校验）' })
  @Post('tasks')
  start(@Body(new ZodValidationPipe(StartTaskBodySchema)) body: { task: ProcessTaskName }) {
    return this.manager.startTask(body.task);
  }

  @ApiOperation({ summary: '任务状态查询' })
  @Get('tasks/:id')
  status(@Param('id', new ZodValidationPipe(ProcessTaskIdSchema)) id: string) {
    return this.manager.getTask(id);
  }

  @ApiOperation({ summary: '停止任务（tree-kill 整组进程）' })
  @Delete('tasks/:id')
  @HttpCode(HttpStatus.OK)
  stop(@Param('id', new ZodValidationPipe(ProcessTaskIdSchema)) id: string) {
    return this.manager.stopTask(id);
  }

  /** SSE：先回放环形缓冲，再实时推送；任务终态 → 发 exit 事件后完成流 */
  @ApiOperation({ summary: '任务日志 SSE 流（先回放环形缓冲，再实时推送）' })
  @Sse('tasks/:id/logs')
  logs(@Param('id', new ZodValidationPipe(ProcessTaskIdSchema)) id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const detach = this.manager.attachLogListener(id, {
        onEvent: (event) => {
          subscriber.next({ data: event });
        },
        onComplete: () => {
          subscriber.complete();
        },
      });
      return () => {
        detach(); // 连接断开清理订阅（不得泄漏监听）
      };
    });
  }

  @ApiOperation({ summary: '端口占用检测（:port）' })
  @Get('ports/:port')
  probe(@Param('port', new ZodValidationPipe(PortParamSchema)) port: string) {
    return this.manager.probePort(Number(port));
  }

  // ── [U3-P3/K4] 任务运行历史（纯增量） ──

  /** 历史分页列表：?page=&limit=（clamp 口径，默认 20 上限 100），started_at 倒序 */
  @ApiOperation({ summary: '任务运行历史分页列表（?page=&limit=，limit 上限 100，started_at 倒序）' })
  @Get('runs')
  listRuns(@Query('page') pageRaw?: string, @Query('limit') limitRaw?: string) {
    const page = clampIntParam(pageRaw, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = clampIntParam(limitRaw, 20, 1, RUNS_MAX_LIMIT);
    return this.runs.list(page, limit);
  }

  /** 历史详情：含完整 log_text；不存在 → 404 */
  @ApiOperation({ summary: '任务运行历史详情（含 log_text）' })
  @Get('runs/:id')
  runDetail(@Param('id', new ZodValidationPipe(ProcessTaskIdSchema)) id: string) {
    return this.runs.detail(id);
  }

  /** 删除单条历史；不存在 → 404（删除形态对齐 albums/media DELETE 惯例） */
  @ApiOperation({ summary: '删除单条任务运行历史' })
  @Delete('runs/:id')
  @HttpCode(HttpStatus.OK)
  deleteRun(@Param('id', new ZodValidationPipe(ProcessTaskIdSchema)) id: string) {
    return this.runs.remove(id);
  }

  // ── [U3-P3/K5] 任务模板 ──

  /**
   * 任务模板列表：白名单任务的命名快捷预设（config.json `tasks` 键）。
   * 活取（getAppConfig() 每请求，P11 坑 5 先例）——改配置不必重启进程。
   * 模板不含 cmd/args/shell：面板只渲染按钮，点击走既有 startTask(task) 白名单链路。
   */
  @ApiOperation({ summary: '任务模板列表（白名单任务命名预设，config.json tasks 键活取）' })
  @Get('templates')
  listTemplates(): { items: { name: string; task: ProcessTaskName; description?: string }[] } {
    return { items: getAppConfig().tasks };
  }

  // ── [U3-P4a/K3] 任务级环境变量（写后不可读） ──

  /**
   * 掩码列表：`{ items: [{ key, masked }] }`，按 key 字典序；空表 → `items: []`。
   * [K4/I5] 明文永不出现在任何响应里——连 PUT 的回执也只有掩码。
   */
  @ApiOperation({ summary: '任务环境变量列表（掩码，按 key 字典序，明文永不回显）' })
  @Get('task-env')
  listTaskEnv(): TaskEnvView {
    return this.manager.listTaskEnv();
  }

  /**
   * 整表写入任务环境变量：body `{ entries: Record<string,string>, keep?: string[] }`。
   * - `entries` 与 `keep` 均空/缺省 = 清空（合法）；旧「整表替换」语义逐字保留；
   * - [U3-P4c/K-keep] `keep` = 不重输值要保留的既有键（服务端合成，entries 优先）；
   *   keep 含未知键 → 400 `keep-unknown-key`；keep 与 entries 同键 → 400 `keep-conflict`；
   * - 三条约束由 shared 的 TaskEnvRecordSchema 在管道层校验（合成结果再复检），越界 400 零写盘；
   * - 成功返回与 GET 同形的掩码视图（值按 secret 处理，保存后不可再查看）。
   */
  @ApiOperation({ summary: '整表写入任务环境变量（keep 保留既有键；值保存后不可再查看）' })
  @Put('task-env')
  @HttpCode(HttpStatus.OK)
  putTaskEnv(
    @Body(new ZodValidationPipe(PutTaskEnvBodySchema)) body: PutTaskEnvBody,
  ): TaskEnvView {
    return this.manager.putTaskEnv(body);
  }
}
