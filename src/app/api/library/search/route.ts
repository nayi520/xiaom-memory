import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { runLibrarySearch } from '@/features/library/search';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/search?q= —— 知识库搜索（JSON，供 iOS 原生端用）
 *
 * 契约：{ results: [{ kind: "note"|"concept", id, title, snippet }] }
 *   沿用 features/library/search.ts 的 runLibrarySearch：关键词 ILIKE + 标签精确 + pgvector 语义，
 *   合并去重后按（来源数 → 相似度 → 时间）排序。无 DASHSCOPE_API_KEY 时语义路自动降级（只跑关键词+标签）。
 *   注：合并结果的 sources/similarity 等内部字段不进契约，仅返回 kind/id/title/snippet。
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。q 为空返回空结果。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const { hits } = await runLibrarySearch(getDb(), user.id, q);

  return NextResponse.json({
    results: hits.map((h) => ({
      kind: h.kind,
      id: h.id,
      title: h.title,
      snippet: h.snippet,
    })),
  });
}
