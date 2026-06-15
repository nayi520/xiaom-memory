import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { cards, concepts } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/cards/{id} —— 编辑卡片 Q/A 或暂停/恢复卡片（V7 卡片管理）
 *
 * body: { question?: string, answer?: string, status?: 'active' | 'suspended' }
 *   - question / answer：非空字符串（trim 后），任意一个或两个；写回 cards.question / cards.answer。
 *   - status：仅允许 'active'（恢复进队列）/ 'suspended'（暂停/埋葬，不再进队列）。
 *     不开放 'graduated'——毕业由复习评分自动判定（见 /api/review），不容外部直接置入。
 *   - 至少要带 question / answer / status 三者之一，否则 400。
 *
 * 返回：200 { ok: true }（iOS 契约）+ 附 card 当前 question/answer/status 便于前端就地更新。
 *
 * 鉴权 getCurrentUser() 短路（未登录 401）；授权改应用层——
 * 卡片归属经 cards→concepts join 显式按 concepts.user_id 校验（card→concept→userId）；
 * 参数非法 400、卡片不存在或不归属当前用户 404。
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const cardId = params.id;
  if (!cardId) {
    return NextResponse.json({ error: '缺少卡片 id' }, { status: 400 });
  }

  let body: { question?: unknown; answer?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  // ——校验 question / answer：若提供必须是 trim 后非空字符串——
  const updates: { question?: string; answer?: string; status?: 'active' | 'suspended' } = {};

  if (body.question !== undefined) {
    if (typeof body.question !== 'string' || body.question.trim().length === 0) {
      return NextResponse.json(
        { error: 'question 必须是非空字符串' },
        { status: 400 }
      );
    }
    updates.question = body.question.trim();
  }

  if (body.answer !== undefined) {
    if (typeof body.answer !== 'string' || body.answer.trim().length === 0) {
      return NextResponse.json(
        { error: 'answer 必须是非空字符串' },
        { status: 400 }
      );
    }
    updates.answer = body.answer.trim();
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'suspended') {
      return NextResponse.json(
        { error: "status 必须是 'active' 或 'suspended'" },
        { status: 400 }
      );
    }
    updates.status = body.status;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: '参数错误：需要 question / answer / status 中的至少一项' },
      { status: 400 }
    );
  }

  const db = getDb();

  // 卡片归属校验：经 concepts join 按 user_id 过滤，确保只能改自己的卡（card→concept→userId）。
  const cardRows = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(concepts, eq(concepts.id, cards.conceptId))
    .where(and(eq(cards.id, cardId), eq(concepts.userId, user.id)))
    .limit(1);
  if (!cardRows[0]) {
    return NextResponse.json({ error: '卡片不存在' }, { status: 404 });
  }

  // 更新卡片本体（fsrs_state 不动——暂停/恢复仅切 status，到期排程保持原样）。
  // 此处 id 已确认归属本人，按主键更新即可。
  try {
    await db.update(cards).set(updates).where(eq(cards.id, cardId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `卡片更新失败：${msg}` },
      { status: 500 }
    );
  }

  // 回读当前状态，便于前端就地更新（避免再发一次 GET）。
  const after = await db
    .select({
      question: cards.question,
      answer: cards.answer,
      status: cards.status,
    })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);

  return NextResponse.json({
    ok: true,
    card: after[0] ?? null,
  });
}
