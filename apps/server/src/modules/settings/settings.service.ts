/**
 * [阶段 P8] settings/settings.service — 运行态设置（key-value JSON）
 * [职责] `site_setting` 表（key text PK / value text(JSON)）读写；
 *   仅存运行态配置（启动配置在 data/config.json，不得混用，P8 §3.7）；
 *   写入成功后发射 content.changed（scope='settings'，filePaths=[]）。
 * [状态] ACTIVE
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ContentChangedPayload, EVENTS } from '@mizuki/shared';
import { logger } from '../../common/logger';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { siteSetting } from '../../infra/db/schema';

/** key 规范：安全字符集（PK 文本，避免空白/控制符） */
export const SettingKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'key 仅允许字母、数字、_ . : -');

/** PUT body：value 任意 JSON 值（序列化为文本存储） */
export const PutSettingBodySchema = z.object({
  value: z.unknown(),
});

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly emitter: EventEmitter2,
  ) {}

  /** 全量键值（value 反序列化为 JSON 值） */
  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(siteSetting);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = safeJsonParse(row.value);
    }
    return result;
  }

  /** 设置单键（upsert）→ 发射 content.changed(scope='settings') */
  async put(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    const serialized = JSON.stringify(value);
    await this.db
      .insert(siteSetting)
      .values({ key, value: serialized })
      .onConflictDoUpdate({ target: siteSetting.key, set: { value: serialized } });
    this.emitChanged();
    logger.info({ key }, '设置写入完成');
    return { key, value };
  }

  /** 删除单键（不存在 → 404）→ 发射 content.changed(scope='settings') */
  async delete(key: string): Promise<{ deleted: true }> {
    const rows = await this.db.select().from(siteSetting).where(eq(siteSetting.key, key));
    if (rows.length === 0) {
      throw new NotFoundException(`设置项不存在：${key}`);
    }
    await this.db.delete(siteSetting).where(eq(siteSetting.key, key));
    this.emitChanged();
    logger.info({ key }, '设置删除完成');
    return { deleted: true };
  }

  /** content.changed（scope='settings'，filePaths=[]，§4.4 事件表 settings 行） */
  private emitChanged(): void {
    const payload = ContentChangedPayload.parse({ scope: 'settings', filePaths: [] });
    this.emitter.emit(EVENTS.ContentChanged, payload);
  }
}

// ── 纯工具 ──

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw; // 历史脏数据按原文返回，不阻塞读取
  }
}
