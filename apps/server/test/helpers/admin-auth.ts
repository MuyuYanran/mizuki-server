/**
 * [阶段 P6] 测试辅助：既有 e2e 的守卫适配工具
 * [职责] P6 全局守卫生效后，既有 admin 路由 e2e 需先完成
 *   init + login 取得 access token（适配方式见 P6 交付报告 §6.11）：
 *   - initAndLogin：初始化（若未初始化）并登录，返回 accessToken；
 *   - withAuth：代理 supertest 实例，按方法调用自动附加 Authorization 头。
 */
import request from 'supertest';

/** 测试管理员凭据（仅测试使用） */
export const TEST_ADMIN = {
  username: 'admin',
  password: 'admin-pass-123',
};

/** init（容忍已初始化的 409）+ login，返回 accessToken */
export async function initAndLogin(
  server: request.SuperTest<request.Test>,
  mizukiRoot: string,
): Promise<string> {
  const initRes = await server
    .post('/api/v1/system/init')
    .send({ mizukiRoot, mode: 'manage', username: TEST_ADMIN.username, password: TEST_ADMIN.password });
  if (![200, 201, 409].includes(initRes.status)) {
    throw new Error(`initAndLogin: init 意外状态 ${initRes.status} — ${JSON.stringify(initRes.body)}`);
  }
  const loginRes = await server.post('/api/v1/admin/auth/login').send(TEST_ADMIN);
  if (loginRes.status !== 200 || typeof loginRes.body.accessToken !== 'string') {
    throw new Error(`initAndLogin: login 失败 ${loginRes.status} — ${JSON.stringify(loginRes.body)}`);
  }
  return loginRes.body.accessToken as string;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/**
 * supertest 实例代理：get/post/... 方法返回的请求自动附加
 * `Authorization: Bearer <token>`（tokenProvider 返回 undefined 时不附加）。
 */
export function withAuth<T extends object>(base: T, tokenProvider: () => string | undefined): T {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value === 'function' && typeof prop === 'string' && HTTP_METHODS.has(prop)) {
        return (...args: unknown[]): request.Test => {
          const test = (value as (...a: unknown[]) => request.Test).apply(target, args);
          const token = tokenProvider();
          return token ? test.set('Authorization', `Bearer ${token}`) : test;
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
