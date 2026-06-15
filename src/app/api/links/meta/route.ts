import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getCurrentUser } from '@/lib/auth';
import { parseSafeUrl, isBlockedIp, extractTitle } from '@/lib/link-meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/links/meta?url=  —— 轻量取网页标题（捕获链接时自动带出标题）
 *
 * 契约：{ title?: string }
 *   - 成功取到非空标题：{ title: "..." }（优先 og:title，回退 <title>）
 *   - 任何失败（非法 URL / SSRF 拦截 / 超时 / 非 HTML / 无标题 / 远端错误）：{}（HTTP 200，绝不抛 500）
 *
 * 安全（基本 SSRF 防护）：
 *   - 仅允许 http/https 协议；
 *   - 解析主机名到 IP，拒绝环回 / 私网 / 链路本地 / 唯一本地（含 IPv6 与 IPv4-mapped）地址；
 *   - 超时 ~5s；限制读取响应体大小（仅取首段足够含 <head>）；
 *   - redirect: manual（不跟跳转，避免重定向绕过 SSRF 校验）；
 *   - 仅按 Content-Type 接受 HTML/XHTML。
 *
 * 鉴权 getCurrentUser()：仅登录用户可用（避免成为公开的对外探测代理）。
 */

const FETCH_TIMEOUT_MS = 5000;
/** 仅读取响应体前 ~256KB（足够覆盖 <head>，避免大页面拖垮服务端）。 */
const MAX_BYTES = 256 * 1024;

/** 解析主机名对应的所有 A/AAAA 记录，任一落在内网即拒绝（防 DNS 伪装公网域名指向内网）。 */
async function hostResolvesToPublicIp(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return !isBlockedIp(hostname);
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    return false;
  }
  if (records.length === 0) return false;
  return records.every((r) => !isBlockedIp(r.address));
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const raw = (new URL(request.url).searchParams.get('url') ?? '').trim();
  if (!raw) return NextResponse.json({});

  const target = parseSafeUrl(raw);
  if (!target) return NextResponse.json({});

  // DNS 解析校验：域名（或字面量 IP）必须全部解析到公网地址。
  if (!(await hostResolvesToPublicIp(target.hostname))) {
    return NextResponse.json({});
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual', // 不自动跟跳转：避免重定向绕过 SSRF 校验
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; XiaoM-LinkPreview/1.0; +https://memory.nayitools.cn)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    // 跳转（3xx）一律放弃：要跟随得对 Location 重新跑全套校验，这里从简、安全优先。
    if (res.status >= 300 && res.status < 400) return NextResponse.json({});
    if (!res.ok || !res.body) return NextResponse.json({});

    const ct = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(ct)) {
      return NextResponse.json({});
    }

    // 限量读取：累计到 MAX_BYTES 或 </head> 出现即止（标题必在 <head> 内）。
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let html = '';
    let bytes = 0;
    try {
      while (bytes < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    html += decoder.decode();

    const title = extractTitle(html);
    return NextResponse.json(title ? { title } : {});
  } catch {
    // 超时 / 网络错误 / 解析异常：按契约返回 {}，不抛 500。
    return NextResponse.json({});
  } finally {
    clearTimeout(timer);
  }
}
