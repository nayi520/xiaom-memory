import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getLibraryGraph } from '@/features/library/graph';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/graph —— 知识图谱（JSON，供 PWA 力导向图 / iOS 原生端用）
 *
 * 契约：{ nodes: [{ id, name, domain, cardCount }],
 *        links: [{ source, target, relationType, reason }] }
 *   - nodes：当前用户全部概念（节点超过上限时按 cardCount 截断，附 truncated/totalNodes）。
 *   - links：concept_links（两端均为本人现存概念），source/target 为概念 id。
 *
 * 复用 features/library/graph.ts 的 getLibraryGraph。
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const graph = await getLibraryGraph(getDb(), user.id);
  return NextResponse.json(graph);
}
