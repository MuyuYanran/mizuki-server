import { z } from 'zod';
import {
  DeviceGroupedSchema,
  DeviceItemSchema,
  DiaryItemSchema,
  FriendsItemSchema,
  ProjectsItemSchema,
  SkillsItemSchema,
  TimelineItemSchema,
} from '../../../../../packages/shared/src/collections';
import {
  astToValue,
  getVariableDeclarationOrThrow,
  loadSourceFile,
} from '../../../src/modules/data-files/evaluator';

/**
 * P4 单元层：六个 shared schema 与 fixture 假项目数据逐文件核对——
 * fixture 中每个既有条目都应通过对应 itemSchema（字段规格与数据一致），
 * 非法输入被拒。确保 schema 与真实数据形状对齐（§6.0 第 5 条核对义务）。
 */

function readFixture(fileName: string, varName: string): unknown {
  const abs = `${process.cwd()}/test/fixtures/mizuki/src/data/${fileName}`;
  const sf = loadSourceFile(abs);
  const init = getVariableDeclarationOrThrow(sf, varName).getInitializer();
  return astToValue(init!, abs);
}

describe('P4 六类 schema 与 fixture 数据核对', () => {
  it('diary：fixture 两条条目全部通过 DiaryItemSchema', () => {
    const data = readFixture('diary.ts', 'diaryData') as unknown[];
    expect(data).toHaveLength(2);
    for (const item of data) {
      expect(DiaryItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it('friends / projects / timeline / skills：fixture 条目全部通过各自 schema', () => {
    const pairs: [string, string, z.ZodType][] = [
      ['friends.ts', 'friendsData', FriendsItemSchema],
      ['projects.ts', 'projectsData', ProjectsItemSchema],
      ['timeline.ts', 'timelineData', TimelineItemSchema],
      ['skills.ts', 'skillsData', SkillsItemSchema],
    ];
    for (const [file, varName, schema] of pairs) {
      const data = readFixture(file, varName) as unknown[];
      expect(data.length).toBeGreaterThan(0);
      for (const item of data) {
        const result = schema.safeParse(item);
        if (!result.success) {
          throw new Error(`${file} 条目未过 schema：${result.error.issues.map((i) => i.path.join('.')).join(',')}`);
        }
      }
    }
  });

  it('devices：fixture grouped 结构通过 DeviceGroupedSchema，单条通过 DeviceItemSchema', () => {
    const data = readFixture('devices.ts', 'devicesData') as Record<string, unknown[]>;
    expect(DeviceGroupedSchema.safeParse(data).success).toBe(true);
    for (const items of Object.values(data)) {
      for (const item of items) {
        expect(DeviceItemSchema.safeParse(item).success).toBe(true);
      }
    }
  });

  it('必填字段缺失被拒：friends 缺 siteurl / diary 缺 content / timeline 非法 type', () => {
    expect(
      FriendsItemSchema.safeParse({ id: 1, title: 't', imgurl: 'i' }).success,
    ).toBe(false);
    expect(DiaryItemSchema.safeParse({ id: 1, date: 'd' }).success).toBe(false);
    expect(
      TimelineItemSchema.safeParse({ id: 1, title: 't', type: 'invalid', startDate: 's' }).success,
    ).toBe(false);
  });

  it('[B4] friends 官方必填面：缺 desc 与空 tags 均被拒', () => {
    // 缺 desc（官方 FriendItem：desc 必填）
    expect(
      FriendsItemSchema.safeParse({ id: 1, title: 't', imgurl: 'i', siteurl: 's', tags: ['a'] }).success,
    ).toBe(false);
    // 空 tags（官方：tags 至少一个）
    expect(
      FriendsItemSchema.safeParse({ id: 1, title: 't', imgurl: 'i', desc: 'd', siteurl: 's', tags: [] }).success,
    ).toBe(false);
    // 全字段齐备通过
    expect(
      FriendsItemSchema.safeParse({ id: 1, title: 't', imgurl: 'i', desc: 'd', siteurl: 's', tags: ['a'] }).success,
    ).toBe(true);
  });

  it('类型错误被拒：skills.level 非数字 / projects.featured 非布尔', () => {
    expect(SkillsItemSchema.safeParse({ id: 1, name: 'n', level: 'high' }).success).toBe(false);
    expect(ProjectsItemSchema.safeParse({ id: 1, title: 't', featured: 'yes' }).success).toBe(false);
  });

  it('未知字段被剥离（zod 默认 strip，防止脏字段落盘）', () => {
    const result = DiaryItemSchema.parse({
      id: 1,
      content: 'c',
      date: 'd',
      evil: 'should-be-stripped',
    });
    expect(result).toEqual({ id: 1, content: 'c', date: 'd' });
  });
});
