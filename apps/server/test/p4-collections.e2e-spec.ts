import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OnEvent } from '@nestjs/event-emitter';
import Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BACKUP_OPTIONS } from '../src/infra/backup/backup.service';
import { SQLITE_CONNECTION } from '../src/infra/db/db.module';
import { ContentChangedPayload, EVENTS } from '../../../packages/shared/src/events';
import { initAndLogin, withAuth } from './helpers/admin-auth';

/**
 * P4 §6.1–6.8 验收依据（supertest e2e，数据源 = P3 fixture 假 Mizuki 项目临时副本）：
 * 六类 CRUD、grouped 空分组清理、未知 type 拒绝、写后 tsc、事件断言、
 * 校验拒绝不落盘、id 生成与 409、timeline 默认映射。
 * [P6 守卫适配] beforeAll 中 init + login 取得 access token，
 * 全部请求经 withAuth 代理自动附加（适配方式见 P6 交付报告 §6.11）。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 测试事件订阅者（P4 §6.5） */
class ContentChangedSubscriber {
  static received: { scope: string; type?: string; filePaths: string[] }[] = [];
  @OnEvent(EVENTS.ContentChanged)
  onContentChanged(payload: unknown): void {
    ContentChangedSubscriber.received.push(ContentChangedPayload.parse(payload));
  }
}

describe('P4 六类集合 CRUD e2e', () => {
  let app: INestApplication;
  let accessToken: string | undefined;

  beforeAll(async () => {
    fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
    ContentChangedSubscriber.received = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [ContentChangedSubscriber],
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
    // [P6] 守卫适配：初始化 + 登录取得 access token
    accessToken = await initAndLogin(request(app.getHttpServer()), mizukiRoot);
  });

  afterAll(async () => {
    await app.close();
    app.get<Database.Database>(SQLITE_CONNECTION).close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const server = (): request.SuperTest<request.Test> =>
    withAuth(request(app.getHttpServer()), () => accessToken);

  /** 通用 CRUD 循环：POST → GET 含 → PATCH → GET 变更 → DELETE → GET 移除 */
  async function crudCycle(type: string, createBody: Record<string, unknown>, patch: Record<string, unknown>, assertChange: (item: Record<string, unknown>) => void): Promise<void> {
    const created = await server().post(`/api/v1/admin/collections/${type}`).send(createBody);
    expect(created.status).toBe(201);
    // [B2/裁决 9 + C2b/ADR-018] diary/friends id 为 number（max+1）；
    // projects/timeline/skills id 为 string（留空 slugify 自动生成）
    const id = created.body.id as number | string;
    if (type === 'diary' || type === 'friends') {
      expect(typeof id).toBe('number');
    } else {
      expect(typeof id).toBe('string');
      expect(String(id).length).toBeGreaterThan(0);
    }

    let list = await server().get(`/api/v1/admin/collections/${type}`);
    expect(list.status).toBe(200);
    expect((list.body as Record<string, unknown>[]).some((item) => item['id'] === id)).toBe(true);

    const patched = await server().patch(`/api/v1/admin/collections/${type}/${id}`).send(patch);
    expect(patched.status).toBe(200);
    assertChange(patched.body as Record<string, unknown>);

    list = await server().get(`/api/v1/admin/collections/${type}`);
    const after = (list.body as Record<string, unknown>[]).find((item) => item['id'] === id);
    assertChange(after as Record<string, unknown>);

    const deleted = await server().delete(`/api/v1/admin/collections/${type}/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);

    list = await server().get(`/api/v1/admin/collections/${type}`);
    expect((list.body as Record<string, unknown>[]).some((item) => item['id'] === id)).toBe(false);
  }

  it('§6.1 diary：POST→GET→PATCH→GET→DELETE→GET 全循环', async () => {
    await crudCycle(
      'diary',
      { content: 'e2e 新日记', date: '2026-08-26T10:00:00+08:00', mood: 'ok' },
      { content: '改后的正文', location: '上海' },
      (item) => {
        expect(item['content']).toBe('改后的正文');
        expect(item['location']).toBe('上海');
      },
    );
  });

  it('§6.1 friends：全循环', async () => {
    await crudCycle(
      'friends',
      // [B4] 官方必填面：desc 必填、tags 至少一个（special-friends.md §2）
      { title: 'e2e 友链', imgurl: 'https://a.com/i.png', desc: 'e2e 描述', siteurl: 'https://a.com', tags: ['e2e'] },
      { desc: '描述更新' },
      (item) => {
        expect(item['desc']).toBe('描述更新');
        expect(item['title']).toBe('e2e 友链');
      },
    );
  });

  it('§6.1 projects：全循环', async () => {
    await crudCycle(
      'projects',
      // [C2b/ADR-018] 官方必填面：description/image/techStack/status/startDate 必填，id 留空自动 slugify
      {
        title: 'e2e 项目',
        description: 'e2e 描述',
        image: '/images/projects/e2e.png',
        category: 'web',
        techStack: ['NestJS'],
        status: 'in-progress',
        startDate: '2026-08-01',
      },
      { featured: true, status: 'completed' },
      (item) => {
        expect(item['featured']).toBe(true);
        expect(item['status']).toBe('completed');
      },
    );
  });

  // [Phase4-D4/S1/A5b] showImage 官方形态（主题 types.ts:18 boolean/optional；
  // 消费语义 ProjectCard.astro:9 `!== false` —— 缺省=显示、false=隐藏，布尔可选非三态）
  it('[Phase4-D4/S1] projects showImage：显式 false 创建/回读往返 + PATCH 翻转 true', async () => {
    const created = await server()
      .post('/api/v1/admin/collections/projects')
      .send({
        title: 'e2e showImage',
        description: 'e2e 描述',
        image: '/images/projects/e2e.png',
        category: 'web',
        techStack: ['NestJS'],
        status: 'planned',
        startDate: '2026-09-01',
        showImage: false,
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(typeof id).toBe('string');

    let list = await server().get('/api/v1/admin/collections/projects');
    expect(list.status).toBe(200);
    const found = (list.body as Record<string, unknown>[]).find((item) => item['id'] === id);
    expect(found).toBeDefined();
    expect(found!['showImage']).toBe(false); // 显式 false 回读保真（不被缺省语义吞掉）

    const patched = await server()
      .patch(`/api/v1/admin/collections/projects/${id}`)
      .send({ showImage: true });
    expect(patched.status).toBe(200);
    expect((patched.body as Record<string, unknown>)['showImage']).toBe(true);

    list = await server().get('/api/v1/admin/collections/projects');
    expect(
      (list.body as Record<string, unknown>[]).find((item) => item['id'] === id)?.['showImage'],
    ).toBe(true);

    const deleted = await server().delete(`/api/v1/admin/collections/projects/${id}`);
    expect(deleted.status).toBe(200);
  });

  it('§6.1 timeline：全循环', async () => {
    await crudCycle(
      'timeline',
      // [C2b/ADR-018] 官方枚举 education|work|project|achievement
      { title: 'e2e 事件', description: 'e2e 描述', type: 'achievement', startDate: '2026-08-26' },
      { title: '改后事件' },
      (item) => {
        expect(item['title']).toBe('改后事件');
        expect(item['type']).toBe('achievement');
      },
    );
  });

  it('§6.1 skills：全循环（含嵌套 experience）', async () => {
    await crudCycle(
      'skills',
      // [C2b/ADR-018] 官方必填面：description/icon/category/level/experience 必填
      {
        name: 'e2e 技能',
        description: 'e2e 描述',
        icon: 'logos:typescript-icon',
        category: 'frontend',
        level: 'intermediate',
        experience: { years: 1, months: 2 },
      },
      { level: 'advanced' },
      (item) => {
        expect(item['level']).toBe('advanced');
        expect(item['experience']).toEqual({ years: 1, months: 2 });
      },
    );
  });

  it('§6.2 devices（grouped）：新增（带 group）→ 分组结构 → 修改 → 删除最后一个 → 空分组清理', async () => {
    // 新分组（新增时创建）；[C2b/ADR-018] 官方恰 5 必填字段
    const created = await server()
      .post('/api/v1/admin/collections/devices')
      .send({ group: 'e2e 组', name: '测试设备', image: 'e2e.png', specs: '1T', description: 'e2e 设备', link: 'https://e2e.example.com' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('测试设备');

    let data = await server().get('/api/v1/admin/collections/devices');
    expect(data.status).toBe(200);
    expect((data.body as Record<string, unknown[]>)['e2e 组']).toBeDefined();

    // 修改
    const patched = await server()
      .patch('/api/v1/admin/collections/devices/测试设备')
      .send({ description: '更新描述' });
    expect(patched.status).toBe(200);
    expect(patched.body.description).toBe('更新描述');

    // 删除该分组唯一设备 → 空分组键被清理
    const deleted = await server().delete('/api/v1/admin/collections/devices/测试设备');
    expect(deleted.status).toBe(200);
    data = await server().get('/api/v1/admin/collections/devices');
    expect((data.body as Record<string, unknown[]>)['e2e 组']).toBeUndefined();
    // 原有分组不受影响
    expect((data.body as Record<string, unknown[]>)['电脑']).toBeDefined();
  });

  it('§6.3 未知 type 拒绝：GET/POST/PATCH/DELETE 均返回 400', async () => {
    expect((await server().get('/api/v1/admin/collections/unknown')).status).toBe(400);
    expect((await server().post('/api/v1/admin/collections/unknown').send({})).status).toBe(400);
    expect((await server().patch('/api/v1/admin/collections/unknown/x').send({})).status).toBe(400);
    expect((await server().delete('/api/v1/admin/collections/unknown/x')).status).toBe(400);
  });

  it('§6.5 事件断言：每次写入后收到 content.changed，payload 正确', async () => {
    // 至此时点的写入数：五类 CRUD 各 3 次（POST/PATCH/DELETE）+ devices 3 次 = 18
    expect(ContentChangedSubscriber.received.length).toBeGreaterThanOrEqual(18);
    for (const payload of ContentChangedSubscriber.received) {
      expect(payload.scope).toBe('collection');
      expect(typeof payload.type).toBe('string');
      expect(payload.filePaths.every((p) => p.startsWith('src/data/'))).toBe(true);
    }
    const diaryEvents = ContentChangedSubscriber.received.filter((e) => e.type === 'diary');
    expect(diaryEvents.length).toBeGreaterThanOrEqual(3);
    expect(diaryEvents[0]!.filePaths).toEqual(['src/data/diary.ts']);
  });

  it('§6.6 校验拒绝：friends 缺 siteurl → 400 且文件未被修改', async () => {
    const file = path.join(mizukiRoot, 'src/data/friends.ts');
    const before = fs.readFileSync(file, 'utf8');
    const res = await server()
      .post('/api/v1/admin/collections/friends')
      .send({ title: '缺字段', imgurl: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.detail.issues.length).toBeGreaterThan(0);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('§6.7 id 生成：POST 不带 id → number（max+1）；id 重复 → 409', async () => {
    // [B2/裁决 9] fixture diary 存量 id 为 [1, 2]（此前 CRUD 已各自收尾删除），新条目应为 max+1 = 3
    const first = await server()
      .post('/api/v1/admin/collections/diary')
      .send({ content: '无 id 新增', date: '2026-08-26' });
    expect(first.status).toBe(201);
    expect(typeof first.body.id).toBe('number');
    expect(first.body.id).toBe(3);

    const conflict = await server()
      .post('/api/v1/admin/collections/diary')
      .send({ id: first.body.id, content: '重复 id', date: '2026-08-26' });
    expect(conflict.status).toBe(409);

    // 收尾删除，保持后续 tsc 断言数据干净
    await server().delete(`/api/v1/admin/collections/diary/${first.body.id}`);
  });

  it('§6.8 timeline 默认映射：仅给 type=education → icon/color 被填充', async () => {
    const res = await server()
      .post('/api/v1/admin/collections/timeline')
      .send({ title: '默认映射事件', description: 'd', type: 'education', startDate: '2026-08-26' });
    expect(res.status).toBe(201);
    expect(typeof res.body.icon).toBe('string');
    expect(res.body.icon.length).toBeGreaterThan(0);
    expect(typeof res.body.color).toBe('string');
    expect(res.body.color).toMatch(/^#/);
    await server().delete(`/api/v1/admin/collections/timeline/${res.body.id}`);
  });

  // 全量并行跑时 15+ worker 争抢 CPU，tsc 冷编译可超 30s 默认上限（B2 实测 37s）→ 放宽到 120s
  it('§6.4 写后文件可编译：全部 6 个数据文件 tsc --noEmit 通过', { timeout: 120_000 }, () => {
    const dataDir = path.join(mizukiRoot, 'src/data');
    const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dataDir, f));
    // [C2b] 第七集合 anime.ts 入列（fixture 变更清单）
    expect(files).toHaveLength(7);
    const tscBin = path.resolve(__dirname, '../node_modules/typescript/bin/tsc');
    execFileSync(
      process.execPath,
      [tscBin, '--noEmit', '--target', 'ES2022', '--moduleResolution', 'node', '--module', 'ESNext', ...files],
      { stdio: 'pipe' },
    );
  });

  it('[B2/裁决 9] :id 校验：非数字 id → 400；数字但不存在 → 404', async () => {
    expect(
      (await server().patch('/api/v1/admin/collections/friends/not-exists').send({ title: 'x' })).status,
    ).toBe(400);
    expect((await server().delete('/api/v1/admin/collections/friends/not-exists')).status).toBe(400);
    expect(
      (await server().patch('/api/v1/admin/collections/friends/999999').send({ title: 'x' })).status,
    ).toBe(404);
    expect((await server().delete('/api/v1/admin/collections/friends/999999')).status).toBe(404);
  });
});
