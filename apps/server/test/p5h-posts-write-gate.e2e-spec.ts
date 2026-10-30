import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MANIFEST_FILE } from '../src/common/theme/content-source';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [T4-3b → T4-4] posts 写入的**持久性与路径跟随** —— 真实 HTTP 路径 e2e
 *
 * 本 spec 在 T4-3b 时刻是用来证明「external 档一律拒绝」的。T4-4 落地后语义升级：
 * **external + 本地 path 源不再被拒，而是真正写入内容仓**。故本文件整体重写为三条轴：
 *
 *  A. **写穿内容仓**（T4-4 新增能力）：external + path 源 ⇒ 201/200，文件落在**内容仓**，
 *     代码仓 `src/content/posts` 递归快照**零字节变化**（证明没有写进那个会被 prune 掉的副本）。
 *  B. **仍被拒的三种结构性不可写**：git 源 / `mounts.content: null` / `mounts` 非法
 *     ⇒ 403 + 固定错误形状 + 指路牌，且盘上零字节变化。
 *  C. **读侧一致性**：external 档下列表与详情读的是内容仓；git 源下降级读代码仓副本
 *     （读安全、写才拒），且不影响任何写闸门。
 *
 * 为什么必须有装配层：本项目已有 T3b-2b 的 `import type` 破 DI 前科（单测用 `new` 实例化，
 * DI 从未被真正走过）。posts 的闸门与路径跟随都依赖 `getAppConfig()` 与真实 Nest 装配，
 * 单测证明不了「HTTP 层真的吐出预期状态码」。
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-t44-e2e-'));
const state = { dbPath: '' };

/** 建一个能通过 init 项目检测的最小 Shirone 主题根 */
function makeShironeRoot(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'shirone-fixture', private: true, dependencies: { astro: '^7.3.8' } },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'astro.config.mjs'), 'export default {};\n', 'utf8');
  fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'data', 'diary.ts'), 'export const diary = [];\n', 'utf8');
  fs.writeFileSync(
    path.join(root, 'src', 'data', 'friends.ts'),
    'export const friends = [];\n',
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'src', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'config', 'integrationsConfig.ts'), '', 'utf8');
  fs.mkdirSync(path.join(root, 'src', 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'content', 'spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'content', 'spec', 'about.md'), '# about\n', 'utf8');
  return root;
}

/** 递归快照（证明「该没写的地方零字节变化」） */
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (cur: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) walk(abs, rel);
      else if (e.isFile()) out[rel] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

interface Harness {
  close: () => Promise<void>;
  server: () => request.SuperTest<request.Test>;
}

/** 启动指向指定主题根的独立 app 实例（每档一份，互不污染限流与 db） */
async function boot(root: string): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BACKUP_OPTIONS)
    .useValue({
      mizukiRoot: root,
      backupDir: path.join(tmp, `backups-${path.basename(root)}`),
      dbPath: state.dbPath,
    })
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const token = await initAndLogin(request(app.getHttpServer()), root);
  return {
    server: () => withAuth(request(app.getHttpServer()), () => token),
    close: async (): Promise<void> => {
      await app.close();
      app.get<Database.Database>(SQLITE_CONNECTION).close();
    },
  };
}

let dbSeq = 0;
function nextDbPath(): void {
  dbSeq += 1;
  state.dbPath = path.join(tmp, `mizuki-${dbSeq}.db`);
  process.env['MIZUKI_DB_PATH'] = state.dbPath;
  process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, `config-${dbSeq}.json`);
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('[T4-4] posts 路径跟随与写入闸门 e2e', () => {
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── A. external + path 源：写穿内容仓 ──
  describe('A. Shirone external + 本地 path 源（写穿内容仓）', () => {
    let h: Harness;
    let root: string;
    let contentRepo: string;

    beforeAll(async () => {
      nextDbPath();
      root = makeShironeRoot('root-t44-external');
      contentRepo = path.join(tmp, 'content-repo-t44');
      fs.mkdirSync(path.join(contentRepo, 'content', 'posts'), { recursive: true });
      // 预置内容仓里已有的一篇（模拟上次 sync 的真源）
      const seeded = path.join(contentRepo, 'content', 'posts', 'seeded');
      fs.mkdirSync(seeded, { recursive: true });
      fs.writeFileSync(
        path.join(seeded, 'index.md'),
        '---\ntitle: 内容仓里的\npublished: "2026-10-01"\n---\n来自内容仓\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(root, MANIFEST_FILE),
        JSON.stringify({ schemaVersion: 1, source: { type: 'path', path: contentRepo } }, null, 2),
        'utf8',
      );
      h = await boot(root);
    });

    afterAll(async () => {
      await h.close();
    });

    it('① 创建 ⇒ 201，文件落在**内容仓**，代码仓副本零字节变化', async () => {
      const beforeCodeRepo = snapshotTree(path.join(root, 'src', 'content'));
      const res = await h.server()
        .post('/api/v1/admin/posts')
        .send({
          slug: 'followed',
          frontmatter: { title: '跟随测试', published: '2026-10-30' },
          content: '正文内容',
        });
      expect(res.status).toBe(201);

      // 落在内容仓
      const inRepo = path.join(contentRepo, 'content', 'posts', 'followed', 'index.md');
      expect(fs.existsSync(inRepo)).toBe(true);
      expect(fs.readFileSync(inRepo, 'utf8')).toContain('跟随测试');

      // 代码仓那个会被 prune 掉的副本**一个字都没变**
      expect(snapshotTree(path.join(root, 'src', 'content'))).toEqual(beforeCodeRepo);
      expect(fs.existsSync(path.join(root, 'src', 'content', 'posts', 'followed'))).toBe(false);
    });

    it('② 列表读的是内容仓（预置那篇 + 刚建那篇都在）', async () => {
      const res = await h.server().get('/api/v1/admin/posts');
      expect(res.status).toBe(200);
      const slugs = (res.body as Array<{ slug: string }>).map((p) => p.slug);
      expect(slugs).toContain('seeded');
      expect(slugs).toContain('followed');
    });

    it('③ 详情读的是内容仓（预置那篇的正文来自内容仓）', async () => {
      const res = await h.server().get('/api/v1/admin/posts/seeded');
      expect(res.status).toBe(200);
      expect(res.body.frontmatter.title).toBe('内容仓里的');
      expect(res.body.content).toContain('来自内容仓');
    });

    it('④ 修改写回内容仓（不是代码仓）', async () => {
      const beforeCodeRepo = snapshotTree(path.join(root, 'src', 'content'));
      const res = await h.server()
        .patch('/api/v1/admin/posts/followed')
        .send({ frontmatter: { title: '改过之后' } });
      expect(res.status).toBe(200);
      expect(
        fs.readFileSync(
          path.join(contentRepo, 'content', 'posts', 'followed', 'index.md'),
          'utf8',
        ),
      ).toContain('改过之后');
      expect(snapshotTree(path.join(root, 'src', 'content'))).toEqual(beforeCodeRepo);
    });

    it('⑤ 封面上传跟随文章目录（写进内容仓同目录）', async () => {
      const res = await h.server()
        .post('/api/v1/admin/posts/followed/cover')
        .attach('file', PNG_1PX, 'cover.png');
      expect(res.status).toBe(201);
      expect(
        fs.existsSync(path.join(contentRepo, 'content', 'posts', 'followed', 'cover.jpg')),
      ).toBe(true);
      // 代码仓那份没有被写进 cover.jpg
      expect(
        fs.existsSync(path.join(root, 'src', 'content', 'posts', 'followed', 'cover.jpg')),
      ).toBe(false);
    });

    it('⑥ 删除作用于内容仓', async () => {
      const res = await h.server().delete('/api/v1/admin/posts/followed');
      expect(res.status).toBe(200);
      expect(fs.existsSync(path.join(contentRepo, 'content', 'posts', 'followed'))).toBe(false);
      // 预置那篇不受影响
      expect(
        fs.existsSync(path.join(contentRepo, 'content', 'posts', 'seeded', 'index.md')),
      ).toBe(true);
    });

    it('⑦ mounts.content 被显式关闭 ⇒ 写 403（死路）且盘上零变化', async () => {
      fs.writeFileSync(
        path.join(root, MANIFEST_FILE),
        JSON.stringify(
          {
            schemaVersion: 1,
            source: { type: 'path', path: contentRepo },
            mounts: { content: null },
          },
          null,
          2,
        ),
        'utf8',
      );
      try {
        const beforeRepo = snapshotTree(path.join(contentRepo, 'content'));
        const res = await h.server()
          .post('/api/v1/admin/posts')
          .send({ slug: 'never', frontmatter: { title: 'x' }, content: 'y' });
        expect(res.status).toBe(403);
        expect(res.body.detail.reason).toBe('content-mount-disabled');
        expect(res.body.message).toContain('下一步');
        expect(snapshotTree(path.join(contentRepo, 'content'))).toEqual(beforeRepo);
      } finally {
        fs.writeFileSync(
          path.join(root, MANIFEST_FILE),
          JSON.stringify(
            { schemaVersion: 1, source: { type: 'path', path: contentRepo } },
            null,
            2,
          ),
          'utf8',
        );
      }
    });

    it('⑧ mounts 非法 ⇒ 写 403（不猜落点）', async () => {
      fs.writeFileSync(
        path.join(root, MANIFEST_FILE),
        JSON.stringify(
          {
            schemaVersion: 1,
            source: { type: 'path', path: contentRepo },
            mounts: { '../escape': 'src/x' },
          },
          null,
          2,
        ),
        'utf8',
      );
      try {
        const res = await h.server()
          .post('/api/v1/admin/posts')
          .send({ slug: 'never2', frontmatter: { title: 'x' }, content: 'y' });
        expect(res.status).toBe(403);
        expect(res.body.detail.reason).toBe('mounts-invalid');
      } finally {
        fs.writeFileSync(
          path.join(root, MANIFEST_FILE),
          JSON.stringify(
            { schemaVersion: 1, source: { type: 'path', path: contentRepo } },
            null,
            2,
          ),
          'utf8',
        );
      }
    });
  });

  // ── B. git 源：写 403 / 读降级 ──
  describe('B. Shirone external + git 源（写 403，读降级到代码仓副本）', () => {
    let h: Harness;
    let root: string;

    beforeAll(async () => {
      nextDbPath();
      root = makeShironeRoot('root-t44-git');
      fs.writeFileSync(
        path.join(root, MANIFEST_FILE),
        JSON.stringify(
          { schemaVersion: 1, source: { type: 'git', url: 'https://example.invalid/x.git' } },
          null,
          2,
        ),
        'utf8',
      );
      // 代码仓里的物化副本（模拟上次 sync 的产物）
      const seeded = path.join(root, 'src', 'content', 'posts', 'from-sync');
      fs.mkdirSync(seeded, { recursive: true });
      fs.writeFileSync(
        path.join(seeded, 'index.md'),
        '---\ntitle: 同步来的\npublished: "2026-09-01"\n---\n副本正文\n',
        'utf8',
      );
      h = await boot(root);
    });

    afterAll(async () => {
      await h.close();
    });

    it('① 创建 ⇒ 403 content-source-git，且代码仓副本零字节变化', async () => {
      const before = snapshotTree(path.join(root, 'src', 'content'));
      const res = await h.server()
        .post('/api/v1/admin/posts')
        .send({ slug: 'git-write', frontmatter: { title: 'x' }, content: 'y' });
      expect(res.status).toBe(403);
      expect(res.body.detail.reason).toBe('content-source-git');
      expect(res.body.message).toContain('下一步');
      expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(snapshotTree(path.join(root, 'src', 'content'))).toEqual(before);
    });

    it('② 读降级：列表与详情仍 200（读代码仓物化副本是安全的）', async () => {
      const list = await h.server().get('/api/v1/admin/posts');
      expect(list.status).toBe(200);
      expect((list.body as Array<{ slug: string }>).map((p) => p.slug)).toContain('from-sync');

      const one = await h.server().get('/api/v1/admin/posts/from-sync');
      expect(one.status).toBe(200);
      expect(one.body.frontmatter.title).toBe('同步来的');
    });

    it('③ 改与删同样 403（写侧无降级）', async () => {
      expect(
        (await h.server().patch('/api/v1/admin/posts/from-sync').send({ content: 'x' })).status,
      ).toBe(403);
      expect((await h.server().delete('/api/v1/admin/posts/from-sync')).status).toBe(403);
      expect(
        fs.existsSync(path.join(root, 'src', 'content', 'posts', 'from-sync', 'index.md')),
      ).toBe(true);
    });
  });
});
