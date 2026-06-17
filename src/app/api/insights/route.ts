import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  notes as notesTable,
  reviews as reviewsTable,
} from '@/lib/db/schema';
import {
  computeStreak,
  cumulativeGrowth,
  deriveAchievements,
} from '@/features/stats';

export const dynamic = 'force-dynamic';

/** 成长曲线默认窗口（天，含今天）。?days=90 切到 90 天，其余值回退 30。 */
const DEFAULT_WINDOW_DAYS = 30;
const ALLOWED_WINDOWS = [30, 90] as const;

/**
 * GET /api/insights —— 知识成长洞察（V17）
 *
 * 聚合「既有表」派生的成长全景，供洞察页（轻量 SVG 折线/柱/环）与 iOS 对齐：
 *   - growth：近 days 天 笔记/概念/卡片 的**累计**增长曲线（按 UTC 日历日，升序、密集补全；
 *     值为截至该日的累计总量，含窗口前历史基线，见 features/stats.cumulativeGrowth）。
 *     ?days=30（默认）或 90；非法值回退 30。
 *   - retention：长期保留率 ∈ [0,1]（rating>=3 占全部复习，与 /api/review/stats 同口径）。
 *   - streak：连续记录天数（与 /api/stats 同口径，features/stats.computeStreak）。
 *   - domains：领域分布 [{domain,count}]（concepts.domain 去重计数，按数量降序；忽略空 domain）。
 *   - totals：{notes,concepts,cards,reviews} 各累计总量（notes 排除软删）。
 *   - achievements：成就徽章 [{id,name,desc,achieved,progress}]，**纯派生无存储**
 *     （features/stats.deriveAchievements，据 totals/streak/domains/retention 计算）。
 *
 * 鉴权 getCurrentUser()（未登录 401）；授权严格按 user.id 过滤：
 *   notes/concepts 直接按 user_id；cards/reviews 经 concept_id→concepts.user_id 归属。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const url = new URL(request.url);
  const daysRaw = Number.parseInt(url.searchParams.get('days') ?? '', 10);
  const days = (ALLOWED_WINDOWS as readonly number[]).includes(daysRaw)
    ? daysRaw
    : DEFAULT_WINDOW_DAYS;

  const db = getDb();

  // 取每条记录/概念/卡片的「UTC 创建日」清单（数据量小，累计曲线在应用层算，口径与 streak 一致）。
  // 卡片用 created_at（卡片本身的建卡时间），按 concepts.user_id 归属。
  const [noteDayRows, conceptDayRows, cardDayRows, domainRows, retentionRow] =
    await Promise.all([
      db
        .select({
          day: sql<string>`to_char(${notesTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        })
        .from(notesTable)
        .where(and(eq(notesTable.userId, user.id), isNull(notesTable.deletedAt))),
      db
        .select({
          day: sql<string>`to_char(${conceptsTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        })
        .from(conceptsTable)
        .where(eq(conceptsTable.userId, user.id)),
      db
        .select({
          day: sql<string>`to_char(${cardsTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        })
        .from(cardsTable)
        .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
        .where(eq(conceptsTable.userId, user.id)),
      // 领域分布：按 domain 计数（忽略 null / 空串），数量降序。
      db
        .select({
          domain: conceptsTable.domain,
          count: sql<number>`count(*)::int`,
        })
        .from(conceptsTable)
        .where(
          and(
            eq(conceptsTable.userId, user.id),
            sql`${conceptsTable.domain} is not null`,
            sql`length(trim(${conceptsTable.domain})) > 0`
          )
        )
        .groupBy(conceptsTable.domain)
        .orderBy(sql`count(*) desc`),
      // 长期保留率 + 总复习数（一次扫描，reviews→cards→concepts 按 user_id 归属）。
      db
        .select({
          total: sql<number>`count(*)::int`,
          good: sql<number>`count(*) filter (where ${reviewsTable.rating} >= 3)::int`,
        })
        .from(reviewsTable)
        .innerJoin(cardsTable, eq(cardsTable.id, reviewsTable.cardId))
        .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
        .where(eq(conceptsTable.userId, user.id)),
    ]);

  const noteDays = noteDayRows.map((r) => r.day);
  const conceptDays = conceptDayRows.map((r) => r.day);
  const cardDays = cardDayRows.map((r) => r.day);

  const growth = {
    notes: cumulativeGrowth(noteDays, days),
    concepts: cumulativeGrowth(conceptDays, days),
    cards: cumulativeGrowth(cardDays, days),
  };

  const domains = domainRows
    .filter((r): r is { domain: string; count: number } => Boolean(r.domain))
    .map((r) => ({ domain: r.domain, count: r.count }));

  const totalReviews = retentionRow[0]?.total ?? 0;
  const goodReviews = retentionRow[0]?.good ?? 0;
  const retention = totalReviews > 0 ? goodReviews / totalReviews : 0;

  const totals = {
    notes: noteDays.length,
    concepts: conceptDays.length,
    cards: cardDays.length,
    reviews: totalReviews,
  };

  const streak = computeStreak(noteDays);

  const achievements = deriveAchievements({
    noteCount: totals.notes,
    conceptCount: totals.concepts,
    reviewCount: totals.reviews,
    streak,
    domainCount: domains.length,
    retentionRate: retention,
    totalReviews,
  });

  return NextResponse.json({
    days,
    growth,
    retention,
    streak,
    domains,
    totals,
    achievements,
  });
}
