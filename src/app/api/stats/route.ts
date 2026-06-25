import { NextResponse } from 'next/server';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  notes as notesTable,
} from '@/lib/db/schema';
import { getDueCount } from '@/features/review/queue';
import { computeStreak, weekStartIso } from '@/features/stats';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats —— 当前用户的数据统计（设置页 / 首页 Dashboard / iOS 概览用）
 *
 * 契约：{ noteCount, conceptCount, cardCount, dueCount, todayNoteCount, weeklyNoteCount, streak }（均为 int）
 *   - noteCount：未软删记录数（与最近记录 / 知识库口径一致，排除回收站）
 *   - conceptCount：概念数
 *   - cardCount：卡片数（按 concepts.user_id 归属，含各状态卡）
 *   - dueCount：今日到期 active 卡数（复用 features/review/queue 的 getDueCount，与底部角标同口径）
 *   - todayNoteCount：今天（UTC 日历日 00:00 至今）新增未软删记录数（首页「今日」卡用）
 *   - weeklyNoteCount：本周（周一 00:00 至今，UTC）新增未软删记录数
 *   - streak：连续记录天数（按 notes.created_at 的 UTC 日历日连续计数；今日或昨日有记录才延续，见 features/stats）
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const db = getDb();

  const [noteRows, conceptRows, cardRows, dueCount, todayRows, weeklyRows, dayRows] =
    await Promise.all([
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
      // 今日新增（UTC 日历日 00:00 至今），排除软删。与 streak/weekly 同口径（UTC 日历日）。
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(notesTable)
        .where(
          and(
            eq(notesTable.userId, user.id),
            isNull(notesTable.deletedAt),
            gte(
              notesTable.createdAt,
              sql`date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`
            )
          )
        ),
      // 本周新增（周一起，UTC），排除软删。
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(notesTable)
        .where(
          and(
            eq(notesTable.userId, user.id),
            isNull(notesTable.deletedAt),
            gte(notesTable.createdAt, sql`${weekStartIso()}::timestamptz`)
          )
        ),
      // 连续记录天数：取该用户所有未软删记录的「UTC 日历日」去重列表（数据量小，应用层连续计数）。
      db
        .selectDistinct({
          day: sql<string>`to_char(${notesTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        })
        .from(notesTable)
        .where(and(eq(notesTable.userId, user.id), isNull(notesTable.deletedAt))),
    ]);

  return NextResponse.json({
    noteCount: noteRows[0]?.n ?? 0,
    conceptCount: conceptRows[0]?.n ?? 0,
    cardCount: cardRows[0]?.n ?? 0,
    dueCount,
    todayNoteCount: todayRows[0]?.n ?? 0,
    weeklyNoteCount: weeklyRows[0]?.n ?? 0,
    streak: computeStreak(dayRows.map((r) => r.day)),
  });
}
