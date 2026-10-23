/**
 * [阶段 P6] common/interceptors/operation-log.interceptor — 操作审计日志
 * [职责] 全局拦截器：对管理端写操作（POST/PATCH/DELETE 且路径位于
 *   /api/v1/admin/**）写 operation_log 表；detail 脱敏（硬性：密码 /
 *   token / secret / authorization 一律掩码，P6 §3.6）；
 *   异步写入失败仅记 pino 日志，不影响响应。
 * [U4-AI1/F1] 敏感词表补 `apikey`（键名先归一小写+去 `_`/`-` 再比较）：
 *   否则 `apiKey` / `api_key` 会以明文进 operation_log.detail。
 * [U4-AI1/F2] `/admin/ai/chat` 不记 body（含整篇正文），只记
 *   `{ action, messagesCount, contextChars }` 摘要。
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

/** 脱敏命中词（键名归一后包含即掩码；覆盖 password/token/secret/authorization 等）
 * [U4-AI1/F1] 追加 `apikey`：AI 配置的 key 字段名有三种常见写法（apiKey / api_key /
 *   API-KEY），归一（小写 + 去 `_` `-`）后都落到 `apikey`，一处判定覆盖全部变体。 */
const SENSITIVE_KEY_HINTS = [
  'password',
  'token',
  'secret',
  'authorization',
  'credential',
  'apikey',
];
const MASK = '***';

/** [U4-AI1/F2] 流式对话路由：body 含正文（context.text / messages[].content），
 *  整包入库等于把文章再存一遍，且会让 operation_log 无界膨胀。只记摘要三项。 */
const AI_CHAT_PATH = '/api/v1/admin/ai/chat';

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
  // [U4-AI1/F2] chat 的 body 是「正文 + 消息」：整包入库会造成正文重复存储与库膨胀。
  // 该路由只落摘要三项（action / messagesCount / contextChars），正文一个字都不进库。
  if (request.path === AI_CHAT_PATH) {
    return summarizeAiChat(request.body);
  }
  const detail: Record<string, unknown> = {
    body: sanitizeAuditValue(request.body),
  };
  if (request.headers['authorization'] !== undefined) {
    detail['headers'] = { authorization: MASK };
  }
  return detail;
}

/**
 * [U4-AI1/F2] AI 对话的审计摘要：只有三项，且都不含正文。
 * `action` 未提供时省略该键（前端可以不带 action 直接聊）。
 */
function summarizeAiChat(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { messagesCount: 0, contextChars: 0 };
  }
  const record = body as Record<string, unknown>;
  const messages = Array.isArray(record['messages']) ? record['messages'] : [];
  const rawContext = record['context'];
  const context =
    typeof rawContext === 'object' && rawContext !== null && !Array.isArray(rawContext)
      ? (rawContext as Record<string, unknown>)
      : undefined;
  const contextText = context !== undefined && typeof context['text'] === 'string' ? context['text'] : '';
  const action = typeof record['action'] === 'string' ? record['action'] : undefined;
  return {
    ...(action !== undefined ? { action } : {}),
    messagesCount: messages.length,
    contextChars: contextText.length,
  };
}

/** 键名归一：小写 + 去 `_`/`-`（`api_key` / `API-KEY` / `apiKey` → `apikey`） */
function normalizeKeyName(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/**
 * 递归脱敏：敏感键 → '***'；对象/数组深度遍历；其余原样。
 * 导出供单测直接覆盖两类键名（`apiKey` / `api_key`，[U4-AI1/K13]）。
 */
export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeKeyName(key);
      if (SENSITIVE_KEY_HINTS.some((hint) => normalized.includes(hint))) {
        result[key] = MASK;
      } else {
        result[key] = sanitizeAuditValue(entry);
      }
    }
    return result;
  }
  return value;
}
