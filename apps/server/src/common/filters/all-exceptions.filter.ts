/**
 * [阶段 P0b] common/filters/all-exceptions.filter — 统一异常格式
 * [职责] 所有异常响应统一为 { code, message, detail }：
 *   - HttpException：HTTP 状态码照旧，code 取异常类型名，detail 放可选细节（如校验 issues）；
 *   - 未知异常：500，code 'InternalError'，message 对外固定「内部服务器错误」，
 *     堆栈仅记日志（pino error 级），不泄露给客户端。
 * [状态] ACTIVE
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { logger } from '../logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = exception.constructor.name;
      const message = exception.message;
      const detail = this.extractDetail(exception);

      const requestUrl = host.switchToHttp().getRequest<{ url?: string }>()?.url;
      logger.warn({ status, code, path: requestUrl }, message);

      response.status(status).json({ code, message, detail });
      return;
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    logger.error({ err: error }, '未处理异常');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'InternalError',
      message: '内部服务器错误',
      detail: null,
    });
  }

  /** 从异常响应体提取可选细节（如 zod / class-validator 的 issues 数组） */
  private extractDetail(exception: HttpException): unknown {
    const body: unknown = exception.getResponse();
    if (typeof body !== 'object' || body === null) {
      return null;
    }
    const record = body as Record<string, unknown>;
    if ('detail' in record) {
      return record['detail'] ?? null;
    }
    if (Array.isArray(record['message'])) {
      return { issues: record['message'] };
    }
    return null;
  }
}
