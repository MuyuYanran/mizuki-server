import {
  ArticlePublishedPayload,
  BackupCompletedPayload,
  ContentChangedPayload,
  EVENTS,
  MediaChangedPayload,
  PostChangedPayload,
  ProcessFinishedPayload,
} from '../../../../packages/shared/src/events';

describe('P0b 事件目录骨架（§6.5）', () => {
  it('EVENTS 恰好含 6 个事件常量且值与 §3.5 规格一致', () => {
    expect(EVENTS).toEqual({
      ContentChanged: 'content.changed',
      PostChanged: 'post.changed',
      ArticlePublished: 'article.published',
      MediaChanged: 'media.changed',
      BackupCompleted: 'backup.completed',
      ProcessFinished: 'process.finished',
    });
    expect(Object.keys(EVENTS)).toHaveLength(6);
  });

  it('content.changed：合法样本 parse 通过，非法 scope 抛错', () => {
    expect(
      ContentChangedPayload.parse({
        scope: 'collection',
        type: 'diary',
        filePaths: ['src/data/diary.ts'],
      }),
    ).toMatchObject({ scope: 'collection' });
    expect(() =>
      ContentChangedPayload.parse({ scope: 'nope', filePaths: [] }),
    ).toThrow();
  });

  it('post.changed：合法样本 parse 通过，缺 fileHash 抛错', () => {
    expect(
      PostChangedPayload.parse({
        slug: 'hello-world',
        frontmatter: { title: 'Hello' },
        fileHash: 'abc123',
        deleted: false,
      }),
    ).toMatchObject({ slug: 'hello-world' });
    expect(() =>
      PostChangedPayload.parse({ slug: 'hello-world', frontmatter: {}, deleted: false }),
    ).toThrow();
  });

  it('article.published：合法样本 parse 通过，非法 sourceType 抛错', () => {
    expect(
      ArticlePublishedPayload.parse({
        id: 'W5K8x2',
        slug: 'hello-world',
        sourceType: 'richtext',
        title: 'Hello',
      }),
    ).toMatchObject({ sourceType: 'richtext' });
    expect(() =>
      ArticlePublishedPayload.parse({
        id: 'W5K8x2',
        slug: 'hello-world',
        sourceType: 'static',
        title: 'Hello',
      }),
    ).toThrow();
  });

  it('media.changed：合法样本 parse 通过，非法 op 抛错', () => {
    expect(MediaChangedPayload.parse({ path: 'public/images/a.jpg', op: 'save' })).toMatchObject({
      op: 'save',
    });
    expect(() => MediaChangedPayload.parse({ path: 'public/images/a.jpg', op: 'touch' })).toThrow();
  });

  it('backup.completed：合法样本 parse 通过，缺 fileCount 抛错', () => {
    expect(BackupCompletedPayload.parse({ id: 'bk1', scope: 'pre_write', fileCount: 3 })).toEqual({
      id: 'bk1',
      scope: 'pre_write',
      fileCount: 3,
    });
    expect(() => BackupCompletedPayload.parse({ id: 'bk1', scope: 'pre_write' })).toThrow();
  });

  it('process.finished：合法样本 parse 通过，缺 durationMs 抛错', () => {
    expect(ProcessFinishedPayload.parse({ task: 'build', exitCode: 0, durationMs: 1200 })).toEqual({
      task: 'build',
      exitCode: 0,
      durationMs: 1200,
    });
    expect(() => ProcessFinishedPayload.parse({ task: 'build', exitCode: 0 })).toThrow();
  });
});
