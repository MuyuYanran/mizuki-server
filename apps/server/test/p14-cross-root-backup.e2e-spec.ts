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
 * [跨根备份] 内容仓文件的 pre_write 快照与恢复 —— **装配层** e2e
 *
 * 这是「跨根 pre_write 备份」批次的**核心验收**，钉四条：
 * ① 在 Shirone external（**内容仓在主题根之外**）档下改文章 ⇒ 真的产出 `pre_write` 快照
 *    （旧行为是跳过 + warn，用户没有悔棋）；
 * ② manifest 条目带 `root: 'content'`，且 **manifest.json 里零绝对路径**（红线 6）；
 * ③ 通过 `POST /admin/backups/:id/restore` **真实还原内容仓文件**（改坏 → 恢复 → 内容回来）；
 * ④ 恢复后的**安全闸门**：把内容仓配置撤掉（模拟用户切回 local / 切 git 源）后再恢复
 *    同一份备份 ⇒ **400 + 指路**，且内容仓目录零字节变化（绝不往代码仓盲目倾倒）。
 *
 * 为什么必须有装配层：备份/恢复是**唯一**能覆盖既有文件的通道，一旦路径解析错
 * 就是往宿主机任意位置回灌。单测证明不了 Nest 装配下的真实路由与 manifest 往返。
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-xroot-backup-'));
const state = { dbSeq: 0, dbPath: '' };

function nextDb(): void {
  state.dbSeq += 1;
  state.dbPath = path.join(tmp, `mizuki-${state.dbSeq}.db`);
  process.env['MIZUKI_DB_PATH'] = state.dbPath;
  process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, `config-${state.dbSeq}.json`);
}

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

interface Harness {
  close: () => Promise<void>;
  server: () => request.SuperTest<request.Test>;
}

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

/** 递归列出备份目录下所有 manifest.json 的原始文本（用于扫绝对路径） */
function allManifestTexts(dir: string): string[] {
  const out: string[] = [];
  const walk = (cur: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name === 'manifest.json') out.push(fs.readFileSync(abs, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

describe('[跨根备份] 内容仓文件的 pre_write 快照与恢复', () => {
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('①~④ content 根文件：备份 → 改坏 → 恢复 → 安全闸门', async () => {
    nextDb();
    const root = makeShironeRoot('root-xroot');
    const contentRepo = path.join(tmp, 'content-repo-xroot');
    const postDir = path.join(contentRepo, 'content', 'posts', 'xroot');
    fs.mkdirSync(postDir, { recursive: true });
    const postAbs = path.join(postDir, 'index.md');
    const ORIGINAL = '---\ntitle: 原始标题\npublished: "2026-10-01"\n---\n原始正文\n';
    fs.writeFileSync(postAbs, ORIGINAL, 'utf8');
    fs.writeFileSync(
      path.join(root, MANIFEST_FILE),
      JSON.stringify({ schemaVersion: 1, source: { type: 'path', path: contentRepo } }, null, 2),
      'utf8',
    );

    const h = await boot(root);
    try {
      // ── ① 改文章 ⇒ 应产出 pre_write 快照（旧行为是跳过）──
      const patch = await h.server()
        .patch('/api/v1/admin/posts/xroot')
        .send({ frontmatter: { title: '被改坏的标题' }, content: '被改坏的正文\n' });
      expect(patch.status).toBe(200);
      expect(fs.readFileSync(postAbs, 'utf8')).toContain('被改坏的标题');

      const list = await h.server().get('/api/v1/admin/backups');
      expect(list.status).toBe(200);
      const preWrites = (list.body as Array<{ id: string; scope: string }>).filter(
        (b) => b.scope === 'pre_write',
      );
      expect(preWrites.length).toBeGreaterThan(0);

      // ── ② manifest 带 root:'content' 且零绝对路径 ──
      const backupDir = path.join(tmp, 'backups-root-xroot');
      const manifests = allManifestTexts(backupDir);
      expect(manifests.length).toBeGreaterThan(0);
      for (const text of manifests) {
        expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
        expect(text).not.toContain(contentRepo);
      }
      const hasContentRootTag = manifests.some((text) => text.includes('"root": "content"'));
      expect(hasContentRootTag).toBe(true);

      // ── ③ 通过 REST 恢复 ⇒ 内容仓文件真的回到原文 ──
      const target = preWrites[preWrites.length - 1];
      expect(target).toBeDefined();
      if (!target) return;
      const restore = await h.server()
        .post(`/api/v1/admin/backups/${target.id}/restore`)
        .send({ confirm: true });
      expect(restore.status).toBe(200);
      expect(fs.readFileSync(postAbs, 'utf8')).toBe(ORIGINAL);
    } finally {
      await h.close();
    }
  });

  it('④ 内容源被撤掉后恢复 content 条目 ⇒ 400 指路，且内容仓零字节变化', async () => {
    nextDb();
    const root = makeShironeRoot('root-xroot-gate');
    const contentRepo = path.join(tmp, 'content-repo-gate');
    const postDir = path.join(contentRepo, 'content', 'posts', 'gated');
    fs.mkdirSync(postDir, { recursive: true });
    const postAbs = path.join(postDir, 'index.md');
    fs.writeFileSync(
      postAbs,
      '---\ntitle: 受保护\npublished: "2026-10-02"\n---\n正文\n',
      'utf8',
    );
    const manifestAbs = path.join(root, MANIFEST_FILE);
    fs.writeFileSync(
      manifestAbs,
      JSON.stringify({ schemaVersion: 1, source: { type: 'path', path: contentRepo } }, null, 2),
      'utf8',
    );

    const h = await boot(root);
    try {
      // 先制造一份含 content 条目的 pre_write 备份
      await h.server()
        .patch('/api/v1/admin/posts/gated')
        .send({ frontmatter: { title: '改一下' } });
      const list = await h.server().get('/api/v1/admin/backups');
      const preWrites = (list.body as Array<{ id: string; scope: string }>).filter(
        (b) => b.scope === 'pre_write',
      );
      const target = preWrites[preWrites.length - 1];
      expect(target).toBeDefined();
      if (!target) return;

      // 现在把内容分离**撤掉**（等同用户切回 local 模式 / 切到 git 源）
      fs.rmSync(manifestAbs, { force: true });
      const beforeRepo = fs.readFileSync(postAbs, 'utf8');

      const restore = await h.server()
        .post(`/api/v1/admin/backups/${target.id}/restore`)
        .send({ confirm: true });
      expect(restore.status).toBe(400);
      expect(String(restore.body.message)).toContain('内容仓');
      expect(String(restore.body.message)).toContain('下一步');
      // 零绝对路径泄漏
      expect(JSON.stringify(restore.body)).not.toMatch(/[A-Za-z]:[\\/]/);
      // 内容仓文件一个字节都没变
      expect(fs.readFileSync(postAbs, 'utf8')).toBe(beforeRepo);
    } finally {
      await h.close();
    }
  });

  it('⑤ 主题根内文件（存量语义）恢复仍正常 —— 向下兼容回归锚', async () => {
    nextDb();
    const root = makeShironeRoot('root-xroot-theme');
    const cfgAbs = path.join(root, 'src', 'data', 'diary.ts');
    const ORIGINAL = 'export const diary = [];\n';
    fs.writeFileSync(cfgAbs, ORIGINAL, 'utf8');

    const h = await boot(root);
    try {
      // 造一份 manual 文件备份（full 覆盖 src/data），再改坏、再恢复
      const made = await h.server().post('/api/v1/admin/backups').send({ scope: 'data' });
      expect([200, 201]).toContain(made.status);
      fs.writeFileSync(cfgAbs, 'export const diary = [1, 2, 3];\n', 'utf8');

      const restore = await h.server()
        .post(`/api/v1/admin/backups/${made.body.id}/restore`)
        .send({ confirm: true });
      expect(restore.status).toBe(200);
      expect(fs.readFileSync(cfgAbs, 'utf8')).toBe(ORIGINAL);
      // 纯 theme 备份的 manifest 不得出现 root 标签（存量布局零变化）
      const manifests = allManifestTexts(path.join(tmp, 'backups-root-xroot-theme'));
      expect(manifests.length).toBeGreaterThan(0);
      for (const text of manifests) {
        expect(text).not.toContain('"root"');
      }
    } finally {
      await h.close();
    }
  });
});
