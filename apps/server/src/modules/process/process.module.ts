/**
 * [阶段 P9] process 模块
 * [职责] 白名单子进程任务管理 + SSE 日志推送（L3 编排层，仅依赖 L0）。
 *   优雅停机：ProcessManagerService 实现 OnApplicationShutdown，
 *   经 main.ts 的 app.enableShutdownHooks() 接收 SIGTERM/SIGINT。
 * [U3-P3] 增补任务运行历史（K3/K4）：task_run 表读写 + runs 三端点。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { ProcessController } from './process.controller';
import { ProcessManagerService } from './process-manager.service';
import { TaskRunsService } from './task-runs.service';

@Module({
  controllers: [ProcessController],
  providers: [ProcessManagerService, TaskRunsService],
})
export class ProcessModule {}
