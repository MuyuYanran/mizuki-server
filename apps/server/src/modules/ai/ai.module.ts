/**
 * [U4-AI1/K1] ai/ai.module — AI 接入模块（配置 + 出站闸 + 流式代理 + 用量台账）
 * [职责] 只依赖 L0（`common/`、`config/`、`infra/db`、`@mizuki/shared`），
 *   **不 import 任何领域模块**——服务端零领域依赖（不读文章、不落盘内容），
 *   上下文由前端组装。
 * [U4-AI3/A] 新增 AiUsageService（用量台账）：`DbModule` 是 @Global，无需在 imports 声明。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { AiConfigService } from './ai-config.service';
import { AiController } from './ai.controller';
import { AiUsageService } from './ai-usage.service';

@Module({
  controllers: [AiController],
  providers: [AiConfigService, AiChatService, AiUsageService],
})
export class AiModule {}
