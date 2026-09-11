/**
 * [阶段 P4] collections/collections.service — 七类集合 CRUD 编排
 * [职责] 基于 DataFileService（P3 引擎，唯一合法读写通道）实现集合内容的
 *   增删改查；每次写入成功出口发射 content.changed（scope='collection'）。
 *   禁止为集合内容建任何数据库表（文件即数据库，MASTER-PLAN §2 决策 1）。
 * [状态] ACTIVE
 *
 * 规则（P4 §3.3 + Phase3-C2b/ADR-018）：
 * - POST：diary/friends 无 id 时自动 max+1（冲突重试，上界 1000 次）；
 *   projects/skills/timeline id 留空 → slugify（来源 title/name，结果空 →
 *   item-<nanoid(6)>）；anime 无 id 不生成（title 为必填定位键）；
 *   id 冲突 → 409；
 * - [B2/裁决 9 + ADR-014] diary/friends 载入时检测非 number id 自动换新；
 * - [ADR-018] projects/skills/timeline 载入时执行值域迁移（number id →
 *   String、status/type/level 遗留枚举 → 官方枚举、skills.projects[] 同步
 *   String 化）：zod parse 之前的原始值层、幂等、原子写回、非法值不迁移
 *   （交由校验拒绝，禁自创映射）；
 * - [ADR-018] 编辑时定位键只读（projects/skills/timeline 的 id 与 anime 的
 *   title 改值 = 换定位器，禁止 → 400）；
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
import { parseOrBadRequest } from '../../common/validation/zod-issues';
import { DataFileService } from '../data-files/data-file.service';
import type { CollectionDef } from './registry';

type Item = Record<string, unknown>;
type GroupedData = Record<string, Item[]>;

/** [B2/裁决 9] id 生成冲突重试上界（提示词 T3.3） */
const MAX_ID_RETRY = 1000;

/**
 * timeline 按 type 的默认 icon/color。
 * [ADR-004/C2b 修订] 官方枚举 education|work|project|achievement：
 *   education 与 work 有官方文档示例（special-timeline.md §2/§3 逐字）；
 *   project/achievement 无官方示例，暂定值保留并注记。
 */
const TIMELINE_DEFAULTS: Record<string, { icon: string; color: string }> = {
  education: { icon: 'material-symbols:school', color: '#059669' }, // 官方示例（ADR-004 §B4 修订）
  work: { icon: 'material-symbols:work', color: '#DC2626' }, // 官方示例（ADR-004 C2b 修订）
  project: { icon: 'rocket', color: '#10b981' }, // 暂定：无官方示例（ADR-004 注记）
  achievement: { icon: 'star', color: '#8b5cf6' }, // 暂定：无官方示例（ADR-004 注记）
};

@Injectable()
export class CollectionsService {
  constructor(
    private readonly dataFiles: DataFileService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** 全量列表（array → 数组；grouped → 分组对象）；载入前先跑迁移触发 */
  async list(def: CollectionDef): Promise<unknown> {
    await this.prepareLoad(def);
    return this.dataFiles.readCollection(def.file, def.varName);
  }

  /** 新增条目（grouped 时 input 须含 group 字段）；先跑迁移保证生成基准正确 */
  async create(def: CollectionDef, input: unknown): Promise<Item> {
    await this.prepareLoad(def);
    const item = def.shape === 'grouped' ? await this.createGrouped(def, input) : await this.createArray(def, input);
    this.emitChanged(def, 'create');
    return item;
  }

  /** 修改条目（按 idField 定位；numericId 集合 :id 为数字，grouped 跨分组查找） */
  async update(def: CollectionDef, id: string, patchInput: unknown): Promise<Item> {
    await this.prepareLoad(def);
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
          this.rejectLocatorChange(def, list[index]!, patch);
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
    await this.prepareLoad(def);
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

  /** 载入前置：numericId 换新（ADR-014）+ 官方值域迁移（ADR-018），均幂等 */
  private async prepareLoad(def: CollectionDef): Promise<void> {
    await this.ensureNumericIds(def);
    await this.migrateLegacyValues(def);
  }

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

  /**
   * [ADR-018] 官方值域迁移（projects/skills/timeline）：B2 裁决 9 曾对三类
   * 实现 number id 过度覆盖，官方三集合 id 均为字符串名称串。沿用 ADR-014
   * 载入触发原始值层点位（zod parse 之前）：
   * - id: number → String(n)；
   * - projects.status: 'active'→'in-progress'、'done'→'completed'（其他值
   *   不迁移，交由 schema 校验拒绝——禁自创映射）；
   * - skills.level: 1→'beginner'、2→'intermediate'、3→'advanced'、≥4→
   *   'expert'（非 number 不迁移）；skills.projects[] 各项同步 String 化
   *   （引用 projects id，与 projects id 迁移同批一致）；
   * - timeline.type: 'certificate'→'work'、'other'→'achievement'。
   * 幂等（官方值直通）；文件锁 + temp+rename 原子写回；磁盘字节仅变迁移目标。
   */
  private async migrateLegacyValues(def: CollectionDef): Promise<void> {
    if (def.shape !== 'array' || !(def.type === 'projects' || def.type === 'skills' || def.type === 'timeline')) {
      return;
    }
    const current = this.dataFiles.readCollection<unknown>(def.file, def.varName);
    if (!Array.isArray(current) || !current.some((item) => needsLegacyMigration(def.type, item))) {
      return; // 幂等：无遗留值不触发
    }
    logger.warn({ type: def.type, file: def.file }, '检测到遗留 id 类型/枚举值，执行官方值域迁移（ADR-018）');
    await this.dataFiles.mutateCollection<Item[]>(
      def.file,
      def.varName,
      (list) => list.map((item) => migrateLegacyItem(def.type, item)),
      // 故意不传 schema：迁移发生在原始值层（ADR-014 同款防死锁）
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
    const autoNumericId = def.numericId && (raw[def.idField] === undefined || raw[def.idField] === '' || raw[def.idField] === 0);
    // [ADR-018] 字符串 id 集合：id 留空 → slugify 生成（来源 title/name）
    const autoSlugId = !def.numericId && def.shape === 'array' && def.idField === 'id' && (raw['id'] === undefined || raw['id'] === '');
    if (autoSlugId) {
      const slug = slugify(String(raw[def.slugSource ?? 'title'] ?? ''));
      raw['id'] = slug === '' ? `item-${nanoid(6)}` : slug;
    } else if (
      !def.numericId &&
      def.shape === 'array' &&
      def.idField === 'id' &&
      typeof raw['id'] === 'string'
    ) {
      // [Phase4-D4/B3] 字符串 id 显式提供：slugify 幂等探针白名单（服务端为准，
      // 客户端仅体验层）——slugify(provided) !== provided 即含白名单外字符 → 400
      const provided = raw['id'];
      if (slugify(provided) !== provided) {
        throw new BadRequestException(`id 仅允许小写字母、数字与连字符（-）：${provided}`);
      }
    }
    for (let attempt = 0; ; attempt += 1) {
      if (autoNumericId) {
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
        if (autoNumericId && error instanceof ConflictException && attempt < MAX_ID_RETRY) {
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

  /**
   * [ADR-018] 定位键只读守卫：projects/skills/timeline 的 id 与 anime 的
   * title 是定位器，PATCH 改值 = 换定位器，禁止（400）。diary/friends 的
   * number id 与 devices 的 name 分支语义维持既有行为不在此列。
   */
  private rejectLocatorChange(def: CollectionDef, current: Item, patch: Item): void {
    const guarded = !def.numericId && def.shape === 'array' && (def.idField === 'id' || def.type === 'anime');
    if (!guarded) {
      return;
    }
    if (patch[def.idField] !== undefined && patch[def.idField] !== current[def.idField]) {
      throw new BadRequestException(`定位键 ${def.idField} 只读，不可修改（如需更换请删除后重建）：${def.type}`);
    }
  }

  /** itemSchema 校验，失败转 BadRequest（detail 携带 zod issues；单源见 common/validation/zod-issues） */
  private parseItemOrThrow(def: CollectionDef, input: unknown): Item {
    return parseOrBadRequest(def.itemSchema, input, `集合条目校验失败（${def.type}）`) as Item;
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

/** [ADR-018] slug 生成：小写、空白/下划线转连字符、剔除 [a-z0-9-] 外字符 */
function slugify(source: string): string {
  return source
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** [ADR-018] 单条遗留值检测（幂等判据：存在任一遗留形态即需要迁移） */
function needsLegacyMigration(type: string, raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const item = raw as Item;
  if (typeof item['id'] === 'number') {
    return true;
  }
  if (type === 'projects' && (item['status'] === 'active' || item['status'] === 'done')) {
    return true;
  }
  if (type === 'skills') {
    if (typeof item['level'] === 'number') {
      return true;
    }
    if (Array.isArray(item['projects']) && item['projects'].some((p) => typeof p === 'number')) {
      return true;
    }
  }
  if (type === 'timeline' && (item['type'] === 'certificate' || item['type'] === 'other')) {
    return true;
  }
  return false;
}

/** [ADR-018] 单条迁移（仅动迁移目标，其余字段原样保留；非法值不动） */
function migrateLegacyItem(type: string, raw: Item): Item {
  const next: Item = { ...raw };
  if (typeof next['id'] === 'number') {
    next['id'] = String(next['id']);
  }
  if (type === 'projects') {
    if (next['status'] === 'active') {
      next['status'] = 'in-progress';
    } else if (next['status'] === 'done') {
      next['status'] = 'completed';
    }
  } else if (type === 'skills') {
    if (typeof next['level'] === 'number') {
      const level = next['level'] as number;
      next['level'] =
        level >= 4 ? 'expert' : level === 3 ? 'advanced' : level === 2 ? 'intermediate' : level === 1 ? 'beginner' : next['level'];
    }
    if (Array.isArray(next['projects'])) {
      next['projects'] = next['projects'].map((p) => (typeof p === 'number' ? String(p) : p));
    }
  } else if (type === 'timeline') {
    if (next['type'] === 'certificate') {
      next['type'] = 'work';
    } else if (next['type'] === 'other') {
      next['type'] = 'achievement';
    }
  }
  return next;
}
