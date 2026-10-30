/**
 * [T2] theme-compat-collections — Shirone 独有内容集合 schema 的契约单测
 *
 * 覆盖面（compass / games 两个条目 schema 的四格语义）：
 * - 正例：样本逐字抄自 Shirone 源码（compass.ts L110/L113-116，
 *   games.ts L35-50），最小可用、且刻意省略全部可选字段；
 * - 负例：删掉一个必填字段 ⇒ `.strict()` 校验必须拒绝。
 *
 * 权威源（只读）：.test-tmp/upstream-Shirone-20261029/src/{data/compass.ts,data/games.ts,types/gamesConfig.ts}
 */
import { describe, expect, it } from 'vitest';
import { CompassItemSchema, GameItemSchema } from '@mizuki/shared';

/** 抄自 compass.ts L39-63（dev shelf）与 L105-118（reads shelf）的真实字段值 */
const compassShelfSample = {
  key: 'reads',
  name: 'Reading',
  icon: 'material-symbols:auto-stories-outline-rounded',
  entries: [
    { label: 'Hacker News', href: 'https://news.ycombinator.com' },
    {
      label: 'Solidot',
      href: 'https://www.solidot.org',
      note: 'Tech and culture news',
    },
  ],
};

/** 抄自 games.ts L34-50（minecraft 条目）的真实字段值 */
const gameItemSample = {
  id: 'minecraft',
  name: 'Minecraft',
  developer: 'Mojang Studios',
  category: 'sandbox',
  status: 'playing',
  cover: 'assets/games/minecraft-hero.jpg',
  icon: 'material-symbols:widgets-rounded',
  rating: 5,
  hours: 420,
  platform: 'PC',
  year: '2011',
  tags: ['Sandbox', 'Survival', 'Building'],
  description:
    'A blocky sandbox where you mine, craft and build across procedurally generated worlds.',
  link: 'https://www.minecraft.net/',
};

describe('T2 [主题兼容] compass 条目 schema', () => {
  it('正例：真实 shelf 样本（含嵌套 entries，可选字段全缺省）通过', () => {
    const result = CompassItemSchema.safeParse(compassShelfSample);
    expect(result.success).toBe(true);
  });

  it('负例：删除必填字段 key ⇒ 拒绝', () => {
    const withoutKey: Record<string, unknown> = { ...compassShelfSample };
    delete withoutKey['key'];
    const result = CompassItemSchema.safeParse(withoutKey);
    expect(result.success).toBe(false);
  });
});

describe('T2 [主题兼容] games 条目 schema', () => {
  it('正例：真实游戏条目样本（可选字段 featured 缺省）通过', () => {
    const result = GameItemSchema.safeParse(gameItemSample);
    expect(result.success).toBe(true);
  });

  it('负例：删除必填字段 developer ⇒ 拒绝', () => {
    const withoutDeveloper: Record<string, unknown> = { ...gameItemSample };
    delete withoutDeveloper['developer'];
    const result = GameItemSchema.safeParse(withoutDeveloper);
    expect(result.success).toBe(false);
  });
});
