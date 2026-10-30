/**
 * [阶段 P4 / T2] collections/registry — 主题分档集合注册表
 * [职责] CollectionDef 结构与两档配置表：Mizuki 七条（逐字保留）、Shirone 八条；
 *   `findCollectionDef(type, kind)` / `getRegistryTable(kind)` 按当前主题取表。
 *   新增一种内容类型 = 增加一个配置对象，控制器/服务零改动。
 * [Phase3-C2b/ADR-018] 官方 id 类型修正：projects/skills/timeline 为字符串
 *   名称串（numericId:false），仅 diary/friends 维持 number（max+1）；
 *   anime 第七集合注册（无 id 字段，title 为定位器，禁止注入 id）。
 * [T2/双主题] kind 语义（来源 common/theme/theme-adapter 探测）：
 *   - `mizuki` → Mizuki 表；
 *   - `shirone` → Shirone 表（friends/projects/timeline/skills/devices/anime/compass/games；
 *     无 diary——Shirone 无此集合；无 music——那是配置层不是内容集合）；
 *   - `unknown` → **空表**（[Q2] 见下）。
 * [Q2/裁定] `unknown` **不再兜底成 Mizuki 表**。适配器把两个来源都归到 unknown：
 *   ①主题根缺失/未初始化；②Shirone **npm 包模式**（依赖命中 `shirones` 但项目根无
 *   `src/config/siteConfig.ts`）。这两种情况下 Mizuki 表指向的 `src/data/*.ts`
 *   在这个根下**并不存在**——回落过去不是「保住功能」，而是拿一个假地址去读写，
 *   且与 dj 的 Q2 裁定（包模式「归入不支持」）直接冲突。
 *   ⇒ 空表是如实回答：「此根下没有任何可纳管的集合」；调用方据此报可读的错，
 *   而不是去猜一个主题种类。**不得**为了「别让功能全灭」把它改回 Mizuki 表。
 *   [实测] Shirone 的 anime 变量名是 `animeData`，与 Mizuki 的 `localAnimeList` 不同，
 *     不得统一；两表的 file/varName 均逐字取自上游源码（.test-tmp/upstream-Shirone-20261029）。
 * [状态] ACTIVE
 */
import { z } from 'zod';
import {
  AnimeItemSchema,
  CompassItemSchema,
  DeviceItemSchema,
  DiaryItemSchema,
  FriendsItemSchema,
  GameItemSchema,
  ProjectsItemSchema,
  ShironeDeviceItemSchema,
  SkillsItemSchema,
  TimelineItemSchema,
  type ThemeKind,
} from '@mizuki/shared';
import { ThemeAdapter } from '../../common/theme/theme-adapter';
import { getAppConfig } from '../../config/app-config';

export interface CollectionDef {
  type: string;
  /** 相对主题根的数据文件路径 */
  file: string;
  varName: string;
  /** devices（Mizuki）为 grouped（分类 → 数组 的对象），其余为 array */
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

/** Mizuki 表：七条，T2 前原样（逐字不变） */
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
  {
    // [Phase3-C2b] anime 第七集合：官方 local 模式（ADR-018）。
    // 无 id 字段——title 为定位器（idField:'title'），禁止向条目注入 id。
    type: 'anime',
    file: 'src/data/anime.ts',
    varName: 'localAnimeList',
    shape: 'array',
    idField: 'title',
    numericId: false,
    public: true,
    itemSchema: AnimeItemSchema,
  },
];

/**
 * Shirone 表：八条（T2 新增）。
 * [实测依据] 每条的 file/varName 取自上游 `src/data/*.ts` 的顶层声明；
 * devices 顶层为**扁平数组**（devices.ts:7 `export const devicesData: DeviceItem[] = [`，
 *   分类是条目字段 `category`，不是分组键）→ shape:'array'；上游 `public/images/` 下
 *   只有 albums/moments，**无 device 目录** → 不配 imageDir（禁止凭空造路径）。
 * [T2c] devices 的身份字段是**显式 `id`**（上游 `src/types/devicesConfig.ts:36` 必填，
 *   注释「稳定标识（URL 片段 / 测试选择器）」；`devices.ts:8` 实测 `id: "macbook-pro-16"`），
 *   **不是 `name`** —— T2 简报此处写错，按上游更正。条目字段面（7 必填 + 7 可选）宽于
 *   Mizuki 档，故本档绑定 `ShironeDeviceItemSchema`：两档各持一份 schema，
 *   **不放宽** Mizuki 的 `.strict()` 五字段冻结面。
 */
export const SHIRONE_REGISTRY: CollectionDef[] = [
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
    // [T2c] 身份字段是上游显式 `id`（非 name）；扁平数组、无 imageDir（上游无 device 图目录）
    type: 'devices',
    file: 'src/data/devices.ts',
    varName: 'devicesData',
    shape: 'array',
    idField: 'id',
    numericId: false,
    slugSource: 'name',
    public: true,
    itemSchema: ShironeDeviceItemSchema,
  },
  {
    // [T2] Shirone 的 anime 变量名是 `animeData`（Mizuki 为 localAnimeList）——实测差异，勿统一。
    type: 'anime',
    file: 'src/data/anime.ts',
    varName: 'animeData',
    shape: 'array',
    idField: 'title',
    numericId: false,
    public: true,
    itemSchema: AnimeItemSchema,
  },
  {
    type: 'compass',
    file: 'src/data/compass.ts',
    varName: 'compassData',
    shape: 'array',
    idField: 'key',
    numericId: false,
    public: true,
    itemSchema: CompassItemSchema,
  },
  {
    type: 'games',
    file: 'src/data/games.ts',
    varName: 'gamesData',
    shape: 'array',
    idField: 'id',
    numericId: false,
    slugSource: 'name',
    public: true,
    itemSchema: GameItemSchema,
  },
];

/** 档位 → 表（unknown = 空表，理由见文件头 [Q2/裁定]） */
const TABLES: Record<ThemeKind, readonly CollectionDef[]> = {
  mizuki: REGISTRY,
  shirone: SHIRONE_REGISTRY,
  unknown: [],
};

/** 取整表（按 kind；未知档位在类型层已被 ThemeKind 收口） */
export function getRegistryTable(kind: ThemeKind): readonly CollectionDef[] {
  return TABLES[kind];
}

/** 按 type + 主题档位查注册表（未注册返回 undefined，调用方转 404/400） */
export function findCollectionDef(type: string, kind: ThemeKind): CollectionDef | undefined {
  return getRegistryTable(kind).find((def) => def.type === type);
}

/**
 * 未注册集合类型的统一报错文案（两个 controller 共用，单源）。
 * 表为空（kind=unknown）时必须说「主题未被识别 / 该部署形态不受支持」，
 * 而不是拼出「可用：」（空列表会把「主题没识别」误导成「类型拼错」）。
 */
export function unknownCollectionMessage(type: string, kind: ThemeKind): string {
  const available = getRegistryTable(kind).map((def) => def.type);
  if (available.length === 0) {
    return (
      `当前主题未被识别，或该部署形态不支持集合纳管（kind=${kind}）：${type}。` +
      '请确认 config.json 的 mizukiRoot 指向主题「源码仓」根目录'
    );
  }
  return `未知的集合类型：${type}（可用：${available.join('/')}）`;
}

/**
 * 当前主题档位（**活取**：每请求探测 + 读 config，与 getAppConfig 的活取口径一致；
 * 探测为常数级 statSync，不递归、不写盘）。
 * [Q2] 包模式 / 未初始化 / 探测未命中一律回到 `unknown`，其集合表为**空**
 *   —— 不得回落成 Mizuki 表（理由见文件头）。
 */
export function currentThemeKind(): ThemeKind {
  return new ThemeAdapter().resolve(getAppConfig().mizukiRoot, getAppConfig().mode).kind;
}
