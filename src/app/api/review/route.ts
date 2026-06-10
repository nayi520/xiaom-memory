import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  applyRating,
  shouldGraduate,
  type FsrsStateJson,
  type ReviewRating,
} from '@/features/review/fsrs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/review —— 提交一次卡片自评（F3.1 / F3.3 / F3.5）
 * body: { cardId: string, rating: 1|2|3|4 }
 * 流程：写 reviews 日志 → ts-fsrs 计算新 fsrs_state → 毕业判定 → 更新 cards
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { cardId?: unknown; rating?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const cardId = typeof body.cardId === 'string' ? body.cardId : null;
  const rating = body.rating;
  if (!cardId || ![1, 2, 3, 4].includes(rating as number)) {
    return NextResponse.json(
      { error: '参数错误：需要 cardId 与 rating(1-4)' },
      { status: 400 }
    );
  }

  // RLS 保证只能取到自己的卡
  const { data: card, error: cardErr } = await supabase
    .from('cards')
    .select('id, fsrs_state, status')
    .eq('id', cardId)
    .single();
  if (cardErr || !card) {
    return NextResponse.json({ error: '卡片不存在' }, { status: 404 });
  }

  // 1) FSRS 计算新状态
  const outcome = applyRating(
    card.fsrs_state as FsrsStateJson,
    rating as ReviewRating
  );

  // 2) 写复习日志
  const { error: revErr } = await supabase
    .from('reviews')
    .insert({ card_id: cardId, rating });
  if (revErr) {
    return NextResponse.json(
      { error: `复习日志写入失败：${revErr.message}` },
      { status: 500 }
    );
  }

  // 3) 毕业判定（F3.5）：间隔 >180 天 且 最近连续 3 次评分 = 4（含本次）
  const { data: recent } = await supabase
    .from('reviews')
    .select('rating')
    .eq('card_id', cardId)
    .order('reviewed_at', { ascending: false })
    .limit(3);
  const recentRatings = (recent ?? []).map((r) => r.rating as number);
  const graduated =
    card.status === 'active' &&
    shouldGraduate(outcome.scheduledDays, recentRatings);

  // 4) 更新卡片
  const { error: updErr } = await supabase
    .from('cards')
    .update({
      fsrs_state: outcome.state,
      ...(graduated ? { status: 'graduated' } : {}),
    })
    .eq('id', cardId);
  if (updErr) {
    return NextResponse.json(
      { error: `卡片状态更新失败：${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    due: outcome.dueIso,
    scheduledDays: outcome.scheduledDays,
    graduated,
  });
}
