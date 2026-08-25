import { type ArgumentsHost, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

interface Captured {
  status: number;
  body: unknown;
}

function createHost(): { host: ArgumentsHost; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined };
  const response = {
    status(code: number) {
      captured.status = code;
      return response;
    },
    json(payload: unknown) {
      captured.body = payload;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/api/v1/test' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('P0b 统一异常过滤器（§6.3）', () => {
  const filter = new AllExceptionsFilter();

  it('NotFoundException → 404，body 含 code/message/detail 三键', () => {
    const { host, captured } = createHost();
    filter.catch(new NotFoundException('资源不存在'), host);

    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({
      code: 'NotFoundException',
      message: '资源不存在',
      detail: null,
    });
  });

  it('未知 Error → 500，message 固定为「内部服务器错误」，不含堆栈/内部细节', () => {
    const { host, captured } = createHost();
    filter.catch(new Error('secret-internal-detail\n    at somewhere (file.ts:1:1)'), host);

    expect(captured.status).toBe(500);
    const body = captured.body as { code: string; message: string };
    expect(body.code).toBe('InternalError');
    expect(body.message).toBe('内部服务器错误');
    // 堆栈与内部细节不得泄露给客户端
    expect(JSON.stringify(captured.body)).not.toContain('secret-internal-detail');
    expect(JSON.stringify(captured.body)).not.toContain('at somewhere');
  });
});
