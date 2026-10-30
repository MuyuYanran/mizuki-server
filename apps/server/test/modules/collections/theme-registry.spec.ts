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
} from '@mizuki/shared';
import {
  REGISTRY,
  SHIRONE_REGISTRY,
  findCollectionDef,
  getRegistryTable,
  unknownCollectionMessage,
  type CollectionDef,
} from '../../../src/modules/collections/registry';

/**
 * [T2] 单元层：collections/registry 主题分档——纯单测，不起 Nest。
 * 三条基线：(1) Mizuki 表七条与 T2 前逐字全等（含 itemSchema 绑定同一实例）；
 * (2) Shirone 表八条且 file/varName/idField 正确（逐字取自上游源码）；
 * (3) [Q2] unknown **空表**（不回落 Mizuki 表）；shirone 取不到 Mizuki 独有集合。
 */

/** Mizuki 表在 T2 前的原样快照（改动前字段基线，逐字） */
const MIZUKI_BASELINE: CollectionDef[] = [
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

/** Shirone 表逐条期望（上游源码实测：file/varName/idField） */
const SHIRONE_EXPECTED: ReadonlyArray<{
  type: string;
  file: string;
  varName: string;
  idField: string;
  numericId: boolean;
  slugSource?: 'title' | 'name';
}> = [
  { type: 'friends', file: 'src/data/friends.ts', varName: 'friendsData', idField: 'id', numericId: true },
  {
    type: 'projects',
    file: 'src/data/projects.ts',
    varName: 'projectsData',
    idField: 'id',
    numericId: false,
    slugSource: 'title',
  },
  {
    type: 'timeline',
    file: 'src/data/timeline.ts',
    varName: 'timelineData',
    idField: 'id',
    numericId: false,
    slugSource: 'title',
  },
  {
    type: 'skills',
    file: 'src/data/skills.ts',
    varName: 'skillsData',
    idField: 'id',
    numericId: false,
    slugSource: 'name',
  },
  // 上游 devices.ts:7 顶层为扁平数组（分类是条目字段 category）→ shape:'array'
  // [T2c] 身份字段是上游显式 id（types/devicesConfig.ts:36 必填），非 name —— 简报笔误已更正
  {
    type: 'devices',
    file: 'src/data/devices.ts',
    varName: 'devicesData',
    idField: 'id',
    numericId: false,
    slugSource: 'name',
  },
  // 上游 anime.ts:47 `export const animeData`（Mizuki 为 localAnimeList）
  { type: 'anime', file: 'src/data/anime.ts', varName: 'animeData', idField: 'title', numericId: false },
  { type: 'compass', file: 'src/data/compass.ts', varName: 'compassData', idField: 'key', numericId: false },
  {
    type: 'games',
    file: 'src/data/games.ts',
    varName: 'gamesData',
    idField: 'id',
    numericId: false,
    slugSource: 'name',
  },
];

describe('[T2] collections/registry 主题分档', () => {
  it('Mizuki 表七条与改动前逐字全等（字段 + itemSchema 绑定）', () => {
    expect(REGISTRY).toHaveLength(7);
    expect(REGISTRY.map((def) => def.type)).toEqual([
      'diary',
      'friends',
      'projects',
      'timeline',
      'skills',
      'devices',
      'anime',
    ]);
    expect(REGISTRY).toEqual(MIZUKI_BASELINE);
    // 逐条 schema 绑定为同一实例（防止悄悄换 schema）
    REGISTRY.forEach((def, index) => {
      expect(def.itemSchema).toBe(MIZUKI_BASELINE[index]?.itemSchema);
    });
  });

  it('Shirone 表八条：file/varName/idField/numericId/slugSource 逐条正确', () => {
    expect(SHIRONE_REGISTRY).toHaveLength(8);
    expect(SHIRONE_REGISTRY.map((def) => def.type)).toEqual(SHIRONE_EXPECTED.map((row) => row.type));
    for (const row of SHIRONE_EXPECTED) {
      const def = findCollectionDef(row.type, 'shirone');
      expect(def).toBeDefined();
      expect({
        type: def?.type,
        file: def?.file,
        varName: def?.varName,
        idField: def?.idField,
        numericId: def?.numericId,
        slugSource: def?.slugSource,
        shape: def?.shape,
        public: def?.public,
      }).toEqual({ ...row, shape: 'array', public: true });
    }
    // schema 绑定：Shirone 独有集合用 shared 的 compass / games 条目 schema
    expect(findCollectionDef('compass', 'shirone')?.itemSchema).toBe(CompassItemSchema);
    expect(findCollectionDef('games', 'shirone')?.itemSchema).toBe(GameItemSchema);
  });

  it('Shirone 表不含 diary / music；anime 变量名与 Mizuki 不同', () => {
    expect(SHIRONE_REGISTRY.some((def) => def.type === 'diary')).toBe(false);
    expect(SHIRONE_REGISTRY.some((def) => def.type === 'music')).toBe(false);
    expect(findCollectionDef('diary', 'shirone')).toBeUndefined();
    expect(findCollectionDef('anime', 'shirone')?.varName).toBe('animeData');
    expect(findCollectionDef('anime', 'mizuki')?.varName).toBe('localAnimeList');
  });

  it('devices 两表差异：Mizuki grouped + imageDir，Shirone 扁平 array 且无 imageDir', () => {
    const mizuki = findCollectionDef('devices', 'mizuki');
    const shirone = findCollectionDef('devices', 'shirone');
    // 上游 public/images/ 下只有 albums / moments，无 device 目录 → 不得凭空造 imageDir
    expect(shirone?.shape).toBe('array');
    expect(shirone?.imageDir).toBeUndefined();
    // [T2c] 两档各持自己的 item schema，互不借用
    expect(shirone?.itemSchema).toBe(ShironeDeviceItemSchema);
    expect(shirone?.itemSchema).not.toBe(DeviceItemSchema);
    expect(mizuki).toEqual({
      ...MIZUKI_BASELINE[5],
    });
  });

  it('[T2c] Shirone devices：上游真实条目通过、Mizuki 五字段形状被拒', () => {
    // 逐字取自上游 src/data/devices.ts:8-22（首条），仅用于形状校验，不是 fixture 文件
    const upstreamFirst = {
      id: 'macbook-pro-16',
      name: 'MacBook Pro 16"',
      brand: 'Apple',
      category: 'desk',
      status: 'active',
      specs: 'M3 Max / 64GB / 2TB',
      description: 'Primary workstation for development, design, and heavy rendering workloads.',
      icon: 'material-symbols:laptop-mac-rounded',
      featured: true,
      year: '2024',
      link: 'https://www.apple.com/macbook-pro/',
    };
    expect(ShironeDeviceItemSchema.safeParse(upstreamFirst).success).toBe(true);

    // 上游 status 是封闭枚举：域外值必须被拒
    expect(ShironeDeviceItemSchema.safeParse({ ...upstreamFirst, status: 'retired' }).success).toBe(
      false,
    );

    // Mizuki 档的五字段条目在 Shirone 档下必须被拒（缺 id/brand/category/status）
    const mizukiShaped = {
      name: '某设备',
      image: '/images/uploads/x.webp',
      specs: '规格',
      description: '说明',
      link: 'https://example.com',
    };
    expect(DeviceItemSchema.safeParse(mizukiShaped).success).toBe(true);
    expect(ShironeDeviceItemSchema.safeParse(mizukiShaped).success).toBe(false);

    // .strict() 口径：上游将来新增字段时显式报错，而非静默丢弃
    expect(ShironeDeviceItemSchema.safeParse({ ...upstreamFirst, futureField: 1 }).success).toBe(
      false,
    );
  });

  it('kind 取表：mizuki→Mizuki 表，shirone→Shirone 表，unknown→空表（Q2 裁定）', () => {
    expect(getRegistryTable('mizuki')).toBe(REGISTRY);
    expect(getRegistryTable('shirone')).toBe(SHIRONE_REGISTRY);
    // [Q2] unknown 不得回落成 Mizuki 表——包模式/未初始化时 src/data/*.ts 并不存在，
    // 回落过去等于拿假地址读写，且与 dj 的「包模式归入不支持」直接冲突。
    expect(getRegistryTable('unknown')).toEqual([]);
    expect(findCollectionDef('diary', 'unknown')).toBeUndefined();
    expect(findCollectionDef('games', 'unknown')).toBeUndefined();
    expect(findCollectionDef('games', 'shirone')?.varName).toBe('gamesData');
  });

  it('[Q2] 空表时文案说「主题未被识别」，不拼出空的可用列表', () => {
    const message = unknownCollectionMessage('diary', 'unknown');
    expect(message).toContain('未被识别');
    expect(message).not.toContain('可用：');
    // 非空表保持既有文案（回归保护）
    expect(unknownCollectionMessage('nope', 'mizuki')).toBe(
      `未知的集合类型：nope（可用：${REGISTRY.map((def) => def.type).join('/')}）`,
    );
  });
});
