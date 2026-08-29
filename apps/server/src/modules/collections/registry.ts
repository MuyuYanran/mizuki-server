/**
 * [阶段 P4] collections/registry — 七类集合注册表
 * [职责] CollectionDef 结构与七类配置（MASTER-PLAN §4.2 逐字）；
 *   新增一种内容类型 = 增加一个配置对象，控制器/服务零改动。
 * [Phase3-C2b/ADR-018] 官方 id 类型修正：projects/skills/timeline 为字符串
 *   名称串（numericId:false），仅 diary/friends 维持 number（max+1）；
 *   anime 第七集合注册（无 id 字段，title 为定位器，禁止注入 id）。
 * [状态] ACTIVE
 */
import { z } from 'zod';
import {
  DeviceItemSchema,
  DiaryItemSchema,
  FriendsItemSchema,
  ProjectsItemSchema,
  SkillsItemSchema,
  TimelineItemSchema,
} from '@mizuki/shared';

export interface CollectionDef {
  type: string;
  /** 相对 Mizuki 根的数据文件路径 */
  file: string;
  varName: string;
  /** devices 为 grouped（分类 → 数组 的对象），其余为 array */
  shape: 'array' | 'grouped';
  itemSchema: z.ZodType;
  idField: string;
  /** [ADR-018] id 为 number 的集合（diary/friends）：max+1 生成 + 载入时
   * 自动换新迁移（ADR-014）；projects/skills/timeline 为 string 名称串、
   * anime 无 id（title 定位）、devices idField 为 name——均 false */
  numericId: boolean;
  /** [ADR-018] 字符串 id 集合 POST 留空时的 slugify 来源字段 */
  slugSource?: 'title' | 'name';
  imageDir?: string;
  public: boolean;
}

export const REGISTRY: CollectionDef[] = [
  {
    type: 'diary',
    file: 'src/data/diary.ts',
    varName: 'diaryData',
    shape: 'array',
    idField: 'id',
    numericId: true,
    imageDir: 'public/images/diary',
    public: true,
    itemSchema: DiaryItemSchema,
  },
  {
    type: 'friends',
    file: 'src/data/friends.ts',
    varName: 'friendsData',
    shape: 'array',
    idField: 'id',
    numericId: true,
    public: true,
    itemSchema: FriendsItemSchema,
  },
  {
    type: 'projects',
    file: 'src/data/projects.ts',
    varName: 'projectsData',
    shape: 'array',
    idField: 'id',
    numericId: false,
    slugSource: 'title',
    public: true,
    itemSchema: ProjectsItemSchema,
  },
  {
    type: 'timeline',
    file: 'src/data/timeline.ts',
    varName: 'timelineData',
    shape: 'array',
    idField: 'id',
    numericId: false,
    slugSource: 'title',
    public: true,
    itemSchema: TimelineItemSchema,
  },
  {
    type: 'skills',
    file: 'src/data/skills.ts',
    varName: 'skillsData',
    shape: 'array',
    idField: 'id',
    numericId: false,
    slugSource: 'name',
    public: true,
    itemSchema: SkillsItemSchema,
  },
  {
    type: 'devices',
    file: 'src/data/devices.ts',
    varName: 'devicesData',
    shape: 'grouped',
    idField: 'name',
    numericId: false,
    imageDir: 'public/images/device',
    public: true,
    itemSchema: DeviceItemSchema,
  },
];

/** 按 type 查注册表（未注册返回 undefined，调用方转 404/400） */
export function findCollectionDef(type: string): CollectionDef | undefined {
  return REGISTRY.find((def) => def.type === type);
}
