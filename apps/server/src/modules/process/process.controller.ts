/**
 * [阶段 P9] process/process.controller — 子进程任务与 SSE 日志接口
 * [职责] MASTER-PLAN §5 Process 路由清单逐字（全部需认证，P6 全局守卫）：
 *   POST   /admin/process/tasks          启动（白名单校验）
 *   GET    /admin/process/tasks/:id      状态
 *   DELETE /admin/process/tasks/:id      停止（tree-kill 整组）
 *   GET    /admin/process/tasks/:id/logs SSE 日志（回放缓冲 + 实时推送）
 *   GET    /admin/process/ports/:port    端口占用检测
 * [状态] ACTIVE
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, type MessageEvent, Param, Post, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  PortParamSchema,
  ProcessManagerService,
  ProcessTaskIdSchema,
  StartTaskBodySchema,
  type ProcessTaskName,
} from './process-manager.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/process')
export class ProcessController {
  constructor(private readonly manager: ProcessManagerService) {}

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
}
