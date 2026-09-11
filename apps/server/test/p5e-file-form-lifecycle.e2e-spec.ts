import 'reflect-metadata';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OnEvent } from '@nestjs/event-emitter';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { ContentChangedPayload, EVENTS, PostChangedPayload } from '../../../packages/shared/src/events';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [Phase4-D4f] file-form 全生命周期 e2e（F2 创建 / F3 删除解除 / F4 封面文案）
 *
 * 授权锚（架构师 2026-09-08，微批次 D4f）：
 *   F2-① file-form 创建往返（form:'file' → posts/<slug>.md 同管线 + 事件投影）；
 *   F2-② slug 双向 409（存在同名目录或同名 .md 均 409——URL 命名空间共享；缺省 form=dir 锚）；
 *   F3-① 删除可恢复（单文件 preWriteBackup + unlink，backupIds 语义同目录删除）；
 *   F4-① 封面 400 既有守卫维持 + 新文案（「单文件文章无同目录，请在 image 字段填写
 *        public 路径或外链」；p5 B2-③ 旧锚回归断言 400 不变）。
 * 纪律：PostFrontmatterSchema 两形态共用（零改动）；目录形态既有管线零触碰（p5 锚回归）。
 */
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5e-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

const postsDir = path.join(mizukiRoot, 'src/content/posts');
const fileFormAbs = (slug: string): string => path.join(postsDir, `${slug}.md`);
const dirFormAbs = (slug: string): string => path.join(postsDir, slug, 'index.md');

/** 测试事件订阅者（创建往返的事件投影断言用） */
class PostEventsSubscriber {
  static postChanged: PostChangedPayload[] = [];
  static contentChanged: ContentChangedPayload[] = [];

  @OnEvent(EVENTS.PostChanged)
  onPostChanged(payload: unknown): void {
    PostEventsSubscriber.postChanged.push(PostChangedPayload.parse(payload));
  }

  @OnEvent(EVENTS.ContentChanged)
  onContentChanged(payload: unknown): void {
    PostEventsSubscriber.contentChanged.push(ContentChangedPayload.parse(payload));
  }
}

describe('[Phase4-D4f] file-form 全生命周期 e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    PostEventsSubscriber.postChanged = [];
    PostEventsSubscriber.contentChanged = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [PostEventsSubscriber],
    })
      .overrideProvider(BACKUP_OPTIONS)
      .useValue({
        mizukiRoot,
        backupDir: path.join(tmp, 'backups'),
        dbPath: process.env['MIZUKI_DB_PATH'] as string,
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  it('F2-① file-form 创建往返：posts/<slug>.md 单文件落盘 + 读回 source=file + 索引/事件投影', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'd4f-file-post',
        frontmatter: { title: 'D4f 单文件创建', description: 'file-form 创建往返', tags: ['d4f'] },
        content: 'D4f 单文件正文。',
        form: 'file',
      });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('d4f-file-post');

    // 单文件落盘：.md 存在、同名目录不产生（无影子分叉）
    expect(fs.existsSync(fileFormAbs('d4f-file-post'))).toBe(true);
    expect(fs.existsSync(path.join(postsDir, 'd4f-file-post'))).toBe(false);

    // 读回往返：source='file'（S4 投影），frontmatter/正文保真
    const read = await server().get('/api/v1/admin/posts/d4f-file-post');
    expect(read.status).toBe(200);
    expect(read.body.source).toBe('file');
    expect(read.body.frontmatter['title']).toBe('D4f 单文件创建');
    expect(read.body.content).toBe('D4f 单文件正文。');

    // 同管线事件：post.changed.filePath 与 content.changed.filePaths 均为 .md 实路径
    const postChanged = PostEventsSubscriber.postChanged.filter(
      (e) => e.slug === 'd4f-file-post' && !e.deleted,
    );
    expect(postChanged.length).toBeGreaterThanOrEqual(1);
    expect(postChanged[0]!.filePath).toBe('src/content/posts/d4f-file-post.md');
    const contentChanged = PostEventsSubscriber.contentChanged.filter(
      (e) => e.scope === 'post' && e.filePaths.includes('src/content/posts/d4f-file-post.md'),
    );
    expect(contentChanged.length).toBeGreaterThanOrEqual(1);

    // 索引投影：sync 后 file_path 为 .md 实路径、哈希与盘上一致
    const synced = await server().post('/api/v1/admin/posts/sync');
    expect(synced.status).toBe(201);
    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const row = sqlite
      .prepare(
        "SELECT file_path, file_hash FROM article WHERE slug = 'd4f-file-post' AND source_type = 'markdown' AND deleted_at IS NULL",
      )
      .get() as { file_path: string; file_hash: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.file_path).toBe('src/content/posts/d4f-file-post.md');
    const onDisk = fs.readFileSync(fileFormAbs('d4f-file-post'), 'utf8');
    expect(row!.file_hash).toBe(createHash('sha256').update(onDisk).digest('hex'));
  });

  it('F2-② slug 双向 409：同名目录或同名 .md 任一占用均拒绝（URL 命名空间共享）；缺省 form=dir 锚', async () => {
    // 缺省形态锚：不传 form → 目录式落盘（缺省 'dir'）
    const dirCreate = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'd4f-clash-dir', frontmatter: { title: '目录式占用' }, content: 'x' });
    expect(dirCreate.status).toBe(201);
    expect(fs.existsSync(dirFormAbs('d4f-clash-dir'))).toBe(true);

    // 方向①：目录已占用 → file 形态创建 409（盘上无残留 .md）
    const fileVsDir = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'd4f-clash-dir', frontmatter: { title: 'y' }, content: 'x', form: 'file' });
    expect(fileVsDir.status).toBe(409);
    expect(fs.existsSync(fileFormAbs('d4f-clash-dir'))).toBe(false);

    // 方向②：.md 已占用 → 目录形态创建 409（盘上无残留目录）
    const fileCreate = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'd4f-clash-file', frontmatter: { title: '文件式占用' }, content: 'x', form: 'file' });
    expect(fileCreate.status).toBe(201);
    const dirVsFile = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'd4f-clash-file', frontmatter: { title: 'y' }, content: 'x' });
    expect(dirVsFile.status).toBe(409);
    expect(fs.existsSync(path.join(postsDir, 'd4f-clash-file'))).toBe(false);

    // 同形态冲突：.md 已占用 → file 形态再建 409
    const fileVsFile = await server()
      .post('/api/v1/admin/posts')
      .send({ slug: 'd4f-clash-file', frontmatter: { title: 'y' }, content: 'x', form: 'file' });
    expect(fileVsFile.status).toBe(409);
  });

  it('F3-① 删除可恢复：单文件 preWriteBackup + unlink，backupIds 语义同目录删除', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'd4f-del-file',
        frontmatter: { title: 'D4f 待删除单文件', description: '删除恢复载体' },
        content: 'D4f 删除恢复正文。',
        form: 'file',
      });
    expect(created.status).toBe(201);
    await server().post('/api/v1/admin/posts/sync');

    // 删除：200 + backupIds（单文件一份）+ 盘上消失 + 详情 404 + 索引行软删
    const removed = await server().delete('/api/v1/admin/posts/d4f-del-file');
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    const backupIds = removed.body.backupIds as string[];
    expect(backupIds.length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(fileFormAbs('d4f-del-file'))).toBe(false);
    expect((await server().get('/api/v1/admin/posts/d4f-del-file')).status).toBe(404);

    const sqlite = app.get<Database.Database>(SQLITE_CONNECTION);
    const softRow = sqlite
      .prepare("SELECT deleted_at FROM article WHERE slug = 'd4f-del-file' AND source_type = 'markdown'")
      .get() as { deleted_at: string | null } | undefined;
    expect(softRow).toBeDefined();
    expect(softRow!.deleted_at).not.toBeNull();

    // 恢复：逐备份 restore → sync → 文件与索引行完整回来（内容往返一致）
    for (const id of backupIds) {
      const restored = await server().post(`/api/v1/admin/backups/${id}/restore`).send({ confirm: true });
      expect(restored.status).toBe(200);
    }
    expect(fs.existsSync(fileFormAbs('d4f-del-file'))).toBe(true);

    await server().post('/api/v1/admin/posts/sync');
    const revived = sqlite
      .prepare("SELECT deleted_at, file_path FROM article WHERE slug = 'd4f-del-file' AND source_type = 'markdown'")
      .get() as { deleted_at: string | null; file_path: string } | undefined;
    expect(revived).toBeDefined();
    expect(revived!.deleted_at).toBeNull();
    expect(revived!.file_path).toBe('src/content/posts/d4f-del-file.md');

    const read = await server().get('/api/v1/admin/posts/d4f-del-file');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter['title']).toBe('D4f 待删除单文件');
    expect(read.body.content).toBe('D4f 删除恢复正文。');
  });

  it('F4-① 封面 400 守卫维持 + 新文案（「单文件文章无同目录，请在 image 字段填写 public 路径或外链」）', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'd4f-cover-file',
        frontmatter: { title: 'D4f 封面守卫' },
        content: 'x',
        form: 'file',
      });
    expect(created.status).toBe(201);

    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 60, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
    const cover = await server().post('/api/v1/admin/posts/d4f-cover-file/cover').attach('file', png, 'cover.png');
    expect(cover.status).toBe(400);
    expect(JSON.stringify(cover.body)).toContain('单文件文章无同目录，请在 image 字段填写 public 路径或外链');

    // 拒绝路径零副作用：源文件仍在且未产生目录/cover.jpg
    expect(fs.existsSync(fileFormAbs('d4f-cover-file'))).toBe(true);
    expect(fs.existsSync(path.join(postsDir, 'd4f-cover-file'))).toBe(false);
  });
});
