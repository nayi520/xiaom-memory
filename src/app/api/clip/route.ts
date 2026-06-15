import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import { safeFetch } from '@/lib/link-meta';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { consumeQuota } from '@/lib/quota';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_CONTENT_CHARS = 20000;
const FETCH_TIMEOUT_MS = 12000;
/** URL 硬上限（字符）：防超长 URL；正常网页地址远低于此。 */
const MAX_URL_CHARS = 2048;
/** why_important 硬上限（字符）：用户备注，防超大文本入库。 */
const MAX_WHY_CHARS = 2000;

/**
 * POST /api/clip  { url, why_important? }
 * 服务端抓取网页 → @mozilla/readability 提取标题/正文 → 存入 notes
 * 抓取失败时仍保存 URL（降级），不丢记录
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let url: string | undefined;
  let whyImportant: string | null = null;
  try {
    const body = await request.json();
    url = body.url;
    whyImportant = body.why_important ?? null;
  } catch {
    /* noop */
  }
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: '无效的 URL' }, { status: 400 });
  }
  // 输入硬上限：URL / 备注过长直接拒绝，防超大请求。
  if (url.length > MAX_URL_CHARS) {
    return NextResponse.json({ error: 'URL 过长' }, { status: 413 });
  }
  if (typeof whyImportant === 'string' && whyImportant.length > MAX_WHY_CHARS) {
    whyImportant = whyImportant.slice(0, MAX_WHY_CHARS);
  }

  // 成本/滥用闸：clip（抓 URL + 后续 LLM）按 userId 限流 + 每日配额。URL 合法后、抓取前拦。
  const rl = enforceAiRateLimit(user.id, 'clip');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }
  const quota = await consumeQuota(user.id, 'clip');
  if (!quota.ok) {
    return NextResponse.json(
      { error: '今日额度已用尽', kind: 'clip', limit: quota.limit },
      { status: 429 }
    );
  }

  let rawContent: string | null = null;
  let warning: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // SSRF 加固：经 safeFetch 对初始 URL 与每一跳重定向做公网校验（取代裸 fetch + redirect:follow）。
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);

    if (res.ok) {
      const html = await res.text();
      // 动态 import：避免 jsdom 进入客户端 bundle
      const { JSDOM } = await import('jsdom');
      const { Readability } = await import('@mozilla/readability');

      const dom = new JSDOM(html, { url });
      const article = new Readability(dom.window.document).parse();

      if (article?.textContent?.trim()) {
        const title = article.title?.trim() || url;
        const text = article.textContent.replace(/\n{3,}/g, '\n\n').trim();
        rawContent = `# ${title}\n\n${text}`.slice(0, MAX_CONTENT_CHARS);
      } else {
        const fallbackTitle = dom.window.document.title?.trim();
        rawContent = fallbackTitle ? `# ${fallbackTitle}` : null;
        warning = '正文提取失败，已保存链接与标题';
      }
    } else {
      warning = `抓取失败（HTTP ${res.status}），已保存链接`;
    }
  } catch {
    warning = '抓取超时或被拒绝，已保存链接';
  }

  let note;
  try {
    const [row] = await getDb()
      .insert(notes)
      .values({
        userId: user.id,
        type: 'link',
        url,
        rawContent,
        whyImportant,
        status: 'inbox',
      })
      .returning();
    // 返回 snake_case Note 形态（前端乐观 UI 契约）
    note = {
      id: row.id,
      user_id: row.userId,
      type: row.type,
      raw_content: row.rawContent,
      transcript: row.transcript,
      url: row.url,
      media_path: row.mediaPath,
      why_important: row.whyImportant,
      status: row.status,
      summary: row.summary,
      created_at:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  } catch (err) {
    console.error('[clip] 保存失败：', err);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }

  return NextResponse.json({ note, warning });
}
