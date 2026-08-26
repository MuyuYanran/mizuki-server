/**
 * [阶段 P6] common/interceptors/operation-log.interceptor — 操作审计日志
 * [职责] 全局拦截器：对管理端写操作（POST/PATCH/DELETE 且路径位于
 *   /api/v1/admin/**）写 operation_log 表；detail 脱敏（硬性：密码 /
 *   token / secret / authorization 一律掩码，P6 §3.6）；
 *   异步写入失败仅记 pino 日志，不影响响应。
 * [状态] ACTIVE
 *
 * 接线：经 app.module.ts 的 APP_INTERCEPTOR 注册（依赖 DRIZZLE_DB 注入；
 * 与 P6 §4.3 的 useGlobalInterceptors 等效，取舍见交付报告）。
 */
import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { nanoid } from 'nanoid';
import { logger } from '../logger';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { operationLog } from '../../infra/db/schema';

/** 审计范围：管理端写操作（P6 §3.6 逐字：POST/PATCH/DELETE + /admin/**） */
const AUDITED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
const ADMIN_PATH_PREFIX = '/api/v1/admin/';

/** 脱敏命中词（键名小写包含即掩码；覆盖 password/token/secret/authorization 等） */
const SENSITIVE_KEY_HINTS = ['password', 'token', 'secret', 'authorization', 'credential'];
const MASK = '***';

/** 拦截器可见的最小请求结构 */
interface AuditedRequest {
  method: string;
  path: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  authUser?: { id: string };
}

@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    if (!AUDITED_METHODS.has(request.method) || !request.path.startsWith(ADMIN_PATH_PREFIX)) {
      return next.handle();
    }
    return next.handle().pipe(
      tap(() => {
        // 异步写入：失败仅记日志，绝不影响响应（P6 §3.6）
        this.writeLog(request).catch((error) => {
          logger.error({ err: error }, '操作日志写入失败（不影响响应）');
        });
      }),
    );
  }

  private async writeLog(request: AuditedRequest): Promise<void> {
    await this.db.insert(operationLog).values({
      id: nanoid(),
      userId: request.authUser?.id ?? null,
      method: request.method,
      path: request.path,
      action: request.method,
      target: request.path.slice('/api/v1'.length) || '/',
      detail: JSON.stringify(buildDetail(request)),
      ip: request.ip ?? 'unknown',
      createdAt: new Date(),
    });
  }
}

// ── 纯工具 ──

/** detail 组装：body 递归脱敏 + authorization 头掩码（其余头不入库） */
function buildDetail(request: AuditedRequest): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    body: sanitizeValue(request.body),
  };
  if (request.headers['authorization'] !== undefined) {
    detail['headers'] = { authorization: MASK };
  }
  return detail;
}

/** 递归脱敏：敏感键 → '***'；对象/数组深度遍历；其余原样 */
function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEY_HINTS.some((hint) => lowerKey.includes(hint))) {
        result[key] = MASK;
      } else {
        result[key] = sanitizeValue(entry);
      }
    }
    return result;
  }
  return value;
}
