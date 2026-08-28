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
 * [B2/裁决 9 + ADR-014] id 类型迁移 e2e（迁移语义：自动换新——存量 string id
 * 一次性换新为 number（max+1），不保留旧映射、不做旧引用兼容）。
 *
 * 迁移触发点为引擎载入文件时（评审修订，防死锁）：存量 string 数据由测试
 * setup 在 app 启动前直接写入数据目录构造（不依赖 fixture 本体——fixture 已
 * number 化），随后调列表接口触发迁移，断言响应与磁盘均已 number 化。
 * 此用例是「迁移在 zod parse 之前的原始值层执行」死锁修复的直接证明。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/mizuki');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p4b-mig-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');
const mizukiRoot = path.join(tmp, 'mizuki');

/** 构造存量 string id 数据文件（evaluator 只做 transpile 不做类型检查，直接写裸数组） */
function writeLegacyFile(rel: string, varName: string, items: string): void {
  const content = `// [B2 迁移 e2e] 存量 string id 数据（测试 setup 构造）\nexport const ${varName} = ${items};\n`;
  fs.writeFileSync(path.join(mizukiRoot, rel), content, 'utf8');
}

// ── app 启动前构造存量数据（先整份拷贝 fixture，再覆写为 string id 版本）──
fs.cpSync(FIXTURE_DIR, mizukiRoot, { recursive: true });
// friends：全 string（死锁证明用例）
writeLegacyFile(
  'src/data/friends.ts',
  'friendsData',
  `[
  { id: 'f-001', title: '旧友链一', imgurl: 'https://a.com/1.png', desc: '旧描述一', siteurl: 'https://a.com', tags: ['旧'] },
  { id: 'f-002', title: '旧友链二', imgurl: 'https://b.com/2.png', desc: '旧描述二', siteurl: 'https://b.com', tags: ['旧'] },
]`,
);
// diary：混合（number 5 + 两条 string）→ string 换新从 max+1=6 起
writeLegacyFile(
  'src/data/diary.ts',
  'diaryData',
  `[
  { id: 5, content: '数字 id 存量', date: '2026-01-01T08:00:00+08:00' },
  { id: 'd-legacy', content: '旧字符串一', date: '2026-01-02T08:00:00+08:00' },
  { id: 'd-old', content: '旧字符串二', date: '2026-01-03T08:00:00+08:00' },
]`,
);

describe('P4b id 迁移 e2e（B2/裁决 9 + ADR-014）', () => {
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

  it('① 死锁证明：存量全 string id → 列表接口触发迁移，响应与磁盘均 number 化', async () => {
    const res = await server().get('/api/v1/admin/collections/friends');
    expect(res.status).toBe(200);
    const items = res.body as { id: unknown; title: string }[];
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    for (const id of items.map((i) => i.id)) {
      expect(typeof id).toBe('number');
    }
    // 磁盘已原子写回为 number id，且业务字段无损
    const text = diskText('src/data/friends.ts');
    expect(text).not.toContain('f-001');
    expect(text).not.toContain("'f-002'");
    expect(text).toContain('id: 1');
    expect(text).toContain('id: 2');
    expect(text).toContain('旧友链一');
  });

  it('② 混合 number+string：string 换新从现存 number id 最大值 +1 起（5 → 6, 7）', async () => {
    const res = await server().get('/api/v1/admin/collections/diary');
    expect(res.status).toBe(200);
    const items = res.body as { id: unknown; content: string }[];
    expect(items.map((i) => i.id)).toEqual([5, 6, 7]);
    expect(items[1]!.content).toBe('旧字符串一');
    expect(items[2]!.content).toBe('旧字符串二');
    const text = diskText('src/data/diary.ts');
    expect(text).not.toContain('d-legacy');
    expect(text).not.toContain("'d-old'");
    expect(text).toContain('id: 6');
    expect(text).toContain('id: 7');
  });

  it('③ 幂等：全 number id 不触发迁移（磁盘字节不变）', async () => {
    const before = diskText('src/data/timeline.ts');
    const res = await server().get('/api/v1/admin/collections/timeline');
    expect(res.status).toBe(200);
    expect((res.body as { id: unknown }[]).every((i) => typeof i.id === 'number')).toBe(true);
    expect(diskText('src/data/timeline.ts')).toBe(before);
  });

  it('④ POST 不带 id → 自动分配 max+1（迁移后 friends [1,2] → 新 id 3）', async () => {
    const created = await server()
      .post('/api/v1/admin/collections/friends')
      .send({ title: '新友链', imgurl: 'https://c.com/3.png', desc: '新描述', siteurl: 'https://c.com', tags: ['新'] });
    expect(created.status).toBe(201);
    expect(typeof created.body.id).toBe('number');
    expect(created.body.id).toBe(3);
    // 收尾删除，保持后续用例基准
    await server().delete('/api/v1/admin/collections/friends/3');
  });

  it('⑤ POST 显式重复 id → 409', async () => {
    const res = await server()
      .post('/api/v1/admin/collections/friends')
      .send({ id: 1, title: '重复 id', imgurl: 'https://x.com/x.png', desc: 'x', siteurl: 'https://x.com', tags: ['x'] });
    expect(res.status).toBe(409);
  });

  it('⑥ :id 路由：非数字 → 400；数字不存在 → 404；迁移后按数字 id 正常 CRUD', async () => {
    expect((await server().delete('/api/v1/admin/collections/friends/abc')).status).toBe(400);
    expect((await server().patch('/api/v1/admin/collections/friends/999999').send({ title: 'x' })).status).toBe(404);

    const patched = await server()
      .patch('/api/v1/admin/collections/friends/1')
      .send({ desc: '迁移后更新描述' });
    expect(patched.status).toBe(200);
    expect(patched.body.desc).toBe('迁移后更新描述');
  });
});
