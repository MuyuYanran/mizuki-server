import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { Body, Controller, INestApplication, Post, UsePipes } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Public } from '../src/common/decorators/public.decorator';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

// [Phase3-C5] 测试数据目录隔离（REQUIREMENTS-PHASE3 §3.4）： AppModule 裸启原会以
// 默认路径打开仓库真实 apps/server/data/mizuki.db——现注入 mkdtemp 临时域，与本地
// 实例数据零交集；断言语义零变化（仅落盘点迁移）。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-p1-e2e-'));
process.env['MIZUKI_DB_PATH'] = path.join(tmp, 'mizuki.db');
process.env['MIZUKI_CONFIG_PATH'] = path.join(tmp, 'config.json');

/**
 * P1 §6.3 / §6.4 / §6.5 验收依据：
 * - zod 管道路由级用法（测试专用控制器，不入 src/ 正式目录）；
 * - helmet 安全头与 CORS 白名单行为；
 * - 全局限流：同 IP 第 61 次请求返回 429（AppModule 真实配置 60 次/分）。
 *
 * [P6 守卫适配] TestZodController 为测试侧演示控制器，以 @Public() 豁免——
 * 与生产豁免清单无关（清单逐字不变），适配方式见 P6 交付报告 §6.11。
 */

/** 演示用 schema（P1 §3.2：验证管道路由级用法） */
const EchoSchema = z.object({
  name: z.string().min(1),
  age: z.number().int(),
});
type EchoBody = z.infer<typeof EchoSchema>;

/** 测试专用控制器：验证 ZodValidationPipe 路由级声明（仅存在于 test/ 侧） */
@Public()
@Controller('test-zod')
class TestZodController {
  @Post('echo')
  @UsePipes(new ZodValidationPipe(EchoSchema))
  echo(@Body() body: EchoBody): EchoBody {
    return body;
  }
}

describe('P1 安全基建 e2e', () => {
  describe('zod 管道 / helmet / CORS', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
        controllers: [TestZodController],
      }).compile();
      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
    });

    afterAll(() => app.close());

    it('zod pipe：合法 body → 201 且原样回显', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/test-zod/echo')
        .send({ name: 'mizuki', age: 3 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ name: 'mizuki', age: 3 });
    });

    it('zod pipe：字段缺失 → 400 且响应含 code/message/detail（detail 含字段路径）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/test-zod/echo')
        .send({ name: 'mizuki' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BadRequestException');
      expect(typeof res.body.message).toBe('string');
      expect(Array.isArray(res.body.detail?.issues)).toBe(true);
      expect(
        res.body.detail.issues.some((issue: { path: string }) => issue.path === 'age'),
      ).toBe(true);
    });

    it('zod pipe：类型错误 → 400 且 detail.issues 非空', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/test-zod/echo')
        .send({ name: 'mizuki', age: 'three' });
      expect(res.status).toBe(400);
      expect(res.body.detail.issues.length).toBeGreaterThan(0);
    });

    it('helmet：响应携带安全头（x-content-type-options / content-security-policy）', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/system/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('CORS 白名单：localhost origin 的响应携带 Access-Control-Allow-Origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/system/health')
        .set('Origin', 'http://localhost:20154');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:20154');
    });

    it('CORS：非白名单 origin 的响应不携带 Access-Control-Allow-Origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/system/health')
        .set('Origin', 'http://evil.example.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('CORS：非白名单 origin 的预检请求不被允许', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/system/health')
        .set('Origin', 'http://evil.example.com')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('全局限流（真实配置 60 次/分钟/IP）', () => {
    it('同 IP 连续请求 61 次，第 61 次返回 429', async () => {
      // 独立 app 实例：与上方用例的限流计数互不干扰
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();

      try {
        const server = app.getHttpServer();
        for (let i = 1; i <= 60; i++) {
          const res = await request(server).get('/api/v1/system/health');
          expect(res.status).toBe(200);
        }
        const blocked = await request(server).get('/api/v1/system/health');
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('ThrottlerException');
      } finally {
        await app.close();
      }
    }, 30_000);
  });

  afterAll(async () => {
    // Windows 文件句柄释放延迟：重试清理，最终失败不阻塞套件（.tmpvitest 已 gitignore）
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });
});
