/**
 * [U4-AI1/K4] 出站安全闸单测（`common/net/outbound`）
 *
 * 覆盖 §6 拒绝清单的每一类（协议 / 4 个主机名字面量 / 7 段 IPv4 / 4 类 IPv6）：
 *   ① http(s) 之外协议（file / gopher / data）
 *   ② localhost / *.localhost / *.local / metadata.google.internal
 *   ③ 127/8、10/8、172.16/12、192.168/16、169.254/16、0/8、100.64/10
 *   ④ ::1、fc00::/7、fe80::/10、::ffff:<私网 v4>（点分与十六进制两种序列化）
 * 另断言：
 *   - `allowPrivateNetwork=true` 时私网放行、**协议仍拒**（开关不能当万能钥匙）；
 *   - 拒绝信息只含分类码，**不回显**原始 host（不把内网拓扑写进错误面）；
 *   - 代理地址只验协议：回环/私网放行，非 http(s) 拒（与目标闸的差异是刻意的）。
 */
import { BadRequestException } from '@nestjs/common';
import { assertSafeOutboundUrl, assertSafeProxyUrl } from '../src/common/net/outbound';

const POLICY_DENY = { allowPrivateNetwork: false };
const POLICY_ALLOW = { allowPrivateNetwork: true };

/** 断言「被拒」，返回异常供进一步检查（detail.code / 不回显） */
function captureBlocked(run: () => void): BadRequestException {
  let captured: unknown;
  try {
    run();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(BadRequestException);
  return captured as BadRequestException;
}

/** detail.code 必须是 blocked_url，且 message 不回显 host */
function expectBlocked(raw: string, hostForLeakCheck: string): void {
  const error = captureBlocked(() => assertSafeOutboundUrl(raw, POLICY_DENY));
  const response = error.getResponse() as { message?: string; detail?: { code?: string } };
  expect(response.detail?.code).toBe('blocked_url');
  expect(response.message).not.toContain(hostForLeakCheck);
}

describe('P10b [U4-AI1/K4] 出站安全闸（目标 URL）', () => {
  it('协议类：file / gopher / data 一律拒（只许 http/https）', () => {
    expectBlocked('file:///etc/passwd', 'passwd');
    expectBlocked('gopher://127.0.0.1:70/_', 'gopher');
    expectBlocked('data:text/plain,hello', 'data');
    // 畸形 URL 同样被拒（分类码不变）
    expectBlocked('not-a-url', 'not-a-url');
  });

  it('主机名字面量：localhost / *.localhost / *.local / 云元数据', () => {
    expectBlocked('http://localhost/v1', 'localhost');
    expectBlocked('http://foo.localhost/v1', 'foo.localhost');
    expectBlocked('http://printer.local/v1', 'printer.local');
    expectBlocked('http://metadata.google.internal/computeMetadata/v1', 'metadata.google.internal');
    // 大写与尾部点不能绕开（localhost. 与 localhost 等价）
    expectBlocked('HTTP://LOCALHOST/v1', 'localhost');
    expectBlocked('http://localhost./v1', 'localhost');
  });

  it('IPv4：127/8、10/8、172.16/12、192.168/16、169.254/16、0/8、100.64/10', () => {
    expectBlocked('http://127.0.0.1:11434/v1', '127.0.0.1');
    expectBlocked('http://127.255.0.9/v1', '127.255.0.9');
    expectBlocked('http://10.0.0.5/v1', '10.0.0.5');
    expectBlocked('http://172.16.0.1/v1', '172.16.0.1');
    expectBlocked('http://172.31.255.255/v1', '172.31.255.255');
    expectBlocked('http://192.168.1.10/v1', '192.168.1.10');
    expectBlocked('http://169.254.169.254/latest/meta-data', '169.254.169.254');
    expectBlocked('http://0.0.0.0/v1', '0.0.0.0');
    expectBlocked('http://100.64.0.1/v1', '100.64.0.1');
    expectBlocked('http://100.127.255.254/v1', '100.127.255.254');
    // 非十进制写法由 WHATWG URL 归一后仍须被拒（127.1 / 2130706433）
    expectBlocked('http://127.1/v1', '127.1');
    expectBlocked('http://2130706433/v1', '2130706433');
  });

  it('IPv6：::1、fc00::/7、fe80::/10、::ffff:<私网 v4>（两种序列化）', () => {
    expectBlocked('http://[::1]/v1', '::1');
    expectBlocked('http://[fc00::1]/v1', 'fc00');
    expectBlocked('http://[fd12:3456::1]/v1', 'fd12');
    expectBlocked('http://[fe80::1]/v1', 'fe80');
    expectBlocked('http://[::ffff:192.168.1.1]/v1', '192.168.1.1');
    expectBlocked('http://[::ffff:127.0.0.1]/v1', '127.0.0.1');
    // URL 会把 IPv4-mapped 序列化成十六进制 hextet（c0a8:101），同样要拦
    expectBlocked('http://[::ffff:c0a8:101]/v1', 'c0a8');
  });

  it('公网地址放行：返回解析后的 URL（域名 / 公网 IPv4 / mapped 公网 IPv6）', () => {
    expect(assertSafeOutboundUrl('https://api.deepseek.com/v1', POLICY_DENY).hostname).toBe(
      'api.deepseek.com',
    );
    expect(assertSafeOutboundUrl('http://8.8.8.8/v1', POLICY_DENY).hostname).toBe('8.8.8.8');
    expect(assertSafeOutboundUrl('http://[::ffff:8.8.8.8]/v1', POLICY_DENY).hostname).toBe(
      '[::ffff:808:808]',
    );
  });

  it('allowPrivateNetwork=true：私网放行，但协议仍拒', () => {
    expect(assertSafeOutboundUrl('http://127.0.0.1:11434/v1', POLICY_ALLOW).hostname).toBe(
      '127.0.0.1',
    );
    expect(assertSafeOutboundUrl('http://localhost:11434/v1', POLICY_ALLOW).hostname).toBe(
      'localhost',
    );
    expect(assertSafeOutboundUrl('http://[::1]:11434/v1', POLICY_ALLOW).hostname).toBe('[::1]');
    // 开关只放开「私网」，不能把 file:/gopher: 一起放开
    const error = captureBlocked(() => assertSafeOutboundUrl('file:///etc/passwd', POLICY_ALLOW));
    expect((error.getResponse() as { detail?: { code?: string } }).detail?.code).toBe('blocked_url');
  });
});

describe('P10b [U4-AI1/K4] 代理地址闸（只验协议）', () => {
  it('回环 / 私网代理放行（代理本来就在本机或内网）', () => {
    expect(assertSafeProxyUrl('http://127.0.0.1:7890').port).toBe('7890');
    expect(assertSafeProxyUrl('http://localhost:7897').hostname).toBe('localhost');
    expect(assertSafeProxyUrl('http://10.0.0.9:8080').hostname).toBe('10.0.0.9');
  });

  it('非 http(s) 代理协议拒（socks5 / file 不在本期支持面）', () => {
    const socks = captureBlocked(() => assertSafeProxyUrl('socks5://127.0.0.1:1080'));
    expect((socks.getResponse() as { detail?: { code?: string } }).detail?.code).toBe('blocked_url');
    captureBlocked(() => assertSafeProxyUrl('file:///tmp/proxy'));
  });
});
