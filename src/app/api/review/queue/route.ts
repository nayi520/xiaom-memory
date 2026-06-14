import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getReviewQueue } from '@/features/review/queue';

export const dynamic = 'force-dynamic';

/**
 * GET /api/review/queue —— 今日到期复习队列（JSON，供 iOS 原生端用）
 *
 * 契约：{ count, cards: [{ cardId, conceptId, conceptTitle, front, back }] }
 *   - count：今日到期 active 卡总数（未裁剪）
 *   - cards：按遗忘风险排序、裁到每日上限（≤20）后的队列
 *     · front = 卡片问题（cards.question），back = 卡片答案（cards.answer）
 *     · conceptTitle = 所属概念名（concepts.name）
 *
 * 复用 features/review/queue.ts 的 getReviewQueue（与服务端 /review 页同一查询逻辑），
 * 仅返回 JSON 而非 HTML。鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { count, items } = await getReviewQueue(getDb(), user.id);

  return NextResponse.json({
    count,
    cards: items.map((item) => ({
      cardId: item.id,
      conceptId: item.conceptId,
      conceptTitle: item.conceptName,
      front: item.question,
      back: item.answer,
    })),
  });
}
