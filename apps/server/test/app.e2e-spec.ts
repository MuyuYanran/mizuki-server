import 'reflect-metadata';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('P0a 骨架冒烟测试', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /api/v1/system/health → 200 { status: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
