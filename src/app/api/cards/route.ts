import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { cards, concepts } from '@/lib/db/schema';
import { initialFsrsState } from '@/features/digest/pipeline';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cards —— 手动新建复习卡片（V15 知识库深化）
 *
 * body: { conceptId, question, answer }
 *   - conceptId        ：必填，须为本人概念（经 user_id 校验，他人/不存在 → 404）。
 *   - question / answer：必填，trim 后非空（cards.question/answer NOT NULL）。
 *
 * 初始化与流水线建卡同口径：
 *   - fsrs_state = initialFsrsState(明天 ISO)（新卡 {stability:null,difficulty:null,reps:0,due}），
 *     首次评分后由 ts-fsrs 接管补全字段（见 features/review/fsrs.ts）。
 *   - status = 'active'（进复习队列）。
 *
 * 契约：{ ok: true, card: { id, conceptId, question, answer, status } }。
 *   401 未登录；400 参数非法；404 概念不存在或非本人。
 *
 * 鉴权 getCurrentUser()，授权应用层——卡片归属经 concept→user_id 校验。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { conceptId?: unknown; question?: unknown; answer?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const conceptId = typeof body.conceptId === 'string' ? body.conceptId : null;
  if (!conceptId) {
    return NextResponse.json({ error: '缺少 conceptId' }, { status: 400 });
  }
  if (typeof body.question !== 'string' || body.question.trim().length === 0) {
    return NextResponse.json({ error: 'question 必须是非空字符串' }, { status: 400 });
  }
  if (typeof body.answer !== 'string' || body.answer.trim().length === 0) {
    return NextResponse.json({ error: 'answer 必须是非空字符串' }, { status: 400 });
  }
  const question = body.question.trim();
  const answer = body.answer.trim();

  const db = getDb();

  // 概念归属校验：显式按 user_id 过滤，确保只能给自己的概念建卡。
  const conceptRows = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.id, conceptId), eq(concepts.userId, user.id)))
    .limit(1);
  if (!conceptRows[0]) {
    return NextResponse.json({ error: '概念不存在' }, { status: 404 });
  }

  // 新卡到期日：明天（北京日界与流水线略有差异不影响——新卡只看相对到期）。
  const tomorrow = new Date();
  tomorrow.setUTCHours(0, 0, 0, 0);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const fsrsState = initialFsrsState(tomorrow.toISOString());

  try {
    const rows = await db
      .insert(cards)
      .values({ conceptId, question, answer, fsrsState, status: 'active' })
      .returning({
        id: cards.id,
        conceptId: cards.conceptId,
        question: cards.question,
        answer: cards.answer,
        status: cards.status,
      });
    return NextResponse.json({ ok: true, card: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `卡片创建失败：${msg}` }, { status: 500 });
  }
}
