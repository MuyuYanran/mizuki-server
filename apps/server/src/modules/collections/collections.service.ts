/**
 * [阶段 P4] collections/collections.service — 六类集合 CRUD 编排
 * [职责] 基于 DataFileService（P3 引擎，唯一合法读写通道）实现六类内容的
 *   增删改查；每次写入成功出口发射 content.changed（scope='collection'）。
 *   禁止为六类内容建任何数据库表（文件即数据库，MASTER-PLAN §2 决策 1）。
 * [状态] ACTIVE
 *
 * 规则（P4 §3.3）：
 * - POST：无 id（devices 无 name）时自动生成 nanoid；id 冲突 → 409；
 * - PATCH/DELETE 目标不存在 → 404；
 * - grouped（devices）：POST body 含 group；DELETE 后空分组键自动清理；
 * - timeline POST 未给 icon/color 时按 type 填充默认映射（ADR-004）；
 * - 全部输入过 itemSchema（grouped 整体过 record schema）。
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ContentChangedPayload, EVENTS } from '@mizuki/shared';
import { logger } from '../../common/logger';
import { DataFileService } from '../data-files/data-file.service';
import type { CollectionDef } from './registry';

type Item = Record<string, unknown>;
type GroupedData = Record<string, Item[]>;

/**
 * timeline 按 type 的默认 icon/color。
 * [B4 修订] 官方文档（docs/refs/mizuki-docs/special-timeline.md §2/§3）使用
 *   Iconify 图标集；education 与 work 两类有文档示例可核对：
 *   education = material-symbols:school / #059669（§2 示例逐字）。
 *   官方 type 枚举为 education|work|project|achievement（§2），与当前
 *   TimelineTypeSchema（education|certificate|project|other）不一致——枚举
 *   与本表整体对齐属集合服务行为变更，转 B4 审计裁决（T2-g/T2-h）；
 *   certificate/project/other 三类无官方示例，暂定值保留并注记。
 */
const TIMELINE_DEFAULTS: Record<string, { icon: string; color: string }> = {
  education: { icon: 'material-symbols:school', color: '#059669' },
  certificate: { icon: 'award', color: '#f59e0b' }, // 暂定：无官方示例（ADR-004 注记）
  project: { icon: 'rocket', color: '#10b981' }, // 暂定：无官方示例（ADR-004 注记）
  other: { icon: 'star', color: '#8b5cf6' }, // 暂定：无官方示例（ADR-004 注记）
};

@Injectable()
export class CollectionsService {
  constructor(
    private readonly dataFiles: DataFileService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** 全量列表（array → 数组；grouped → 分组对象） */
  list(def: CollectionDef): unknown {
    return this.dataFiles.readCollection(def.file, def.varName);
  }

  /** 新增条目（grouped 时 input 须含 group 字段） */
  async create(def: CollectionDef, input: unknown): Promise<Item> {
    const item = def.shape === 'grouped' ? await this.createGrouped(def, input) : await this.createArray(def, input);
    this.emitChanged(def, 'create');
    return item;
  }

  /** 修改条目（按 idField 定位；grouped 时跨分组查找） */
  async update(def: CollectionDef, id: string, patchInput: unknown): Promise<Item> {
    const patch = stripGroup(patchInput);
    let updated: Item | undefined;
    if (def.shape === 'grouped') {
      await this.dataFiles.mutateCollection<GroupedData>(
        def.file,
        def.varName,
        (data) => {
          const located = locateGrouped(data, def.idField, id);
          if (!located) {
            throw new NotFoundException(`条目不存在：${def.type}/${id}`);
          }
          const merged = this.parseItemOrThrow(def, { ...located.item, ...patch });
          const renamed = String(merged[def.idField] ?? '');
          const group = data[located.group] ?? [];
          const conflict = group.some(
            (item) => item[def.idField] === renamed && item !== located.item,
          );
          if (conflict) {
            throw new ConflictException(`条目已存在：${def.type}/${renamed}`);
          }
          updated = merged;
          return { ...data, [located.group]: group.map((item) => (item === located.item ? merged : item)) };
        },
        groupedSchema(def),
      );
    } else {
      await this.dataFiles.mutateCollection<Item[]>(
        def.file,
        def.varName,
        (list) => {
          const index = list.findIndex((item) => item[def.idField] === id);
          if (index < 0) {
            throw new NotFoundException(`条目不存在：${def.type}/${id}`);
          }
          const merged = this.parseItemOrThrow(def, { ...list[index]!, ...patch });
          const newId = String(merged[def.idField] ?? '');
          if (list.some((item, i) => i !== index && item[def.idField] === newId)) {
            throw new ConflictException(`条目已存在：${def.type}/${newId}`);
          }
          updated = merged;
          return list.map((item, i) => (i === index ? merged : item));
        },
        def.itemSchema.array(),
      );
    }
    this.emitChanged(def, 'update');
    return updated!;
  }

  /** 删除条目（grouped 时自动清理空分组键） */
  async remove(def: CollectionDef, id: string): Promise<void> {
    if (def.shape === 'grouped') {
      await this.dataFiles.mutateCollection<GroupedData>(
        def.file,
        def.varName,
        (data) => {
          const located = locateGrouped(data, def.idField, id);
          if (!located) {
            throw new NotFoundException(`条目不存在：${def.type}/${id}`);
          }
          const remaining = (data[located.group] ?? []).filter((item) => item !== located.item);
          const next: GroupedData = { ...data };
          if (remaining.length === 0) {
            // 空分组清理：删除后数组为空的分组键直接移除
            delete next[located.group];
            logger.info({ type: def.type, group: located.group }, '空分组已清理');
          } else {
            next[located.group] = remaining;
          }
          return next;
        },
        groupedSchema(def),
      );
    } else {
      await this.dataFiles.mutateCollection<Item[]>(
        def.file,
        def.varName,
        (list) => {
          const index = list.findIndex((item) => item[def.idField] === id);
          if (index < 0) {
            throw new NotFoundException(`条目不存在：${def.type}/${id}`);
          }
          return list.filter((_, i) => i !== index);
        },
        def.itemSchema.array(),
      );
    }
    this.emitChanged(def, 'delete');
  }

  // ── 内部实现 ──

  private async createArray(def: CollectionDef, input: unknown): Promise<Item> {
    const raw = { ...(input as Item) };
    if (raw[def.idField] === undefined || raw[def.idField] === '') {
      raw[def.idField] = nanoid();
    }
    applyTimelineDefaults(def, raw);
    const item = this.parseItemOrThrow(def, raw);
    await this.dataFiles.mutateCollection<Item[]>(
      def.file,
      def.varName,
      (list) => {
        if (list.some((existing) => existing[def.idField] === item[def.idField])) {
          throw new ConflictException(`条目已存在：${def.type}/${String(item[def.idField])}`);
        }
        return [...list, item];
      },
      def.itemSchema.array(),
    );
    return item;
  }

  private async createGrouped(def: CollectionDef, input: unknown): Promise<Item> {
    const record = input as Item;
    const group = record['group'];
    if (typeof group !== 'string' || group === '') {
      throw new BadRequestException(`grouped 集合新增必须提供非空 group 字段：${def.type}`);
    }
    const raw: Item = { ...stripGroup(record) };
    if (raw[def.idField] === undefined || raw[def.idField] === '') {
      raw[def.idField] = nanoid();
    }
    const item = this.parseItemOrThrow(def, raw);
    await this.dataFiles.mutateCollection<GroupedData>(
      def.file,
      def.varName,
      (data) => {
        const existing = data[group] ?? [];
        if (existing.some((other) => other[def.idField] === item[def.idField])) {
          throw new ConflictException(`条目已存在：${def.type}/${group}/${String(item[def.idField])}`);
        }
        return { ...data, [group]: [...existing, item] };
      },
      groupedSchema(def),
    );
    return item;
  }

  /** itemSchema 校验，失败转 BadRequestException（detail 携带 zod issues） */
  private parseItemOrThrow(def: CollectionDef, input: unknown): Item {
    const result = def.itemSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException({
        message: `集合条目校验失败（${def.type}）`,
        detail: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    return result.data as Item;
  }

  /** 写入成功出口：恰好一次发射 content.changed（payload 先过 zod parse） */
  private emitChanged(def: CollectionDef, op: string): void {
    const payload = ContentChangedPayload.parse({
      scope: 'collection',
      type: def.type,
      filePaths: [def.file],
    });
    this.emitter.emit(EVENTS.ContentChanged, payload);
    logger.info({ type: def.type, op, file: def.file }, '集合写入完成，已发射 content.changed');
  }
}

// ── 纯工具 ──

function groupedSchema(def: CollectionDef): z.ZodType {
  return z.record(z.string(), def.itemSchema.array());
}

/** 去掉 group 字段（grouped PATCH body 可能携带，不落盘） */
function stripGroup(input: unknown): Item {
  const record = { ...(input as Item) };
  delete record['group'];
  return record;
}

/** grouped 数据内按 idField 定位条目与所在分组 */
function locateGrouped(
  data: GroupedData,
  idField: string,
  id: string,
): { group: string; item: Item } | undefined {
  for (const [group, items] of Object.entries(data)) {
    const item = items.find((entry) => entry[idField] === id);
    if (item) {
      return { group, item };
    }
  }
  return undefined;
}

/** timeline POST：未提供 icon/color 时按 type 填充默认映射（ADR-004） */
function applyTimelineDefaults(def: CollectionDef, raw: Item): void {
  if (def.type !== 'timeline') {
    return;
  }
  const defaults = TIMELINE_DEFAULTS[String(raw['type'])];
  if (!defaults) {
    return;
  }
  raw['icon'] ??= defaults.icon;
  raw['color'] ??= defaults.color;
}
