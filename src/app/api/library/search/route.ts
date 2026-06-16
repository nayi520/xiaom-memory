import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { normalizeMode, runLibrarySearch } from '@/features/library/search';
import { consumeQuota } from '@/lib/quota';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/search?q=&domain=&tag=&mode= —— 知识库混合检索（JSON，供 iOS / PWA 用）
 *
 * 契约（向后兼容）：{ results: [{ kind: "note"|"concept", id, title, snippet }] }
 *   - q       ：查询串（空 → 空结果）。
 *   - domain  ：可选，仅返回该领域的概念 + 关联到该领域的记录（旧调用不传 → 不限制）。
 *   - tag     ：可选（V15），仅返回挂该标签的记录 + 其关联概念（旧调用不传 → 不限制）。
 *   - mode    ：可选，'hybrid'(默认) / 'keyword' / 'semantic'（旧调用不传 → hybrid）。
 *   沿用 features/library/search.ts 的 runLibrarySearch：关键词 ILIKE（含 raw_content/transcript）
 *   + 标签精确 + pgvector 语义，合并去重后按（来源数 → 相似度 → 时间）融合排序。
 *   无 DASHSCOPE_API_KEY 时语义路自动降级。
 *   注：合并结果的 sources/similarity 等内部字段不进契约，仅返回 kind/id/title/snippet。
 *   kind 区分：'concept'=概念，'note'=原始记录（笔记/语音/链接/图片）。
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }
  const domain = (params.get('domain') ?? '').trim() || null;
  const tag = (params.get('tag') ?? '').trim() || null;
  let mode = normalizeMode(params.get('mode'));

  // 成本/滥用闸：仅当本次会真正发起语义 embedding 时（mode 含语义且已配 key）才计 embedding 配额。
  // 关键词检索免费不计；超额时**降级为 keyword**（搜索仍可用），而非 429 阻断核心功能（UI 友好降级）。
  const wouldEmbed = mode !== 'keyword' && Boolean(process.env.DASHSCOPE_API_KEY);
  if (wouldEmbed) {
    const quota = await consumeQuota(user.id, 'embedding');
    if (!quota.ok) mode = 'keyword';
  }

  const { hits } = await runLibrarySearch(getDb(), user.id, { q, domain, tag, mode });

  return NextResponse.json({
    results: hits.map((h) => ({
      kind: h.kind,
      id: h.id,
      title: h.title,
      snippet: h.snippet,
    })),
  });
}
