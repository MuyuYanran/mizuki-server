import { INestApplication } from '@nestjs/common';

/**
 * [阶段 P0a] 统一应用配置入口
 * [职责] main.ts 与测试共用，保证生产行为与测试行为一致
 * [状态] ACTIVE
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  // P1 将在此追加 helmet / CORS / 全局管道 / 限流
}
