/**
 * [阶段 P4] collections/collections.service — 六类集合 CRUD 编排
 * [职责] 基于 DataFileService（P3 引擎，唯一合法读写通道）实现六类内容的
 *   增删改查；每次写入成功出口发射 content.changed（scope='collection'）。
 *   禁止为六类内容建任何数据库表（文件即数据库，MASTER-PLAN §2 决策 1）。
 * [状态] ACTIVE
 *
 * 规则（P4 §3.3）：
 * - POST：无 id（devices 无 name）时自动生成；id 冲突 → 409；
 * - [B2/裁决 9] 五类 numericId 集合 id 为 number：POST 自动生成改 max+1
 *   （冲突重试，上界 1000 次）；引擎载入文件时检测非 number id 即自动
 *   换新迁移（ADR-014：原始值层操作、原子写回、幂等、无旧引用兼容）；
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

/** [B2/裁决 9] id 生成冲突重试上界（提示词 T3.3） */
const MAX_ID_RETRY = 1000;

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

  /** 全量列表（array → 数组；grouped → 分组对象）；载入前先跑 id 迁移触发 */
  async list(def: CollectionDef): Promise<unknown> {
    await this.ensureNumericIds(def);
    return this.dataFiles.readCollection(def.file, def.varName);
  }

  /** 新增条目（grouped 时 input 须含 group 字段）；先跑 id 迁移保证 max+1 基准正确 */
  async create(def: CollectionDef, input: unknown): Promise<Item> {
    await this.ensureNumericIds(def);
    const item = def.shape === 'grouped' ? await this.createGrouped(def, input) : await this.createArray(def, input);
    this.emitChanged(def, 'create');
    return item;
  }

  /** 修改条目（按 idField 定位；numericId 集合 :id 为数字，grouped 跨分组查找） */
  async update(def: CollectionDef, id: string, patchInput: unknown): Promise<Item> {
    await this.ensureNumericIds(def);
    const patch = stripGroup(patchInput);
    const targetId = def.numericId ? Number(id) : id;
    let updated: Item | undefined;
    if (def.shape === 'grouped') {
      await this.dataFiles.mutateCollection<GroupedData>(
        def.file,
        def.varName,
        (data) => {
          const located = locateGrouped(data, def.idField, targetId);
          if (!located) {
            throw new NotFoundException(`条目不存在：${def.type}/${id}`);
          }
          const merged = this.parseItemOrThrow(def, { ...located.item, ...patch });
          const renamed = merged[def.idField];
          const group = data[located.group] ?? [];
          const conflict = group.some(
            (item) => item[def.idField] === renamed && item !== located.item,
          );
          if (conflict) {
            throw new ConflictException(`条目已存在：${def.type}/${String(renamed)}`);
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
          const index = list.findIndex((item) => item[def.idField] === targetId);
          if (index < 0) {
            throw new NotFoundException(`条目不存在：${def.type}/${id}`);
          }
          const merged = this.parseItemOrThrow(def, { ...list[index]!, ...patch });
          const newId = merged[def.idField];
          if (list.some((item, i) => i !== index && item[def.idField] === newId)) {
            throw new ConflictException(`条目已存在：${def.type}/${String(newId)}`);
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
    await this.ensureNumericIds(def);
    const targetId = def.numericId ? Number(id) : id;
    if (def.shape === 'grouped') {
      await this.dataFiles.mutateCollection<GroupedData>(
        def.file,
        def.varName,
        (data) => {
          const located = locateGrouped(data, def.idField, targetId);
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
          const index = list.findIndex((item) => item[def.idField] === targetId);
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

  /**
   * [B2/裁决 9] 引擎载入文件时的 id 迁移触发（ADR-014）：
   * 在 zod parse 之前对原始值检测——发现任一 id 非 number，立即执行 max+1
   * 换新并经引擎既有管线原子写回（文件锁 + temp+rename + pre_write 备份），
   * 再走正常流程。迁移函数在原始值层操作（不传 schema，不依赖新 schema 的
   * parse 成功）；max 基准取文件内现存 number id 最大值（全 string 则从 1 起）；
   * 换新后保证文件内唯一；幂等（全 number 不触发）。
   */
  private async ensureNumericIds(def: CollectionDef): Promise<void> {
    if (!def.numericId || def.shape !== 'array') {
      return;
    }
    const current = this.dataFiles.readCollection<unknown>(def.file, def.varName);
    if (!Array.isArray(current) || !(current as Item[]).some((item) => typeof item[def.idField] !== 'number')) {
      return; // 幂等：全 number（或结构异常交由后续正常流程报错）不触发
    }
    logger.warn({ type: def.type, file: def.file }, '检测到非 number id，执行自动换新迁移（ADR-014）');
    await this.dataFiles.mutateCollection<Item[]>(
      def.file,
      def.varName,
      (list) => {
        let nextId = maxNumericId(list, def.idField);
        const used = new Set<number>();
        for (const item of list) {
          if (typeof item[def.idField] === 'number') {
            used.add(item[def.idField] as number);
          }
        }
        return list.map((item) => {
          if (typeof item[def.idField] === 'number') {
            return item;
          }
          do {
            nextId += 1;
          } while (used.has(nextId));
          used.add(nextId);
          return { ...item, [def.idField]: nextId };
        });
      },
      // 故意不传 schema：迁移发生在原始值层，不得依赖新 schema 的 parse 成功
    );
  }

  /** [B2/裁决 9] numericId 集合的自动 id：文件内现存 number id 最大值 + 1 */
  private nextAutoId(def: CollectionDef): number {
    const current = this.dataFiles.readCollection<unknown>(def.file, def.varName);
    const items = Array.isArray(current) ? (current as Item[]) : [];
    return maxNumericId(items, def.idField) + 1;
  }

  private async createArray(def: CollectionDef, input: unknown): Promise<Item> {
    const raw = { ...(input as Item) };
    applyTimelineDefaults(def, raw);
    // [B2/裁决 9] numericId：id 缺省/0 → max+1 自动生成（冲突重试，上界 1000 次）
    const autoId = def.numericId && (raw[def.idField] === undefined || raw[def.idField] === '' || raw[def.idField] === 0);
    if (!def.numericId && (raw[def.idField] === undefined || raw[def.idField] === '')) {
      raw[def.idField] = nanoid(); // devices 无 idField 概念（name 由用户填），此分支仅防御
    }
    for (let attempt = 0; ; attempt += 1) {
      if (autoId) {
        delete raw[def.idField];
        raw[def.idField] = this.nextAutoId(def);
      }
      const item = this.parseItemOrThrow(def, raw);
      try {
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
      } catch (error) {
        if (autoId && error instanceof ConflictException && attempt < MAX_ID_RETRY) {
          continue; // 并发写入挪动了 max 基准 → 重算 max+1 再试
        }
        throw error;
      }
    }
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
  id: string | number,
): { group: string; item: Item } | undefined {
  for (const [group, items] of Object.entries(data)) {
    const item = items.find((entry) => entry[idField] === id);
    if (item) {
      return { group, item };
    }
  }
  return undefined;
}

/** [B2/裁决 9] 列表内 number id 最大值（无 number id → 0，自动生成即从 1 起） */
function maxNumericId(list: Item[], idField: string): number {
  let max = 0;
  for (const item of list) {
    const value = item[idField];
    if (typeof value === 'number' && Number.isInteger(value) && value > max) {
      max = value;
    }
  }
  return max;
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
