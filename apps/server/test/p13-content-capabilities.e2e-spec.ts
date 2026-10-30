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
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * [T4-4 汇总] `GET /admin/theme/content-capabilities` —— 能力速查端点装配层 e2e
 *
 * 为什么单独一个 spec：这是个**新挂的只读端点**，它依赖 `ThemeAdapterService` 的真实
 * Nest 装配（本项目有 `import type` 破 DI 的前科）。同时钉两件事：
 * ① 三档主题各自产出正确摘要；
 * ② 响应体**零绝对路径**（红线 6）—— `capabilities` 本身不含路径，但装配链上任何
 *    误把 `layout.root` 透出的改动都必须被这条断言挡下。
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-cap-e2e-'));
const state = { dbSeq: 0 };

function nextDbPath(): void {
  state.dbSeq += 1;
  process.env['MIZUKI_DB_PATH'] = path.join(tmp, `mizuki-${state.dbSeq}.db`);
  process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, `config-${state.dbSeq}.json`);
}

function baseProject(name: string, astroVersion: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: `${name}-fixture`, private: true, dependencies: { astro: astroVersion } },
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
  fs.mkdirSync(path.join(root, 'src', 'content', 'posts'), { recursive: true });
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
      dbPath: process.env['MIZUKI_DB_PATH'] as string,
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

describe('[汇总] GET /admin/theme/content-capabilities', () => {
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('① Mizuki legacy：仅 .md，无内容集合', async () => {
    nextDbPath();
    const root = baseProject('cap-mizuki', '^6.1.2');
    fs.writeFileSync(path.join(root, 'src', 'config.ts'), 'export const a = 1;\n', 'utf8');
    const h = await boot(root);
    try {
      const res = await h.server().get('/api/v1/admin/theme/content-capabilities');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        postExtensions: ['.md'],
        contentCollections: false,
        contentCollectionIds: [],
        frontmatterSchemaId: 'mizuki-posts',
      });
      expect(res.body.headline).toContain('Markdown 文章');
      expect(res.body.headline).not.toContain('内容集合');
      expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:[\\/]/);
    } finally {
      await h.close();
    }
  });

  it('② Shirone：.md + .mdx，且支持 series / moments', async () => {
    nextDbPath();
    const root = baseProject('cap-shirone', '^7.3.8');
    fs.mkdirSync(path.join(root, 'src', 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'config', 'integrationsConfig.ts'), '', 'utf8');
    const h = await boot(root);
    try {
      const res = await h.server().get('/api/v1/admin/theme/content-capabilities');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        postExtensions: ['.md', '.mdx'],
        contentCollections: true,
        contentCollectionIds: ['series', 'moments'],
        frontmatterSchemaId: 'shirone-posts',
      });
      expect(res.body.headline).toContain('series');
      expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:[\\/]/);
    } finally {
      await h.close();
    }
  });

  it('③ 无法判档的主题根 ⇒ unknown 档全空能力面（headline 明确说「不支持」）', async () => {
    nextDbPath();
    // init 的项目检测**强制**要求 astro 依赖，而 ThemeAdapter 的阶梯 5 兜底是
    // 「astro 依赖 + (legacyConfigFile 或 diary.ts)」⇒ 只要两个叶子都不命中就是 unknown。
    // 故造 unknown 的正确姿势：**有 astro 依赖**（过 init）+ 无 src/config.ts +
    // **无 src/data/diary.ts**（只留 friends.ts），且三档判档叶子全不命中。
    const root = path.join(tmp, 'cap-unknown');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        { name: 'unknown-fixture', private: true, dependencies: { astro: '^7.3.8' } },
        null,
        2,
      ),
      'utf8',
    );
    fs.writeFileSync(path.join(root, 'astro.config.mjs'), 'export default {};\n', 'utf8');
    fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src', 'data', 'friends.ts'),
      'export const friends = [];\n',
      'utf8',
    );
    fs.mkdirSync(path.join(root, 'src', 'content', 'posts'), { recursive: true });

    const h = await boot(root);
    try {
      const res = await h.server().get('/api/v1/admin/theme/content-capabilities');
      expect(res.status).toBe(200);
      // 端点如实反映**能力画像**（unknown 档 posts.supported=false、extensions=[]）
      expect(res.body.headline).toBe('当前主题不支持内容管理');
      expect(res.body.postExtensions).toEqual([]);
      expect(res.body.contentCollections).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:[\\/]/);
    } finally {
      await h.close();
    }
  });
});
