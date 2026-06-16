import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { cards, concepts, reviews } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * POST /api/review/undo —— 撤销上一次评分（V14，会话内）
 * body: { cardId: string, prevFsrsState: object }
 *
 * 流程（授权改应用层）：
 *   1) 鉴权 getCurrentUser()（未登录 401）。
 *   2) 校验 cardId 为字符串、prevFsrsState 为对象（card→concept→userId 校验归属）。
 *   3) 把 cards.fsrs_state 还原为 prevFsrsState（客户端持有的评分前快照）。
 *   4) 删除该卡**最近一条** reviews 日志（按 reviewed_at desc 取首条）。
 *
 * 还原 + 删日志均按主键操作（id 已确认归属本人）。fsrs_state 直接覆盖：
 * 因评分前快照来自服务端 getReviewQueue 输出，结构可信；后端不重算调度。
 *
 * 返回：200 { ok:true }；401 未登录 / 400 参数错误 / 404 卡片不存在或不归属当前用户。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { cardId?: unknown; prevFsrsState?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const cardId = typeof body.cardId === 'string' ? body.cardId : null;
  // prevFsrsState 必须是普通对象（非 null、非数组），即评分前的 fsrs_state 快照。
  const prev = body.prevFsrsState;
  const prevOk =
    typeof prev === 'object' && prev !== null && !Array.isArray(prev);
  if (!cardId || !prevOk) {
    return NextResponse.json(
      { error: '参数错误：需要 cardId 与 prevFsrsState（对象）' },
      { status: 400 }
    );
  }

  const db = getDb();

  // 卡片归属校验：经 concepts join 按 user_id 过滤，确保只能撤销自己的卡（card→concept→userId）。
  const cardRows = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(concepts, eq(concepts.id, cards.conceptId))
    .where(and(eq(cards.id, cardId), eq(concepts.userId, user.id)))
    .limit(1);
  if (!cardRows[0]) {
    return NextResponse.json({ error: '卡片不存在' }, { status: 404 });
  }

  // 1) 还原 fsrs_state 为评分前快照。
  try {
    await db
      .update(cards)
      .set({ fsrsState: prev as Record<string, unknown> })
      .where(eq(cards.id, cardId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `状态还原失败：${msg}` },
      { status: 500 }
    );
  }

  // 2) 删除该卡最近一条 review 日志（按 reviewed_at desc 取首条；无日志时静默跳过）。
  try {
    const latest = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.cardId, cardId))
      .orderBy(desc(reviews.reviewedAt))
      .limit(1);
    if (latest[0]) {
      await db.delete(reviews).where(eq(reviews.id, latest[0].id));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `复习日志删除失败：${msg}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
