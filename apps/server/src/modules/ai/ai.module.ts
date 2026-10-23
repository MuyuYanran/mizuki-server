/**
 * [U4-AI1/K1] ai/ai.module — AI 接入模块（配置 + 出站闸 + 流式代理）
 * [职责] 只依赖 L0（`common/`、`config/`、`@mizuki/shared`），**不 import 任何领域
 *   模块**——本期服务端零领域依赖（不读文章、不落盘内容），上下文由前端组装。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { AiConfigService } from './ai-config.service';
import { AiController } from './ai.controller';

@Module({
  controllers: [AiController],
  providers: [AiConfigService, AiChatService],
})
export class AiModule {}
