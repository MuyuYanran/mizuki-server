/**
 * [U4-AI1/K4] common/net/outbound — 出站地址安全闸（SSRF 防线单源）
 * [职责] AI 出站请求（`modules/ai` 的 provider）在建立连接前必须过闸：
 *   - `assertSafeOutboundUrl(raw, policy)`：**目标 baseUrl 恒过闸**——协议只许
 *     http/https，主机名/IP 字面量命中私网/回环/云元数据即拒（除非显式
 *     `allowPrivateNetwork`，用于本机 Ollama 场景）；
 *   - `assertSafeProxyUrl(raw)`：**代理地址**单独校验，只验协议——代理本来就在
 *     本机或内网，把私网判定套上去等于让「指定代理」功能永远不可用。
 * [状态] ACTIVE
 *
 * 拒绝分类（与 U4-AI1 指令包 §6 的清单逐类对应）：
 *   ① 非 http/https 协议；② 主机名字面量 `localhost` / `*.localhost` / `*.local` /
 *   `metadata.google.internal`；③ IPv4 私网/保留段 `127/8`、`10/8`、`172.16/12`、
 *   `192.168/16`、`169.254/16`（含云元数据 169.254.169.254）、`0/8`、`100.64/10`；
 *   ④ IPv6 `::1`、`fc00::/7`、`fe80::/10`、`::ffff:<私网 v4>`。
 *
 * **已知残留风险（不假装已解决）**：本闸只判定**字面量**主机名/IP，**不做 DNS
 *   解析后的 IP 校验**——域名解析到私网的 **DNS rebinding** 在 v1 不拦（要 pin
 *   解析结果并直连 IP，成本与收益不匹配；且 pin IP 会破坏 TLS SNI/证书校验语义）。
 *   因此：`allowPrivateNetwork` 默认必须为 `false`，文档与面板文案不得宣称
 *   「完全防 SSRF」。
 *
 * 另一道配套防线在 provider 侧：`fetch` 必须 `redirect: 'error'`
 *   （30x 跳转可把已过闸的公网 URL 引向内网，禁跟随比逐个校验 Location 更可靠）。
 *
 * 纪律：本文件不读环境变量、不发网络请求、不写盘——纯判定，便于单测穷举。
 */
import { BadRequestException } from '@nestjs/common';

/** 出站策略：仅 `allowPrivateNetwork` 一个开关（本地 provider 场景显式放开） */
export interface OutboundPolicy {
  allowPrivateNetwork: boolean;
}

/** 被拒主机名字面量（小写、去尾点后比较） */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

/** 被拒主机名后缀（`*.localhost` / `*.local`） */
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local'];

/**
 * 统一拒绝出口：只回**分类码 + 机器可读原因**，绝不回显原始 URL / 主机名。
 * 理由：错误体会进 `operation_log`、pino 与前端提示；回显内网地址等于把
 * 内网拓扑写进审计库（与 AGENTS §4-6「不泄内部信息」一致）。
 */
function reject(reason: string): never {
  throw new BadRequestException({
    message: '出站地址被安全策略拒绝',
    detail: { code: 'blocked_url', reason },
  });
}

/** 解析并校验协议（目标与代理共用；代理只需过这一关） */
function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    reject('invalid-url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    reject('protocol');
  }
  return url;
}

/** 规范化主机名：小写、去尾部点（`localhost.` 与 `localhost` 等价） */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}

/** 严格点分十进制 IPv4（URL 解析器已把 0x7f.1 / 2130706433 等变体归一，故此处只认点分四段） */
function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }
  const [a, b, c, d] = octets as [number, number, number, number];
  return [a, b, c, d];
}

/** IPv4 是否落在私网/保留段（③ 七类） */
function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8（回环）
  if (a === 169 && b === 254) return true; // 169.254/16（链路本地，含云元数据）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10（CGNAT）
  return false;
}

/**
 * IPv6 判定（④ 四类）。URL 会把 IPv4-mapped 序列化为十六进制形态
 * （`[::ffff:192.168.1.1]` → `[::ffff:c0a8:101]`），两种形态都要认。
 */
function isBlockedIpv6(host: string): boolean {
  // 去掉方括号与 zone id（`[fe80::1%25eth0]`）
  const bare = host.replace(/^\[/, '').replace(/\]$/, '').split('%')[0] ?? '';
  if (bare === '::1') return true; // 回环
  if (bare === '::') return true; // 未指定地址（等价 0.0.0.0，非清单七类但按同口径拒）
  const mapped = /^::ffff:(.+)$/.exec(bare);
  if (mapped) {
    const tail = mapped[1] ?? '';
    const dotted = parseIpv4(tail);
    if (dotted) {
      return isBlockedIpv4(dotted);
    }
    // 十六进制形态：两段 hextet → 4 字节
    const hextets = tail.split(':');
    if (hextets.length === 2) {
      const [hi, lo] = hextets.map((part) => Number.parseInt(part, 16));
      if (
        hi !== undefined &&
        lo !== undefined &&
        Number.isInteger(hi) &&
        Number.isInteger(lo) &&
        hi >= 0 &&
        hi <= 0xffff &&
        lo >= 0 &&
        lo <= 0xffff
      ) {
        return isBlockedIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
      }
    }
    return false;
  }
  const firstHextet = bare.split(':')[0] ?? '';
  if (!/^[0-9a-f]{1,4}$/.test(firstHextet)) {
    return false;
  }
  const first = Number.parseInt(firstHextet, 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7（唯一本地地址）
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10（链路本地）
  return false;
}

/** 主机名/地址是否在拒绝清单内 */
function isBlockedHost(host: string): boolean {
  if (host === '') return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4) return isBlockedIpv4(ipv4);
  if (host.startsWith('[')) return isBlockedIpv6(host);
  // 未加方括号却含 ':' 的形态（URL 对 IPv6 恒加方括号，此处只是兜底）
  if (host.includes(':')) return isBlockedIpv6(host);
  return false;
}

/**
 * 目标出站 URL 过闸（**恒过闸**，与是否配置代理无关）。
 * @throws BadRequestException detail.code = `blocked_url`（不含原始 URL）
 */
export function assertSafeOutboundUrl(raw: string, policy: OutboundPolicy): URL {
  const url = parseHttpUrl(raw);
  if (policy.allowPrivateNetwork) {
    return url;
  }
  const host = normalizeHostname(url.hostname);
  if (isBlockedHost(host)) {
    reject('private-network');
  }
  return url;
}

/**
 * 代理 URL 过闸：**只校验协议**（http/https）。
 * 允许回环与私网——代理本来就在本机或内网；对代理再做私网判定等于让
 * PM 裁定的「指定代理」三态中的 custom 分支永远不可用。
 * @throws BadRequestException detail.code = `blocked_url`
 */
export function assertSafeProxyUrl(raw: string): URL {
  return parseHttpUrl(raw);
}
