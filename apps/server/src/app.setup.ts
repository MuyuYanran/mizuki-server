import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { getAppConfig } from './config/app-config';

/** 面板端口（与 main.ts 的 MIZUKI_SERVER_PORT 逻辑一致，默认 20154） */
function serverPort(): number {
  const port = Number(process.env.MIZUKI_SERVER_PORT ?? 20154);
  return Number.isFinite(port) && port > 0 ? port : 20154;
}

/**
 * CORS 白名单：默认仅 localhost 面板端口（REQUIREMENTS §9 第 8 条）。
 * 扩展通道：AppConfig 若声明 corsOrigins（string[]）将自动并入——P1 时点
 * AppConfig 尚无该字段（P0b 定型的 schema 未包含，属规格歧义的保守解释，
 * 见 P1 交付报告偏差说明），因此当前实际生效的只有默认 localhost。
 * 非白名单 origin 的请求不携带 Access-Control-Allow-Origin 头（浏览器侧拒绝）。
 */
function corsWhitelist(): string[] {
  const whitelist = [`http://localhost:${serverPort()}`];
  const extra = (getAppConfig() as Record<string, unknown>)['corsOrigins'];
  if (Array.isArray(extra)) {
    for (const origin of extra) {
      if (typeof origin === 'string' && origin !== '') {
        whitelist.push(origin);
      }
    }
  }
  return whitelist;
}

/**
 * [阶段 P0a] 统一应用配置入口
 * [职责] main.ts 与测试共用，保证生产行为与测试行为一致
 * [状态] ACTIVE
 *
 * [P0b] 追加全局统一异常过滤器。
 * [P1] 追加 helmet 安全头、CORS 白名单、全局 zod 管道挂载点
 *      （throttler 在 app.module.ts 以 APP_GUARD 注册，属依赖注入侧接线）。
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  // [P1] helmet 默认安全头（x-content-type-options / CSP 等）
  app.use(helmet());
  // [P1] CORS 白名单（默认仅 localhost）
  app.enableCors({ origin: corsWhitelist() });
  // [P0b] 全局统一异常过滤器（{ code, message, detail }）
  app.useGlobalFilters(new AllExceptionsFilter());
  // [P1] 全局 zod 管道挂载点：各业务路由以 @UsePipes(new ZodValidationPipe(Schema))
  //   显式声明（schema 属于业务知识，见后续各阶段）。若未来需要「拒绝一切
  //   非法 body」的全局兜底 schema，在此追加：
  //   app.useGlobalPipes(new ZodValidationPipe(GlobalBodySchema));
}
