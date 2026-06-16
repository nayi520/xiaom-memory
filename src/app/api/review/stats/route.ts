import { NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  reviews as reviewsTable,
} from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** 热力图回看天数（含今天，近 365 天 → 年度贡献图）。 */
const HEATMAP_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 「最易忘」榜单条目数（按概念 lapses 最高排序取前 N）。 */
const MOST_FORGOTTEN_LIMIT = 5;

/** Date → 'YYYY-MM-DD'（UTC 日历日），与 features/stats 的 streak 口径一致。 */
function toUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/review/stats —— 复习统计（V7 热力图 / 保留率 / 今日已复习）
 *
 * 契约：{ daily, retentionRate, todayCount, totalReviews, mostForgotten }
 *   - daily：近 365 天每天的复习张数（按 reviews.reviewed_at 的 UTC 日历日聚合）；
 *     **补全所有日期**（无复习的天 count=0），按日期升序，长度恰为 365，便于前端直接铺贡献图。
 *   - retentionRate：保留率 = rating>=3 的复习数 / 总复习数 ∈ [0,1]；无复习记录时为 0。
 *     （与完成页「正确率 rating>=3」同口径，但统计全部历史复习，长期更稳。）
 *   - todayCount：今天（UTC 日历日）已复习张数。
 *   - totalReviews：该用户全部复习日志条数。
 *   - mostForgotten（V14 新增，向后兼容）：[{ conceptId, name, lapses }]，按概念维度取该概念下
 *     卡片 fsrs_state.lapses 的最大值排序，取前 N（仅含 lapses>0），含概念名 name，便于「最易忘」展示。
 *
 * 鉴权 getCurrentUser()（未登录 401）；授权改应用层——
 * 复习日志归属经 reviews→cards→concepts join 按 concepts.user_id 过滤（review→card→concept→userId）。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();
  // 窗口下界：今天 00:00（UTC）往前推 (365-1) 天，使窗口恰好覆盖含今天在内的 365 个日历日。
  const todayUtc = toUtcDay(now);
  const windowStart = new Date(
    new Date(`${todayUtc}T00:00:00.000Z`).getTime() - (HEATMAP_DAYS - 1) * DAY_MS
  );
  const windowStartIso = windowStart.toISOString();

  // 该用户复习日志归属：reviews → cards → concepts.user_id。
  const ownedReviews = eq(conceptsTable.userId, user.id);

  const [dailyRows, totalRow, forgottenRows] = await Promise.all([
    // 近 365 天按 UTC 日历日聚合的复习张数（仅含有复习的天，零值由应用层补全）。
    db
      .select({
        day: sql<string>`to_char(${reviewsTable.reviewedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(reviewsTable)
      .innerJoin(cardsTable, eq(cardsTable.id, reviewsTable.cardId))
      .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
      .where(
        and(
          ownedReviews,
          gte(reviewsTable.reviewedAt, sql`${windowStartIso}::timestamptz`)
        )
      )
      .groupBy(sql`1`),
    // 总复习数 + rating>=3 的数（一次扫描算保留率，避免双查）。
    db
      .select({
        total: sql<number>`count(*)::int`,
        good: sql<number>`count(*) filter (where ${reviewsTable.rating} >= 3)::int`,
      })
      .from(reviewsTable)
      .innerJoin(cardsTable, eq(cardsTable.id, reviewsTable.cardId))
      .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
      .where(ownedReviews),
    // 最易忘：按概念取其卡片 fsrs_state.lapses 的最大值，仅含 lapses>0，降序取前 N。
    // 直接从 cards 取（不经 reviews），覆盖「忘了多次但近期未复习」的概念。
    db
      .select({
        conceptId: conceptsTable.id,
        name: conceptsTable.name,
        lapses: sql<number>`max(coalesce((${cardsTable.fsrsState}->>'lapses')::int, 0))::int`,
      })
      .from(cardsTable)
      .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
      .where(eq(conceptsTable.userId, user.id))
      .groupBy(conceptsTable.id, conceptsTable.name)
      .having(sql`max(coalesce((${cardsTable.fsrsState}->>'lapses')::int, 0)) > 0`)
      .orderBy(
        sql`max(coalesce((${cardsTable.fsrsState}->>'lapses')::int, 0)) desc`
      )
      .limit(MOST_FORGOTTEN_LIMIT),
  ]);

  // 把稀疏的「有复习的天」映射成完整 365 天序列（升序，缺失补 0）。
  const countByDay = new Map<string, number>();
  for (const r of dailyRows) countByDay.set(r.day, r.n);

  const daily: { date: string; count: number }[] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const day = toUtcDay(new Date(now.getTime() - i * DAY_MS));
    daily.push({ date: day, count: countByDay.get(day) ?? 0 });
  }

  const totalReviews = totalRow[0]?.total ?? 0;
  const good = totalRow[0]?.good ?? 0;
  const retentionRate = totalReviews > 0 ? good / totalReviews : 0;
  const todayCount = countByDay.get(todayUtc) ?? 0;

  // 最易忘榜单：{ conceptId, name, lapses }，已按 lapses 降序、裁到前 N。
  const mostForgotten = forgottenRows.map((r) => ({
    conceptId: r.conceptId,
    name: r.name,
    lapses: r.lapses,
  }));

  return NextResponse.json({
    daily,
    retentionRate,
    todayCount,
    totalReviews,
    mostForgotten,
  });
}
