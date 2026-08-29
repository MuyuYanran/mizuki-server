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
 * [Phase3-C2b/ADR-018] 集合字段面对齐 e2e：
 * - 官方值域迁移（B2 裁决 9 过度覆盖的修正）：projects/skills/timeline 载入
 *   触发——number id → String、遗留枚举 → 官方枚举、skills.projects[] 同步
 *   String 化；幂等（官方值直通）；非法值不迁移（交由校验拒绝）；
 * - diary/friends number id 语义回归不变（ADR-014 分支保留）；
 * - 字段面收紧：枚举拒绝、devices 恰 5 字段（.strict()）；
 * - slug 自动生成、id 冲突 409、:id 校验 registry 化、定位键只读；
 * - 备份 round-trip 字符串 id 保真。
 *
 * 存量遗留数据由测试 setup 在 app 启动前直接写入数据目录构造（迁移在
 * zod parse 之前的原始值层执行，不依赖 fixture 本体——fixture 已对齐官方）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4c-align-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 构造存量遗留数据文件（evaluator 只做 transpile 不做类型检查，直接写裸数组） */
function writeLegacyFile(rel: string, varName: string, items: string): void {
  const content = `// [C2b 迁移 e2e] 存量遗留数据（测试 setup 构造）\nexport const ${varName} = ${items};\n`;
  fs.writeFileSync(path.join(mizukiRoot, rel), content, 'utf8');
}

// ── app 启动前构造存量数据（先整份拷贝 fixture，再覆写为遗留值版本）──
fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
// timeline：number id + 遗留 type（certificate/other）
writeLegacyFile(
  'src/data/timeline.ts',
  'timelineData',
  `[
  { id: 1, title: '旧证书', description: '存量证书条目', type: 'certificate', startDate: '2024-01-01' },
  { id: 2, title: '其他事件', description: '存量其他条目', type: 'other', startDate: '2025-01-01' },
]`,
);
// projects：number id + 遗留 status（active/done）
writeLegacyFile(
  'src/data/projects.ts',
  'projectsData',
  `[
  { id: 1, title: '存量项目一', description: 'd1', image: 'a.png', category: 'web', techStack: ['Astro'], status: 'active', startDate: '2025-06-01' },
  { id: 2, title: '存量项目二', description: 'd2', image: 'b.png', category: 'other', techStack: ['NestJS'], status: 'done', startDate: '2025-10-01' },
]`,
);
// skills：number id + number level + number 引用（与 projects id 同批一致）
writeLegacyFile(
  'src/data/skills.ts',
  'skillsData',
  `[
  { id: 1, name: 'Astro', description: '框架', icon: 'logos:astro-icon', category: 'frontend', level: 1, experience: { years: 2, months: 0 }, projects: [1] },
  { id: 2, name: 'NestJS', description: '服务端', icon: 'mdi:nest', category: 'backend', level: 3, experience: { years: 3, months: 6 }, projects: [1, 2] },
]`,
);

describe('P4c 集合字段面对齐 e2e（Phase3-C2b/ADR-018）', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
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

  const diskText = (rel: string): string => fs.readFileSync(path.join(mizukiRoot, rel), 'utf8');

  it('① timeline 遗留 type 迁移：certificate→work、other→achievement，id 同步 String 化', async () => {
    const res = await server().get('/api/v1/admin/collections/timeline');
    expect(res.status).toBe(200);
    const items = res.body as { id: unknown; type: string; title: string }[];
    expect(items.map((i) => i.type)).toEqual(['work', 'achievement']);
    expect(items.map((i) => i.id)).toEqual(['1', '2']);
    // 磁盘已原子写回（序列化器字符串值为 JSON 双引号风格）
    const text = diskText('src/data/timeline.ts');
    expect(text).not.toContain('certificate');
    expect(text).toContain('type: "work"');
    expect(text).toContain('type: "achievement"');
    expect(text).toContain('id: "1"');
    expect(text).toContain('存量证书条目');
  });

  it('①b 迁移幂等二跑：再读一次磁盘字节不变', async () => {
    const before = diskText('src/data/timeline.ts');
    const res = await server().get('/api/v1/admin/collections/timeline');
    expect(res.status).toBe(200);
    expect(diskText('src/data/timeline.ts')).toBe(before);
  });

  it('② projects status+id 迁移：active→in-progress、done→completed、number id→字符串', async () => {
    const res = await server().get('/api/v1/admin/collections/projects');
    expect(res.status).toBe(200);
    const items = res.body as { id: unknown; status: string }[];
    expect(items.map((i) => i.id)).toEqual(['1', '2']);
    expect(items.map((i) => i.status)).toEqual(['in-progress', 'completed']);
    const text = diskText('src/data/projects.ts');
    expect(text).toContain('status: "in-progress"');
    expect(text).toContain('status: "completed"');
    expect(text).toContain('id: "1"');
  });

  it('③ skills level+id 迁移：number level→枚举、projects[] 引用同步 String 化', async () => {
    const res = await server().get('/api/v1/admin/collections/skills');
    expect(res.status).toBe(200);
    const items = res.body as { id: unknown; level: string; projects?: unknown[] }[];
    expect(items.map((i) => i.id)).toEqual(['1', '2']);
    expect(items.map((i) => i.level)).toEqual(['beginner', 'advanced']);
    // 引用与 projects id 迁移同批一致（1→'1'、2→'2'）
    expect(items[1]!.projects).toEqual(['1', '2']);
    const text = diskText('src/data/skills.ts');
    expect(text).toContain('level: "beginner"');
    expect(text).toContain('"1"');
    expect(text).toContain('"2"');
    expect(text).not.toContain('projects: [1');
  });

  it('④ diary/friends id 回归：仍为 number（ADR-014 分支语义不变）', async () => {
    const diary = await server().get('/api/v1/admin/collections/diary');
    expect(diary.status).toBe(200);
    for (const item of diary.body as { id: unknown }[]) {
      expect(typeof item.id).toBe('number');
    }
    const friends = await server().get('/api/v1/admin/collections/friends');
    expect(friends.status).toBe(200);
    for (const item of friends.body as { id: unknown }[]) {
      expect(typeof item.id).toBe('number');
    }
  });

  it('⑤ 非法枚举拒绝：projects category / skills level / timeline links.type 均 400', async () => {
    const badCategory = await server()
      .post('/api/v1/admin/collections/projects')
      .send({
        title: 'x', description: 'd', image: 'i', category: 'game', techStack: ['t'],
        status: 'planned', startDate: '2026-08-01',
      });
    expect(badCategory.status).toBe(400);
    const badLevel = await server()
      .post('/api/v1/admin/collections/skills')
      .send({
        name: 'x', description: 'd', icon: 'a:b', category: 'other',
        level: 'master', experience: { years: 1, months: 0 },
      });
    expect(badLevel.status).toBe(400);
    const badLinkType = await server()
      .post('/api/v1/admin/collections/timeline')
      .send({
        title: 'x', description: 'd', type: 'work', startDate: '2026-08-01',
        links: [{ name: 'n', url: 'https://a.com', type: 'blog' }],
      });
    expect(badLinkType.status).toBe(400);
  });

  it('⑥ devices 第 6 字段拒绝（.strict()）：400 且文件未变', async () => {
    const before = diskText('src/data/devices.ts');
    const res = await server()
      .post('/api/v1/admin/collections/devices')
      .send({
        group: '电脑', name: '脏字段设备', image: 'a.png', specs: 's',
        description: 'd', link: 'l', weight: '1kg',
      });
    expect(res.status).toBe(400);
    expect(diskText('src/data/devices.ts')).toBe(before);
  });

  it('⑦ slug 自动生成：projects/skills/timeline id 留空创建 → kebab id', async () => {
    const p = await server()
      .post('/api/v1/admin/collections/projects')
      .send({
        title: 'My Cool Server', description: 'd', image: 'i', category: 'web',
        techStack: ['t'], status: 'planned', startDate: '2026-08-01',
      });
    expect(p.status).toBe(201);
    expect(p.body.id).toBe('my-cool-server');

    const t = await server()
      .post('/api/v1/admin/collections/timeline')
      .send({ title: 'First Release_v2', description: 'd', type: 'work', startDate: '2026-08-01' });
    expect(t.status).toBe(201);
    expect(t.body.id).toBe('first-release-v2');

    // 可用字符全被剔除 → 回落 item-<nanoid(6)>
    const s = await server()
      .post('/api/v1/admin/collections/skills')
      .send({
        name: '!!!全中文', description: 'd', icon: 'a:b', category: 'other',
        level: 'beginner', experience: { years: 0, months: 0 },
      });
    expect(s.status).toBe(201);
    expect(String(s.body.id)).toMatch(/^item-[A-Za-z0-9_-]{6}$/);

    // 收尾
    await server().delete('/api/v1/admin/collections/projects/my-cool-server');
    await server().delete('/api/v1/admin/collections/timeline/first-release-v2');
    await server().delete(`/api/v1/admin/collections/skills/${encodeURIComponent(String(s.body.id))}`);
  });

  it('⑧ id 冲突 409：显式重复 id 与 slug 撞既有条目均 409', async () => {
    const explicit = await server()
      .post('/api/v1/admin/collections/projects')
      .send({
        id: '1', title: '重复', description: 'd', image: 'i', category: 'web',
        techStack: ['t'], status: 'planned', startDate: '2026-08-01',
      });
    expect(explicit.status).toBe(409);
    const slugClash = await server()
      .post('/api/v1/admin/collections/projects')
      // 标题 slugify 后撞既有 id "1"（数字存量条目迁移后的字符串 id）
      .send({
        title: '1', description: 'd', image: 'i', category: 'web',
        techStack: ['t'], status: 'planned', startDate: '2026-08-01',
      });
    expect(slugClash.status).toBe(409);
  });

  it('⑨ :id 校验 registry 化：数字校验仅限 diary/friends；projects 字符串 id 正常 200 语义', async () => {
    // friends：非数字 → 400
    expect((await server().patch('/api/v1/admin/collections/friends/abc').send({ desc: 'x' })).status).toBe(400);
    expect((await server().delete('/api/v1/admin/collections/friends/abc')).status).toBe(400);
    // projects：字符串 id 走定位（不存在 → 404 而非 400）
    const missing = await server().patch('/api/v1/admin/collections/projects/no-such-id').send({ title: 'x' });
    expect(missing.status).toBe(404);
    // 存在的字符串 id 正常 PATCH
    const ok = await server()
      .patch('/api/v1/admin/collections/projects/1')
      .send({ featured: true });
    expect(ok.status).toBe(200);
    expect(ok.body.featured).toBe(true);
  });

  it('⑩ 定位键只读：PATCH 改 id → 400', async () => {
    const res = await server()
      .patch('/api/v1/admin/collections/projects/1')
      .send({ id: 'renamed' });
    expect(res.status).toBe(400);
  });

  it('⑪ 备份 round-trip：字符串 id 保真（恢复后磁盘字节不变）', async () => {
    const before = diskText('src/data/projects.ts');
    const created = await server().post('/api/v1/admin/backups').send({ scope: 'data' });
    expect(created.status).toBe(201);
    const backupId = created.body.id as string;
    const restored = await server()
      .post(`/api/v1/admin/backups/${backupId}/restore`)
      .send({ confirm: true });
    expect(restored.status).toBe(200);
    expect(diskText('src/data/projects.ts')).toBe(before);
    const list = await server().get('/api/v1/admin/collections/projects');
    expect((list.body as { id: unknown }[]).map((i) => i.id)).toEqual(['1', '2']);
  });

  it('⑫ timeline links 合法对象数组通过；非法字段对象内未知键拒绝', async () => {
    const ok = await server()
      .post('/api/v1/admin/collections/timeline')
      .send({
        title: '带链接事件', description: 'd', type: 'project', startDate: '2026-08-01',
        links: [{ name: '官网', url: 'https://a.com', type: 'website' }],
      });
    expect(ok.status).toBe(201);
    expect(ok.body.links).toEqual([{ name: '官网', url: 'https://a.com', type: 'website' }]);
    const bad = await server()
      .post('/api/v1/admin/collections/timeline')
      .send({
        title: '脏链接事件', description: 'd', type: 'project', startDate: '2026-08-01',
        links: [{ name: 'n', url: 'u', type: 'website', evil: 'x' }],
      });
    expect(bad.status).toBe(400);
    await server().delete('/api/v1/admin/collections/timeline/带链接事件');
  });
});
