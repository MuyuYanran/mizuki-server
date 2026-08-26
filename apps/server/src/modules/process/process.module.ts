/**
 * [阶段 P9] process 模块
 * [职责] 白名单子进程任务管理 + SSE 日志推送（L3 编排层，仅依赖 L0）。
 *   优雅停机：ProcessManagerService 实现 OnApplicationShutdown，
 *   经 main.ts 的 app.enableShutdownHooks() 接收 SIGTERM/SIGINT。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { ProcessController } from './process.controller';
import { ProcessManagerService } from './process-manager.service';

@Module({
  controllers: [ProcessController],
  providers: [ProcessManagerService],
})
export class ProcessModule {}
