import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getConceptDetail } from '@/features/library/concept-detail';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/concept/{id} —— 概念详情（JSON，供 iOS 原生端用）
 *
 * 契约：{ concept: {id,title,summary}, notes: [{id,rawContent,type,createdAt}],
 *        links: [{conceptId,title}], tags: [string] }
 *   - concept.summary = concepts.summary（解释，可能为 null）
 *   - notes：关联且未软删的原始记录，按 createdAt 倒序；rawContent 可能为 null（语音/链接类记录）
 *   - links：关联概念（仅含对端仍存在的本人概念）
 *   - tags：来自关联记录的标签（去重）
 *
 * 复用 features/library/concept-detail.ts（与概念详情页同口径）。
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤；不存在/非本人 → 404。
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const detail = await getConceptDetail(getDb(), user.id, params.id);
  if (!detail) {
    return NextResponse.json({ error: '概念不存在' }, { status: 404 });
  }

  return NextResponse.json(detail);
}
