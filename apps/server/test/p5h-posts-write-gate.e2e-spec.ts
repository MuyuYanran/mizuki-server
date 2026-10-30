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
 * [T4-3b] posts 写入持久性闸门 —— **真实 HTTP 路径** e2e
 *
 * 为什么必须有这一层（而不是靠 `theme-posts-write-target.spec.ts` 的 16 个单测）：
 * 单测证明的是「判定函数本身对不对」，证明不了「守卫真的接在写路径上」。
 * 本项目已有一次同类教训 —— T3b-2b 的 `import type` 让 Nest DI 在装配期断裂，
 * 而单测用 `new` 实例化，**DI 从未被真正走过**，缺陷一路溜到 e2e 才被抓到。
 * ⇒ 本 spec 只做两件事：
 *   ① Shirone **external** 档下，四个写端点全部 403 且**盘上一个字节都没变**；
 *   ② 同一套 fixture 下**读端点照常 200**（闸门只拦写，不能把读也带走）。
 *
 * [刻意不做] 不复测 Mizuki legacy/HEAD 的放行分支 —— 那由 p5 面既有 46 个 e2e 用例覆盖
 * （它们的 fixture 就是 legacy 形态，且全都真的写盘成功）。重复造同一批断言只会拖慢全量。
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-t43b-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** Shirone 形态的最小主题：`src/config/integrationsConfig.ts` + 内容分离清单 */
function makeShironeExternalTheme(): void {
  fs.mkdirSync(mizukiRoot, { recursive: true });
  // init 的「Mizuki 项目检测」五项必须过：
  // package.json（含 astro 依赖）/ astro.config / src/data（含 diary.ts 与 friends.ts）/ src/content/posts
  fs.writeFileSync(
    path.join(mizukiRoot, 'package.json'),
    JSON.stringify(
      { name: 'shirone-fixture', private: true, dependencies: { astro: '^7.3.8' } },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(path.join(mizukiRoot, 'astro.config.mjs'), 'export default {};\n', 'utf8');
  fs.mkdirSync(path.join(mizukiRoot, 'src', 'data'), { recursive: true });
  fs.writeFileSync(path.join(mizukiRoot, 'src', 'data', 'diary.ts'), 'export const diary = [];\n', 'utf8');
  fs.writeFileSync(path.join(mizukiRoot, 'src', 'data', 'friends.ts'), 'export const friends = [];\n', 'utf8');
  fs.mkdirSync(path.join(mizukiRoot, 'src', 'config'), { recursive: true });
  fs.writeFileSync(path.join(mizukiRoot, 'src', 'config', 'integrationsConfig.ts'), '', 'utf8');
  fs.mkdirSync(path.join(mizukiRoot, 'src', 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(mizukiRoot, 'src', 'content', 'spec'), { recursive: true });
  fs.writeFileSync(path.join(mizukiRoot, 'src', 'content', 'spec', 'about.md'), '# about\n', 'utf8');
  // external：有内容仓路径源 ⇒ 代码仓的 posts 是物化副本
  fs.writeFileSync(
    path.join(mizukiRoot, MANIFEST_FILE),
    JSON.stringify({ schemaVersion: 1, source: { type: 'path', path: './content-repo' } }, null, 2),
    'utf8',
  );
}

/** 递归快照（用于证明「写被拒时盘上一个字节都没变」） */
function snapshotTree(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (current: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        result[rel] = fs.readFileSync(abs, 'utf8');
      }
    }
  };
  walk(dir, '');
  return result;
}

describe('[T4-3b] posts 写入持久性闸门 e2e（Shirone external）', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    makeShironeExternalTheme();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    // beforeAll 失败时 app 可能未装配：兜底关闭，避免把「装配失败」掩盖成「close 崩」二次噪音
    if (app !== undefined) {
      await app.close();
      app.get<Database.Database>(SQLITE_CONNECTION).close();
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  it('① 创建被拒：403 + 固定错误形状 + 指路牌，盘上零变化', async () => {
    const before = snapshotTree(path.join(mizukiRoot, 'src', 'content'));
    const res = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'gate-create',
        frontmatter: { title: 'T', published: '2026-01-01' },
        content: 'body',
      });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'ForbiddenException',
      detail: { reason: 'shirone-external-copy-prune', themeKind: 'shirone' },
    });
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toContain('下一步');
    // 红线 6：响应体不含绝对路径
    expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(snapshotTree(path.join(mizukiRoot, 'src', 'content'))).toEqual(before);
    expect(fs.existsSync(path.join(mizukiRoot, 'src', 'content', 'posts', 'gate-create'))).toBe(
      false,
    );
  });

  it('② 修改被拒：先落一篇（直接写盘，绕过 API）再打 PATCH', async () => {
    const postDir = path.join(mizukiRoot, 'src', 'content', 'posts', 'gate-update');
    fs.mkdirSync(postDir, { recursive: true });
    const fileAbs = path.join(postDir, 'index.md');
    const original = '---\ntitle: 原值\npublished: 2026-01-01\n---\n正文\n';
    fs.writeFileSync(fileAbs, original, 'utf8');

    const res = await server()
      .patch('/api/v1/admin/posts/gate-update')
      .send({ frontmatter: { title: '改过' } });
    expect(res.status).toBe(403);
    expect(res.body.detail.reason).toBe('shirone-external-copy-prune');
    // 文件一个字节都没变
    expect(fs.readFileSync(fileAbs, 'utf8')).toBe(original);
  });

  it('③ 删除被拒：403 且文件仍在（不会给出「已删除」的假回执）', async () => {
    const dirAbs = path.join(mizukiRoot, 'src', 'content', 'posts', 'gate-delete');
    fs.mkdirSync(dirAbs, { recursive: true });
    fs.writeFileSync(path.join(dirAbs, 'index.md'), '---\ntitle: D\npublished: 2026-01-01\n---\n', 'utf8');

    const res = await server().delete('/api/v1/admin/posts/gate-delete');
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(dirAbs, 'index.md'))).toBe(true);
  });

  it('④ 封面上传被拒：连 cover.jpg 都不写', async () => {
    const dirAbs = path.join(mizukiRoot, 'src', 'content', 'posts', 'gate-cover');
    fs.mkdirSync(dirAbs, { recursive: true });
    fs.writeFileSync(path.join(dirAbs, 'index.md'), '---\ntitle: C\npublished: 2026-01-01\n---\n', 'utf8');
    // 1x1 PNG（走 assertImageUpload 之前的闸门，内容不必真的合法图片）
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await server()
      .post('/api/v1/admin/posts/gate-cover/cover')
      .attach('file', png, 'cover.png');
    expect(res.status).toBe(403);
    expect(res.body.detail.reason).toBe('shirone-external-copy-prune');
    expect(fs.existsSync(path.join(dirAbs, 'cover.jpg'))).toBe(false);
  });

  it('⑤ 读端点不受影响：列表 200 且能读到盘上两篇', async () => {
    const res = await server().get('/api/v1/admin/posts');
    expect(res.status).toBe(200);
    const slugs = (res.body as Array<{ slug: string }>).map((p) => p.slug);
    expect(slugs).toContain('gate-update');
    expect(slugs).toContain('gate-delete');
    // 被拒创建的那篇确实不存在
    expect(slugs).not.toContain('gate-create');
  });

  it('⑥ 单篇详情不受影响：200 + 原值（读不触发闸门）', async () => {
    const res = await server().get('/api/v1/admin/posts/gate-update');
    expect(res.status).toBe(200);
    expect((res.body as { frontmatter: { title: string } }).frontmatter.title).toBe('原值');
  });
});
