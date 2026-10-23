/**
 * [U4-AI1/K1] ai/ai.controller — AI 接入路由（4 个端点，全部 JWT 保护）
 * [职责] 逐字对齐 U4-AI1 §4：
 *   GET  /admin/ai/config   只读视图（key 只回 maskedKey）
 *   PUT  /admin/ai/config   部分更新（深合并 + keepApiKey 语义），回读视图
 *   POST /admin/ai/ping     连通性测试（5 次/分），失败只给分类码
 *   POST /admin/ai/chat     流式对话（20 次/分），SSE
 * [状态] ACTIVE
 *
 * 为什么不用 `@Sse()`：Nest 的 `@Sse()` 只支持 GET，而 chat 需要 POST body
 * （messages + context），P9 的日志流能那样写是因为它无 body。这里用原生
 * `@Res()` 自己写头与帧（§5-7）。
 *
 * 限流：`@Throttle` 覆盖全局 60/分的默认值，只对该路由生效（与 auth 登录同一
 * 机制）；chat 的 20/分是「每次都可能烧 token」的成本闸（K10）。
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AiChatBodySchema,
  AiPutConfigBodySchema,
  type AiChatBody,
  type AiConfigView,
  type AiPutConfigBody,
} from '@mizuki/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AiChatService, type AiPingResult } from './ai-chat.service';
import { AiConfigService } from './ai-config.service';

@ApiTags('管理')
@ApiBearerAuth()
@Controller('admin/ai')
export class AiController {
  constructor(
    private readonly config: AiConfigService,
    private readonly chat: AiChatService,
  ) {}

  @ApiOperation({ summary: 'AI 配置（只读视图，key 只回掩码）' })
  @Get('config')
  getConfig(): AiConfigView {
    return this.config.view();
  }

  @ApiOperation({ summary: '保存 AI 配置（部分更新：深合并 + keepApiKey 保留既有 key）' })
  @Put('config')
  @HttpCode(HttpStatus.OK)
  putConfig(
    @Body(new ZodValidationPipe(AiPutConfigBodySchema)) body: AiPutConfigBody,
  ): AiConfigView {
    return this.config.save(body);
  }

  @ApiOperation({ summary: '连通性测试（activeProfile，max_tokens=8；失败只回分类码）' })
  @Post('ping')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 次/分（§4）
  @HttpCode(HttpStatus.OK)
  ping(): Promise<AiPingResult> {
    return this.chat.ping();
  }

  /**
   * 流式对话。`@Res()` 原生响应：本方法自己写 SSE 头与帧；
   * 首字节前的失败仍走异常（全局过滤器出 JSON），首字节后只发 `event: error`。
   */
  @ApiOperation({ summary: '流式对话（SSE：event: delta / usage / done / error）' })
  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // 20 次/分（§4/K10）
  @HttpCode(HttpStatus.OK)
  async chatStream(
    @Body(new ZodValidationPipe(AiChatBodySchema)) body: AiChatBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.chat.stream(body, req, res);
  }
}
