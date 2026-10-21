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
 * [U3-P4c/K1~K10] Markdown 通用导入预览 e2e（A-GAP-13 ★ 档）。
 *
 * 覆盖（9 例）：
 *   ① 无 frontmatter（正文非空）→ ok + title/published 两处派生 + 1 条 description warn；
 *   ② 三漂移名齐上（published+pubDate+date+cover）→ 产出键仅 published/image，映射表逐项对齐；
 *   ③ published 已存在 + pubDate 另有值 → published 为准，pubDate 仍被删除；
 *   ④ 非法 frontmatter（tags 字符串 / YAML 语法错）逐条 error，同批健康条目仍 ok（整批不失败）；
 *   ⑤ 空文件 / .txt / 非法日期 → empty-file / unsupported-extension / date-invalid；
 *   ⑥ slug 冲突 → conflict/slug-taken，且预览前后 posts 目录清单与 config.ts 字节零变化（只读性自证）；
 *   ⑦ 批内重复 slug → 第 2 条 duplicate-in-batch，第 1 条仍 ok；
 *   ⑧ 提交链：ok 条目逐条复用 `POST /admin/posts` → 201，盘上 `published:` 为裸日期，索引已 upsert；
 *   ⑨ 上限：31 文件一次 preview → 请求级拒绝（记录实测状态码）；单文件 > 65536 字节 → 413。
 *
 * 注：mkdtemp 临时域 + fixture cpSync 副本，真实主题目录零触碰；config.ts 由本 spec 内联写入
 * （fixture 无该文件），用于「预览零写」的逐字节自证。用例按文件序执行且共享后端实例。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p5g-import-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');
const postsDir = path.join(mizukiRoot, 'src', 'content', 'posts');
const configTsPath = path.join(mizukiRoot, 'src', 'config.ts');

/** 只读性自证的载体：预览端点若产生任何写，本文件字节会漂移 */
const CONFIG_TS = `// [p5g fixture] 预览只读性自证：写入前后必须逐字节相同
const SITE_LANG = "zh_CN";

export const siteConfig = {
  lang: SITE_LANG,
};
`;

interface ImportIssueView {
  level: 'warn' | 'error';
  path: string;
  message: string;
}

interface ImportItemView {
  name: string;
  ext: string;
  slug: string;
  form: 'dir';
  status: 'ok' | 'conflict' | 'error';
  code?: string;
  issues: ImportIssueView[];
  mapped: { renamed: string[]; derived: string[]; dropped: string[] };
  frontmatter: Record<string, unknown>;
  content: string;
}

interface ImportResponseView {
  items: ImportItemView[];
  summary: { total: number; ok: number; conflict: number; error: number };
}

/** 服务器本地日期（与 service 的 bareLocalDate 同口径；不用 toISOString 以防时区前移） */
function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 递归文件清单（相对 posts 根，排序后比对；只读性自证用） */
function listPosts(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      if (fs.statSync(abs).isDirectory()) {
        walk(abs, rel);
      } else {
        out.push(rel);
      }
    }
  };
  if (fs.existsSync(postsDir)) {
    walk(postsDir, '');
  }
  return out;
}

describe('[U3-P4c] Markdown 通用导入预览 e2e（A-GAP-13 ★）', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    fs.writeFileSync(configTsPath, CONFIG_TS);
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
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  /** multipart 预览：`files` 字段逐条 attach（文件名即 slug 派生源） */
  const preview = async (
    files: { name: string; text: string }[],
  ): Promise<request.Response> => {
    let req = server().post('/api/v1/admin/posts/import/preview');
    for (const file of files) {
      req = req.attach('files', Buffer.from(file.text, 'utf8'), file.name);
    }
    return req;
  };

  const bodyOf = (res: request.Response): ImportResponseView => res.body as ImportResponseView;

  it('① 无 frontmatter 单文件 → ok + title/published 派生 + 1 条 warn', async () => {
    const text = '# 只有正文\n\n这是没有 frontmatter 的导入件。\n';
    const res = await preview([{ name: 'p5g-no-frontmatter.md', text }]);
    expect(res.status).toBe(200);
    const item = bodyOf(res).items[0] as ImportItemView;
    expect(item.status).toBe('ok');
    expect(item.code).toBeUndefined();
    expect(item.ext).toBe('.md');
    expect(item.slug).toBe('p5g-no-frontmatter');
    expect(item.form).toBe('dir');
    // 两处必要兜底：标题 = 文件名 stem（不 slugify），日期 = 导入当日
    expect(item.frontmatter['title']).toBe('p5g-no-frontmatter');
    expect(item.frontmatter['published']).toBe(localToday());
    expect(item.mapped.derived).toEqual(expect.arrayContaining(['title', 'published']));
    expect(item.mapped.renamed).toEqual([]);
    expect(item.mapped.dropped).toEqual([]);
    // description 不派生，只提示（K3）
    expect(item.frontmatter['description']).toBeUndefined();
    expect(item.issues).toHaveLength(1);
    expect(item.issues[0]?.level).toBe('warn');
    expect(item.issues[0]?.path).toBe('description');
    // 正文原样回传（浏览器不得自行切 YAML —— 再裁 A）
    expect(item.content).toBe(text);
    expect(bodyOf(res).summary).toEqual({ total: 1, ok: 1, conflict: 0, error: 0 });
  });

  it('② 三漂移名齐上 → 产出键仅 published/image，映射表逐项对齐 K3', async () => {
    const text = `---
title: 三漂移
published: 2025-01-02
pubDate: 2025-03-04
date: 2025-05-06
cover: /images/cover.webp
tags: [a, b]
---
正文
`;
    const res = await preview([{ name: 'p5g-drift.md', text }]);
    expect(res.status).toBe(200);
    const item = bodyOf(res).items[0] as ImportItemView;
    expect(item.status).toBe('ok');
    // 产出键集：主题契约内 + 映射产出，pubDate/date/cover 一个不留
    expect(Object.keys(item.frontmatter).sort()).toEqual(['image', 'published', 'tags', 'title']);
    expect(item.frontmatter['published']).toBe('2025-01-02'); // published 已存在 → 原值优先
    expect(item.frontmatter['image']).toBe('/images/cover.webp');
    expect(item.mapped.renamed).toEqual(['cover→image']);
    expect(item.mapped.dropped).toEqual(['pubDate', 'date']);
    expect(item.mapped.derived).toEqual([]);
  });

  it('③ published 已存在 + pubDate 另有值 → published 为准，pubDate 仍被删除', async () => {
    const text = `---
title: 双日期
published: 2025-02-03
pubDate: 2025-09-09
---
正文
`;
    const res = await preview([{ name: 'p5g-published-wins.md', text }]);
    const item = bodyOf(res).items[0] as ImportItemView;
    expect(item.status).toBe('ok');
    expect(item.frontmatter['published']).toBe('2025-02-03');
    expect(item.frontmatter['pubDate']).toBeUndefined();
    // 未被采用 → 不产生「改名」标记，只记「删除」
    expect(item.mapped.renamed).toEqual([]);
    expect(item.mapped.dropped).toEqual(['pubDate']);
  });

  it('④ 非法 frontmatter 逐条报错，整批不失败（同批 ok 仍 ok）', async () => {
    const res = await preview([
      {
        name: 'p5g-bad-tags.md',
        text: '---\ntitle: tags 类型错\npublished: 2025-04-05\ntags: "a,b"\n---\n正文\n',
      },
      {
        name: 'p5g-bad-yaml.md',
        // YAML 语法错（flow collection 未闭合）→ 单条 frontmatter-invalid，不得抛 500
        text: '---\ntitle: [unclosed\n---\n正文\n',
      },
      {
        name: 'p5g-healthy.md',
        text: '---\ntitle: 健康条目\npublished: 2025-04-06\ndescription: 有描述\n---\n正文\n',
      },
    ]);
    expect(res.status).toBe(200);
    const body = bodyOf(res);
    expect(body.summary).toEqual({ total: 3, ok: 1, conflict: 0, error: 2 });

    const badTags = body.items[0] as ImportItemView;
    expect(badTags.status).toBe('error');
    expect(badTags.code).toBe('frontmatter-invalid');
    expect(badTags.issues[0]?.path).toBe('tags');

    const badYaml = body.items[1] as ImportItemView;
    expect(badYaml.status).toBe('error');
    expect(badYaml.code).toBe('frontmatter-invalid');
    expect(badYaml.issues[0]?.path).toBe('frontmatter');

    const healthy = body.items[2] as ImportItemView;
    expect(healthy.status).toBe('ok');
    expect(healthy.code).toBeUndefined();
  });

  it('⑤ 空文件 / 扩展名非白名单 / 非法日期 → 三个独立错误码', async () => {
    const res = await preview([
      { name: 'p5g-empty.md', text: '' },
      { name: 'p5g-note.txt', text: 'hello\n' },
      {
        name: 'p5g-bad-date.md',
        text: '---\ntitle: 日期非法\npublished: "2025-13-45"\n---\n正文\n',
      },
    ]);
    expect(res.status).toBe(200);
    const body = bodyOf(res);
    expect(body.items[0]?.code).toBe('empty-file');
    expect(body.items[0]?.status).toBe('error');
    expect(body.items[1]?.code).toBe('unsupported-extension');
    expect(body.items[1]?.status).toBe('error');
    expect(body.items[1]?.ext).toBe('.txt');
    expect(body.items[2]?.code).toBe('date-invalid');
    expect(body.items[2]?.status).toBe('error');
    expect(body.items[2]?.issues[0]?.path).toBe('published');
    expect(body.summary).toEqual({ total: 3, ok: 0, conflict: 0, error: 3 });
  });

  it('⑥ slug 冲突 → conflict/slug-taken，预览前后 posts 清单与 config.ts 字节零变化', async () => {
    const created = await server()
      .post('/api/v1/admin/posts')
      .send({
        slug: 'p5g-taken',
        frontmatter: { title: '已占用', published: '2025-01-01' },
        content: 'x\n',
      });
    expect(created.status).toBe(201);

    const listingBefore = listPosts();
    const configBefore = fs.readFileSync(configTsPath, 'utf8');

    const res = await preview([
      {
        name: 'p5g-taken.md',
        text: '---\ntitle: 撞车\npublished: 2025-05-05\n---\n正文\n',
      },
    ]);
    expect(res.status).toBe(200);
    const item = bodyOf(res).items[0] as ImportItemView;
    expect(item.status).toBe('conflict');
    expect(item.code).toBe('slug-taken');

    // 只读性自证：预览不落盘、不建临时文件、不碰 config.ts
    expect(listPosts()).toEqual(listingBefore);
    expect(fs.readFileSync(configTsPath, 'utf8')).toBe(configBefore);
  });

  it('⑦ 批内重复 slug → 第 2 条 duplicate-in-batch，第 1 条仍 ok', async () => {
    const res = await preview([
      { name: 'p5g-dup.md', text: '---\ntitle: 第一条\npublished: 2025-06-01\n---\nA\n' },
      { name: 'p5g-dup.md', text: '---\ntitle: 第二条\npublished: 2025-06-02\n---\nB\n' },
    ]);
    expect(res.status).toBe(200);
    const body = bodyOf(res);
    expect(body.items[0]?.status).toBe('ok');
    expect(body.items[0]?.code).toBeUndefined();
    expect(body.items[1]?.status).toBe('conflict');
    expect(body.items[1]?.code).toBe('duplicate-in-batch');
    expect(body.summary).toEqual({ total: 2, ok: 1, conflict: 1, error: 0 });
  });

  it('⑧ 提交链：ok 条目 POST /admin/posts → 201，落盘裸日期 + 索引已 upsert', async () => {
    const res = await preview([
      {
        name: 'p5g-commit.md',
        text: '---\ntitle: 提交链\npubDate: 2025-06-07\ncover: /images/c.webp\n---\n提交正文\n',
      },
    ]);
    const item = bodyOf(res).items[0] as ImportItemView;
    expect(item.status).toBe('ok');
    expect(item.frontmatter['published']).toBe('2025-06-07');
    expect(item.frontmatter['image']).toBe('/images/c.webp');

    // 再裁 B：提交复用既有端点（零新写盘路径）
    const created = await server().post('/api/v1/admin/posts').send({
      slug: item.slug,
      frontmatter: item.frontmatter,
      content: item.content,
      form: 'dir',
    });
    expect(created.status).toBe(201);

    const filePath = path.join(postsDir, item.slug, 'index.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const text = fs.readFileSync(filePath, 'utf8');
    // 裸日期正则（防 js-yaml 引号形回归）
    expect(text).toMatch(/^published: \d{4}-\d{2}-\d{2}$/m);
    expect(text).not.toMatch(/^published: ['"]/m);
    expect(text).not.toContain('pubDate:');
    expect(text).toContain('image: /images/c.webp');

    // 索引已由 createPost 的 upsertArticleRow 写入（K10：导入不需要 sync）
    const list = await server().get('/api/v1/admin/posts');
    expect(list.status).toBe(200);
    const rows = list.body as
      | { items?: { slug: string }[] }
      | { slug: string }[];
    const items = Array.isArray(rows) ? rows : (rows.items ?? []);
    expect(items.some((row) => row.slug === item.slug)).toBe(true);
  });

  it('⑨ 上限：31 文件请求级拒绝；单文件 > 65536 字节 → 413', async () => {
    const files = Array.from({ length: 31 }, (_, index) => ({
      name: `p5g-bulk-${String(index)}.md`,
      text: `---\ntitle: 批量 ${String(index)}\npublished: 2025-07-01\n---\n正文\n`,
    }));
    const overCount = await preview(files);
    // 实测：multer 的 maxCount 触发 LIMIT_UNEXPECTED_FILE → Nest 映射 400（详见报告）
    expect(overCount.status).toBe(400);
    expect(listPosts()).not.toContain('p5g-bulk-0/index.md');

    const huge = `---\ntitle: 超限\npublished: 2025-07-02\n---\n${'x'.repeat(66000)}\n`;
    const overSize = await preview([{ name: 'p5g-huge.md', text: huge }]);
    expect(overSize.status).toBe(413);
  });
});
