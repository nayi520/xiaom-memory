import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { cards, concepts, reviews } from '@/lib/db/schema';
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
 *
 * 去 Supabase 改造：鉴权 getCurrentUser()，授权改应用层——
 * 卡片归属经 cards→concepts join 显式按 concepts.user_id 校验（原靠 RLS）。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
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
  const ratingNum = rating as ReviewRating;

  const db = getDb();

  // 卡片归属校验：经 concepts join 按 user_id 过滤，确保只能复习自己的卡。
  const cardRows = await db
    .select({
      id: cards.id,
      fsrs_state: cards.fsrsState,
      status: cards.status,
    })
    .from(cards)
    .innerJoin(concepts, eq(concepts.id, cards.conceptId))
    .where(and(eq(cards.id, cardId), eq(concepts.userId, user.id)))
    .limit(1);
  const card = cardRows[0];
  if (!card) {
    return NextResponse.json({ error: '卡片不存在' }, { status: 404 });
  }

  // 1) FSRS 计算新状态
  const outcome = applyRating(card.fsrs_state as FsrsStateJson, ratingNum);

  // 2) 写复习日志
  try {
    await db.insert(reviews).values({ cardId, rating: ratingNum });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `复习日志写入失败：${msg}` },
      { status: 500 }
    );
  }

  // 3) 毕业判定（F3.5）：间隔 >180 天 且 最近连续 3 次评分 = 4（含本次）
  const recent = await db
    .select({ rating: reviews.rating })
    .from(reviews)
    .where(eq(reviews.cardId, cardId))
    .orderBy(desc(reviews.reviewedAt))
    .limit(3);
  const recentRatings = recent.map((r) => r.rating);
  const graduated =
    card.status === 'active' &&
    shouldGraduate(outcome.scheduledDays, recentRatings);

  // 4) 更新卡片
  try {
    await db
      .update(cards)
      .set({
        fsrsState: outcome.state,
        ...(graduated ? { status: 'graduated' } : {}),
      })
      .where(eq(cards.id, cardId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `卡片状态更新失败：${msg}` },
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
