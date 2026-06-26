import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { tags as tagsTable } from '@/lib/db/schema';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { planTagMerge } from '@/features/library/tag-ops';
import { mergeTagsTx } from '@/features/library/tag-merge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tags/merge —— 合并多个标签为一个（V32 标签管理）。
 *
 * body: { sourceTagIds: string[], targetTagId: string }
 *   把 sourceTagIds（去重、剔除目标自身、剔除非本人）的全部 note_tags 重指到 targetTagId、
 *   去重（note_tags 主键 (note_id,tag_id) → ON CONFLICT DO NOTHING）、删除这些源标签。事务保证一致。
 *
 * 契约（200）：{ ok:true, targetTagId, merged:number }（merged = 实际并入并删除的源标签数）。
 *   400 参数非法（缺目标 / 清洗后无有效源）；401 未登录；404 目标标签不存在或非本人；429 限流。
 *
 * 鉴权 getCurrentUser()，授权严格按 tags.user_id 过滤（目标与所有源都必须归属本人）。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const rl = enforceAiRateLimit(user.id, 'export');
  if (!rl.ok) {
    return NextResponse.json(
      { error: `操作过于频繁，请 ${rl.retryAfter}s 后再试` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  let body: { sourceTagIds?: unknown; targetTagId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const rawSources = Array.isArray(body.sourceTagIds) ? body.sourceTagIds : [];
  const db = getDb();

  // 取本人全部标签 id 集合（归属校验 + 清洗源）。
  const owned = await db
    .select({ id: tagsTable.id })
    .from(tagsTable)
    .where(eq(tagsTable.userId, user.id));
  const ownedIds = new Set(owned.map((r) => r.id));

  const plan = planTagMerge(rawSources, body.targetTagId, ownedIds);
  if (!plan.ok) {
    if (plan.reason === 'no-target') {
      return NextResponse.json({ error: '缺少 targetTagId' }, { status: 400 });
    }
    if (plan.reason === 'target-not-owned') {
      return NextResponse.json({ error: '目标标签不存在' }, { status: 404 });
    }
    // no-source：没有任何有效、归属本人、且不等于目标的源标签。
    return NextResponse.json(
      { error: '请选择至少一个要并入的标签' },
      { status: 400 }
    );
  }

  try {
    await mergeTagsTx(db, user.id, plan.targetId, plan.sourceIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `合并失败：${msg}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    targetTagId: plan.targetId,
    merged: plan.sourceIds.length,
  });
}
