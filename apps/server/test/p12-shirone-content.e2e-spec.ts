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
 * [T5b-2] series / moments 内容集合 —— **装配层** e2e（真实 HTTP 路径）
 *
 * 为什么必须这一层：单测能证明 schema 与寻址底座各自正确，但证明不了三件事：
 * ① 控制器真被 Nest 装配、路由真挂上（本项目已有一次 `import type` 破 DI 的前科）；
 * ② **`safeJoin` 监狱根真的随 `dirAbs` 切换** —— external 档必须写进内容仓，
 *    而不是写进代码仓那个会被 `content:sync` 裁掉的副本（ADR-028 §22.2）；
 * ③ 主题不支持时是 **404**（资源不存在），配置被拒时是 **403**（越权/落点不安全），
 *    两者不能混（混了面板就没法给不同指引）。
 *
 * 四档四组：
 *  A. `local`（Shirone，无内容分离）—— 读写删全走代码仓 `<root>/src/content/<subdir>`
 *  B. `external` + **path 源**（内容仓在主题根**之外**）—— 写穿内容仓、代码仓零脏写、
 *     且因目标在根外 `backupSkipped: true`
 *  C. `external` + **git 源** —— 写 403、读只读回退到 `.content-src` 工作副本
 *  D. `mizuki` 档 —— 读写皆 404（该主题没这两个集合）
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-t5b2-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');

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
  // Shirone 判档标志文件
  fs.mkdirSync(path.join(root, 'src', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'config', 'integrationsConfig.ts'), '', 'utf8');
  for (const sub of ['posts', 'series', 'moments', 'spec']) {
    fs.mkdirSync(path.join(root, 'src', 'content', sub), { recursive: true });
  }
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
  app: INestApplication;
  token: string;
  server: () => request.SuperTest<request.Test>;
  close: () => Promise<void>;
}

/** 启动一个指向指定主题根的独立 app 实例（每档一个，互不污染限流与 db） */
async function boot(root: string): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BACKUP_OPTIONS)
    .useValue({
      mizukiRoot: root,
      backupDir: path.join(tmp, `backups-${path.basename(root)}`),
      dbPath: process.env['MIZUKI_DB_PATH'] as string,
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const token = await initAndLogin(request(app.getHttpServer()), root);
  return {
    app,
    token,
    server: () => withAuth(request(app.getHttpServer()), () => token),
    close: async (): Promise<void> => {
      await app.close();
      app.get<Database.Database>(SQLITE_CONNECTION).close();
    },
  };
}

// 每个档位用独立 db 文件，避免 sqlite 连接互锁
let dbSeq = 0;
function nextDbPath(): string {
  dbSeq += 1;
  return path.join(tmp, `mizuki-${dbSeq}.db`);
}

describe('[T5b-2] series / moments e2e', () => {
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── A. local 档 ──
  describe('A. Shirone local 档（代码仓即真源）', () => {
    let h: Harness;
    let root: string;

    beforeAll(async () => {
      process.env['MIZUKI_DB_PATH'] = nextDbPath();
      root = makeShironeRoot('root-local');
      h = await boot(root);
    });

    afterAll(async () => {
      await h.close();
    });

    it('① series 创建：写进代码仓 <root>/src/content/series/<slug>.md，needsSync=false', async () => {
      const res = await h.server().post('/api/v1/admin/content/series').send({
        slug: 'my-series',
        frontmatter: { title: '我的系列', status: 'ongoing' },
        content: '系列说明正文',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        slug: 'my-series',
        needsSync: false,
        backupSkipped: false,
      });
      const abs = path.join(root, 'src', 'content', 'series', 'my-series.md');
      expect(fs.existsSync(abs)).toBe(true);
      const text = fs.readFileSync(abs, 'utf8');
      expect(text).toContain('title: 我的系列');
      // 零默认值物化：没写的 defaultCategory 不得凭空出现
      expect(text).not.toContain('defaultCategory');
    });

    it('② moments 创建：images 走 {src, alt?} 对象数组', async () => {
      const res = await h.server()
        .post('/api/v1/admin/content/moments')
        .send({
          slug: 'm1',
          frontmatter: {
            published: '2026-10-30',
            mood: 'happy',
            images: [{ src: '/images/a.jpg' }],
          },
          content: '今天很好',
        });
      expect(res.status).toBe(201);
      const text = fs.readFileSync(
        path.join(root, 'src', 'content', 'moments', 'm1.md'),
        'utf8',
      );
      expect(text).toContain('src: /images/a.jpg');
      // 写入口面不把 alt 补成空串
      expect(text).not.toContain('alt:');
    });

    it('③ moments 缺必填 published ⇒ 400 + issues', async () => {
      const res = await h.server()
        .post('/api/v1/admin/content/moments')
        .send({ slug: 'bad', frontmatter: { mood: 'x' } });
      expect(res.status).toBe(400);
      expect(fs.existsSync(path.join(root, 'src', 'content', 'moments', 'bad.md'))).toBe(false);
    });

    it('④ series status 非法枚举 ⇒ 400（enum 约束保留）', async () => {
      const res = await h.server()
        .post('/api/v1/admin/content/series')
        .send({ slug: 's2', frontmatter: { title: 'T', status: 'archived' } });
      expect(res.status).toBe(400);
    });

    it('⑤ slug 路径穿越 ⇒ 400，且盘上无越界文件', async () => {
      const res = await h.server()
        .post('/api/v1/admin/content/series')
        .send({ slug: '../../evil', frontmatter: { title: 'E' } });
      expect(res.status).toBe(400);
      expect(fs.existsSync(path.join(root, 'src', 'content', 'evil.md'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'evil.md'))).toBe(false);
    });

    it('⑥ 列表与详情：只列 .md，返回 { slug, frontmatter, content }', async () => {
      // 放一个非 .md 干扰文件
      fs.writeFileSync(path.join(root, 'src', 'content', 'series', 'ignore.mdx'), '', 'utf8');
      const list = await h.server().get('/api/v1/admin/content/series');
      expect(list.status).toBe(200);
      const slugs = (list.body.items as Array<{ slug: string }>).map((i) => i.slug);
      expect(slugs).toContain('my-series');
      expect(slugs).not.toContain('ignore');

      const one = await h.server().get('/api/v1/admin/content/series/my-series');
      expect(one.status).toBe(200);
      expect(one.body.frontmatter.title).toBe('我的系列');
      expect(one.body.content).toContain('系列说明正文');
    });

    it('⑦ null 删键哨兵：status: null ⇒ 键从文件里消失', async () => {
      const res = await h.server()
        .patch('/api/v1/admin/content/series/my-series')
        .send({ frontmatter: { status: null } });
      expect(res.status).toBe(200);
      const text = fs.readFileSync(
        path.join(root, 'src', 'content', 'series', 'my-series.md'),
        'utf8',
      );
      expect(text).not.toContain('status:');
    });

    it('⑧ 删除：文件消失且返回 backupIds（目标在主题根内 ⇒ 备份成功）', async () => {
      const res = await h.server().delete('/api/v1/admin/content/moments/m1');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ deleted: true, backupSkipped: false });
      expect((res.body.backupIds as string[]).length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(root, 'src', 'content', 'moments', 'm1.md'))).toBe(false);
    });

    it('⑨ 读不存在的 slug ⇒ 404；重名创建 ⇒ 409', async () => {
      expect((await h.server().get('/api/v1/admin/content/series/nope')).status).toBe(404);
      const dup = await h.server()
        .post('/api/v1/admin/content/series')
        .send({ slug: 'my-series', frontmatter: { title: 'dup' } });
      expect(dup.status).toBe(409);
    });

    it('⑩ 非法 kind ⇒ 400（不触达服务层）', async () => {
      expect((await h.server().get('/api/v1/admin/content/nonsense')).status).toBe(400);
    });
  });

  // ── B. external + path 源（内容仓在主题根之外）──
  describe('B. Shirone external + 外部 path 源（写穿内容仓）', () => {
    let h: Harness;
    let root: string;
    let contentRepo: string;

    beforeAll(async () => {
      process.env['MIZUKI_DB_PATH'] = nextDbPath();
      root = makeShironeRoot('root-external');
      contentRepo = path.join(tmp, 'content-repo-absolute');
      fs.mkdirSync(path.join(contentRepo, 'content', 'series'), { recursive: true });
      fs.mkdirSync(path.join(contentRepo, 'content', 'moments'), { recursive: true });
      // 用**绝对路径**源（最严的一种：内容仓完全在主题根外）
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

    it('① 创建写进**内容仓**，代码仓副本零脏写，needsSync=true', async () => {
      const beforeRepoCopy = snapshotTree(path.join(root, 'src', 'content'));
      const res = await h.server()
        .post('/api/v1/admin/content/series')
        .send({ slug: 'ext-series', frontmatter: { title: '外部系列' }, content: '正文' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ needsSync: true });
      // 落点在内容仓
      const inRepo = path.join(contentRepo, 'content', 'series', 'ext-series.md');
      expect(fs.existsSync(inRepo)).toBe(true);
      expect(fs.readFileSync(inRepo, 'utf8')).toContain('title: 外部系列');
      // 代码仓那条会被 sync 裁掉的副本**一个字都没变**
      expect(snapshotTree(path.join(root, 'src', 'content'))).toEqual(beforeRepoCopy);
      expect(fs.existsSync(path.join(root, 'src', 'content', 'series', 'ext-series.md'))).toBe(
        false,
      );
    });

    it('② 目标在主题根外 ⇒ backupSkipped=true（不静默，响应里透出）', async () => {
      const res = await h.server()
        .post('/api/v1/admin/content/moments')
        .send({ slug: 'ext-m', frontmatter: { published: '2026-10-30' } });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ needsSync: true, backupSkipped: true });
      expect(
        fs.existsSync(path.join(contentRepo, 'content', 'moments', 'ext-m.md')),
      ).toBe(true);
    });

    it('③ 列表读的是内容仓（能看到刚写的那条）', async () => {
      const list = await h.server().get('/api/v1/admin/content/series');
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ needsSync: true, inContentRepo: true, readOnly: false });
      const slugs = (list.body.items as Array<{ slug: string }>).map((i) => i.slug);
      expect(slugs).toContain('ext-series');
    });

    it('④ 更新与删除都作用于内容仓', async () => {
      const patch = await h.server()
        .patch('/api/v1/admin/content/series/ext-series')
        .send({ frontmatter: { status: 'completed' } });
      expect(patch.status).toBe(200);
      expect(
        fs.readFileSync(path.join(contentRepo, 'content', 'series', 'ext-series.md'), 'utf8'),
      ).toContain('status: completed');

      const del = await h.server().delete('/api/v1/admin/content/series/ext-series');
      expect(del.status).toBe(200);
      expect(del.body).toMatchObject({ deleted: true, needsSync: true, backupSkipped: true });
      expect(
        fs.existsSync(path.join(contentRepo, 'content', 'series', 'ext-series.md')),
      ).toBe(false);
    });

    it('⑤ mounts.content 被显式关闭 ⇒ **读写皆 403**（连真实根都无法确定）', async () => {
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
        const read = await h.server().get('/api/v1/admin/content/series');
        expect(read.status).toBe(403);
        expect(read.body.detail.reason).toBe('content-mount-disabled');
        const write = await h.server()
          .post('/api/v1/admin/content/series')
          .send({ slug: 'never', frontmatter: { title: 'x' } });
        expect(write.status).toBe(403);
        expect(
          fs.existsSync(path.join(contentRepo, 'content', 'series', 'never.md')),
        ).toBe(false);
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

  // ── C. external + git 源 ──
  describe('C. Shirone external + git 源（写 403 / 读只读回退）', () => {
    let h: Harness;
    let root: string;

    beforeAll(async () => {
      process.env['MIZUKI_DB_PATH'] = nextDbPath();
      root = makeShironeRoot('root-git');
      fs.writeFileSync(
        path.join(root, MANIFEST_FILE),
        JSON.stringify(
          { schemaVersion: 1, source: { type: 'git', url: 'https://example.invalid/x.git' } },
          null,
          2,
        ),
        'utf8',
      );
      // 预置内容工作副本里的一条（模拟上次 sync 的产物）
      const wcDir = path.join(root, '.content-src', 'content', 'series');
      fs.mkdirSync(wcDir, { recursive: true });
      fs.writeFileSync(path.join(wcDir, 'from-sync.md'), '---\ntitle: 同步来的\n---\n正文\n', 'utf8');
      h = await boot(root);
    });

    afterAll(async () => {
      await h.close();
    });

    it('① 写 ⇒ 403 + content-source-git，且工作副本零字节变化', async () => {
      const wcDir = path.join(root, '.content-src', 'content');
      const before = snapshotTree(wcDir);
      const res = await h.server()
        .post('/api/v1/admin/content/series')
        .send({ slug: 'git-write', frontmatter: { title: 'x' } });
      expect(res.status).toBe(403);
      expect(res.body.detail.reason).toBe('content-source-git');
      expect(res.body.message).toContain('下一步');
      expect(snapshotTree(wcDir)).toEqual(before);
    });

    it('② 读 ⇒ 200，回退到 .content-src 工作副本，且 readOnly=true', async () => {
      const list = await h.server().get('/api/v1/admin/content/series');
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ readOnly: true, inContentRepo: true });
      const slugs = (list.body.items as Array<{ slug: string }>).map((i) => i.slug);
      expect(slugs).toContain('from-sync');

      const one = await h.server().get('/api/v1/admin/content/series/from-sync');
      expect(one.status).toBe(200);
      expect(one.body.frontmatter.title).toBe('同步来的');
    });

    it('③ 改与删同样 403（写侧无回退）', async () => {
      expect(
        (await h.server().patch('/api/v1/admin/content/series/from-sync').send({ content: 'x' }))
          .status,
      ).toBe(403);
      expect((await h.server().delete('/api/v1/admin/content/series/from-sync')).status).toBe(403);
      // 工作副本文件仍在
      expect(
        fs.existsSync(path.join(root, '.content-src', 'content', 'series', 'from-sync.md')),
      ).toBe(true);
    });
  });

  // ── D. mizuki 档 ──
  describe('D. Mizuki 档（主题不支持这两个集合）', () => {
    let h: Harness;

    beforeAll(async () => {
      process.env['MIZUKI_DB_PATH'] = nextDbPath();
      const root = path.join(tmp, 'root-mizuki');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(
          { name: 'mizuki-fixture', private: true, dependencies: { astro: '^6.1.2' } },
          null,
          2,
        ),
        'utf8',
      );
      fs.writeFileSync(path.join(root, 'astro.config.mjs'), 'export default {};\n', 'utf8');
      fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'src', 'data', 'diary.ts'),
        'export const diary = [];\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(root, 'src', 'data', 'friends.ts'),
        'export const friends = [];\n',
        'utf8',
      );
      // mizuki legacy 判档：单文件 src/config.ts，无 src/config/
      fs.writeFileSync(path.join(root, 'src', 'config.ts'), 'export const a = 1;\n', 'utf8');
      fs.mkdirSync(path.join(root, 'src', 'content', 'posts'), { recursive: true });
      h = await boot(root);
    });

    afterAll(async () => {
      await h.close();
    });

    it('① 读 ⇒ 404（资源不存在，不是越权）', async () => {
      const res = await h.server().get('/api/v1/admin/content/series');
      expect(res.status).toBe(404);
      expect(res.body.detail.supported).toBe(false);
    });

    it('② 写 ⇒ 404，且盘上不产生任何文件', async () => {
      const res = await h.server()
        .post('/api/v1/admin/content/moments')
        .send({ slug: 'never', frontmatter: { published: '2026-10-30' } });
      expect(res.status).toBe(404);
      expect(fs.existsSync(path.join(tmp, 'root-mizuki', 'src', 'content', 'moments'))).toBe(
        false,
      );
    });
  });
});
