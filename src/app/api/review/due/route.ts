import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { cards, concepts } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/review/due —— 今日到期 active 卡数（去 Supabase 改造）
 *
 * 取代底部导航的浏览器端 supabase.from('cards') count 查询。
 * 授权改应用层：经 cards→concepts join 显式按 concepts.user_id 过滤。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    // 未登录返回 0，前端 badge 不显示（中间件通常已拦截受保护页）。
    return NextResponse.json({ due: 0 });
  }

  const nowIso = new Date().toISOString();
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(concepts, eq(concepts.id, cards.conceptId))
    .where(
      and(
        eq(concepts.userId, user.id),
        eq(cards.status, 'active'),
        sql`${cards.fsrsState}->>'due' <= ${nowIso}`
      )
    );

  return NextResponse.json({ due: rows[0]?.n ?? 0 });
}
