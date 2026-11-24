import { Errors } from './errors';

/**
 * 校验外部出站 URL 安全性，拦截非 HTTP(S) 协议、环回地址、RFC1918 私网段及云元数据地址，防止 SSRF 攻击
 */
export function assertSafeOutboundUrl(rawUrl: string, allowLocalhost = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw Errors.validation('外部接口 URL 格式不合法');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw Errors.validation('外部接口 URL 仅支持 https:// 或 http:// 协议');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    throw Errors.validation('外部接口 URL 缺少有效主机名');
  }

  // 始终禁止云元数据地址与全零地址
  if (
    host === '0.0.0.0' ||
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal')
  ) {
    throw Errors.validation('安全拦截：禁止访问云厂商元数据或内部私有地址');
  }

  if (!allowLocalhost) {
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('127.') ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host.endsWith('.local') ||
      host.endsWith('.localhost')
    ) {
      throw Errors.validation('安全拦截：禁止将外部网关指向本地环回地址');
    }

    // 检查 IPv4 私网段 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12, 100.64.0.0/10
    const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4Match) {
      const a = Number(ipv4Match[1]);
      const b = Number(ipv4Match[2]);
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 100 && b >= 64 && b <= 127)
      ) {
        throw Errors.validation('安全拦截：禁止将外部网关指向内网私有 IP 地址');
      }
    }

    // 检查 IPv6 链路本地与唯一本地地址 (fe80::/10, fc00::/7)
    if (host.includes(':') && (/^fe[89ab][0-9a-f]:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host))) {
      throw Errors.validation('安全拦截：禁止将外部网关指向内网 IPv6 地址');
    }
  }

  return parsed;
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
