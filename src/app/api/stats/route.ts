import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  notes as notesTable,
} from '@/lib/db/schema';
import { getDueCount } from '@/features/review/queue';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats —— 当前用户的数据统计（设置页展示 / iOS 概览用）
 *
 * 契约：{ noteCount, conceptCount, cardCount, dueCount }（均为 int）
 *   - noteCount：未软删记录数（与最近记录 / 知识库口径一致，排除回收站）
 *   - conceptCount：概念数
 *   - cardCount：卡片数（按 concepts.user_id 归属，含各状态卡）
 *   - dueCount：今日到期 active 卡数（复用 features/review/queue 的 getDueCount，与底部角标同口径）
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const db = getDb();

  const [noteRows, conceptRows, cardRows, dueCount] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notesTable)
      .where(and(eq(notesTable.userId, user.id), isNull(notesTable.deletedAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(conceptsTable)
      .where(eq(conceptsTable.userId, user.id)),
    // 卡片归属用户：cards.concept_id → concepts.user_id。
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(cardsTable)
      .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
      .where(eq(conceptsTable.userId, user.id)),
    getDueCount(db, user.id),
  ]);

  return NextResponse.json({
    noteCount: noteRows[0]?.n ?? 0,
    conceptCount: conceptRows[0]?.n ?? 0,
    cardCount: cardRows[0]?.n ?? 0,
    dueCount,
  });
}
