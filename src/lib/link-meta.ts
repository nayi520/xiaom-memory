/**
 * 链接元信息（取标题）的纯工具：URL/IP 安全校验 + HTML 标题提取。
 *
 * 拆出独立模块的目的：把 SSRF 判定与解析逻辑做成可单测的纯函数，
 * route handler（src/app/api/links/meta/route.ts）只负责 fetch 编排与鉴权。
 */

import { isIP } from 'node:net';

/** 私网 / 环回 / 链路本地 / 保留网段判断（IPv4 + IPv6），命中即视为内网，拒绝抓取。 */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // 非法/无法识别一律拒绝
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8（含 0.0.0.0）
  if (a === 10) return true; // 10.0.0.0/8 私网
  if (a === 127) return true; // 127.0.0.0/8 环回
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私网
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 组播 + 240.0.0.0/4 保留（含 255.255.255.255）
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // 未指定 / 环回
  // IPv4-mapped（::ffff:a.b.c.d）按内嵌 IPv4 规则判断
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (lower.startsWith('fe80')) return true; // 链路本地
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 唯一本地
  if (lower.startsWith('ff')) return true; // 组播
  return false;
}

/**
 * 解析 URL 并做协议/主机白名单校验；不合规返回 null。
 * 仅允许 http/https；拒绝 localhost 与字面量内网 IP（域名→IP 的判定由调用方再做 DNS 解析）。
 */
export function parseSafeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return null;
  if (isIP(host) && isBlockedIp(host)) return null;
  return u;
}

/** 缺协议补 https://（仅用于「看起来像 URL」的归一化，不做安全判断）。 */
export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** 从 HTML 片段提取标题：优先 og:title，回退 <title>。返回去空白后的非空字符串或 null。 */
export function extractTitle(html: string): string | null {
  const og =
    html.match(
      /<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']*)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']og:title["']/i
    );
  if (og?.[1]) {
    const t = decodeEntities(og[1]).trim();
    if (t) return t;
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) {
    const t = decodeEntities(title[1]).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return null;
}

/** 解码常见 HTML 实体（足够覆盖标题里的 & < > " ' 和数字实体）。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => fromCodePointSafe(Number(d)) ?? _)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCodePointSafe(parseInt(h, 16)) ?? _);
}

function fromCodePointSafe(code: number): string | null {
  return Number.isFinite(code) && code > 0 && code < 0x110000
    ? String.fromCodePoint(code)
    : null;
}
