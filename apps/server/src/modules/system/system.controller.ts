/**
 * [阶段 P0a] System 控制器
 * [职责] 健康检查（@Public 豁免，含 initialized 标志）。
 * [阶段 P6] 扩展：GET /system/status（需认证）、POST /system/detect（@Public）、
 *   POST /system/init（@Public，仅未初始化时可用一次）、
 *   GET /admin/system/logs（operation_log 分页读取，规格补白，见交付报告疑问清单）。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { getAppConfig } from '../../config/app-config';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { operationLog } from '../../infra/db/schema';
import { z } from 'zod';
import { AuthService, InitBodySchema, type InitBody } from '../auth/auth.service';
import { MizukiDetectorService, type DetectResult } from './mizuki-detector.service';

/** POST /system/detect body */
const DetectBodySchema = z.object({
  path: z.string().min(1),
});

/** 日志分页参数上限（防御深分页） */
const LOGS_MAX_LIMIT = 100;

@Controller()
export class SystemController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly authService: AuthService,
    private readonly detector: MizukiDetectorService,
  ) {}

  /** 健康检查（@Public）：P6 起附加 initialized（admin_user 是否存在行） */
  @Public()
  @Get('system/health')
  async getHealth(): Promise<{ status: string; service: string; uptime: number; initialized: boolean }> {
    return {
      status: 'ok',
      service: 'mizuki-server',
      uptime: process.uptime(),
      initialized: await this.authService.isInitialized(),
    };
  }

  /** 服务状态（需认证）：已初始化 / 运行模式 / 版本 */
  @Get('system/status')
  async getStatus(): Promise<{ initialized: boolean; mode: string; version: string; uptime: number }> {
    const config = getAppConfig();
    return {
      initialized: await this.authService.isInitialized(),
      mode: config.mode,
      version: readServerVersion(),
      uptime: process.uptime(),
    };
  }

  /** Mizuki 目录检测（@Public，初始化向导前置）：四项检查 + 包管理器探测 */
  @Public()
  @Post('system/detect')
  @HttpCode(HttpStatus.OK)
  detect(@Body(new ZodValidationPipe(DetectBodySchema)) body: { path: string }): DetectResult {
    return this.detector.detect(body.path);
  }

  /** 一次性初始化（@Public）：已初始化 → 409；检测失败 → 400 附明细 */
  @Public()
  @Post('system/init')
  init(@Body(new ZodValidationPipe(InitBodySchema)) body: InitBody) {
    return this.authService.initialize(body);
  }

  /**
   * 操作日志分页读取（规格补白：MASTER-PLAN §5 未列，处理方式同 P8 settings
   * 路径补白，见交付报告疑问清单）。?page=&limit=，created_at 倒序。
   */
  @Get('admin/system/logs')
  async getLogs(@Query('page') pageRaw?: string, @Query('limit') limitRaw?: string) {
    const page = clampInt(pageRaw, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(limitRaw, 20, 1, LOGS_MAX_LIMIT);
    const rows = await this.db
      .select()
      .from(operationLog)
      .orderBy(desc(operationLog.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const counted = await this.db.select({ total: sql<number>`count(*)` }).from(operationLog);
    return {
      page,
      limit,
      total: counted[0]?.total ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        method: row.method,
        path: row.path,
        action: row.action,
        target: row.target,
        detail: row.detail,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

// ── 纯工具 ──

/** 版本号：读 apps/server/package.json（src 与 dist 相对层级一致） */
function readServerVersion(): string {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    if (typeof raw === 'object' && raw !== null) {
      const version = (raw as Record<string, unknown>)['version'];
      if (typeof version === 'string') {
        return version;
      }
    }
  } catch {
    // 读取失败返回 unknown，不阻塞状态端点
  }
  return 'unknown';
}

/** 分页参数解析与收敛（非法/缺省 → 默认值） */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}
