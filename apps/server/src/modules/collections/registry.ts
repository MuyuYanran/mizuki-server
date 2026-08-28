/**
 * [阶段 P4] collections/registry — 六类集合注册表
 * [职责] CollectionDef 结构与六类配置（MASTER-PLAN §4.2 逐字）；
 *   新增一种内容类型 = 增加一个配置对象，控制器/服务零改动。
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
  /** [B2/裁决 9] id 为 number（max+1 生成 + 载入时自动换新迁移，ADR-014）；
   * devices 的 idField 为 name（官方 grouped 规格），保持 string，不参与迁移 */
  numericId: boolean;
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
    numericId: true,
    public: true,
    itemSchema: ProjectsItemSchema,
  },
  {
    type: 'timeline',
    file: 'src/data/timeline.ts',
    varName: 'timelineData',
    shape: 'array',
    idField: 'id',
    numericId: true,
    public: true,
    itemSchema: TimelineItemSchema,
  },
  {
    type: 'skills',
    file: 'src/data/skills.ts',
    varName: 'skillsData',
    shape: 'array',
    idField: 'id',
    numericId: true,
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
