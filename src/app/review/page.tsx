import { and, eq, gte, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  digests as digestsTable,
  profiles as profilesTable,
  reviews as reviewsTable,
} from '@/lib/db/schema';
import { dayWindow } from '@/features/digest/pipeline';
import { getReviewQueue } from '@/features/review/queue';
import ReviewSession from '@/features/review/components/ReviewSession';

export const dynamic = 'force-dynamic';
export const metadata = { title: '复习 · 小M' };

/** 每日复习目标缺省（张），与 /api/settings 的 DEFAULT_REVIEW_DAILY_GOAL 一致。 */
const DEFAULT_REVIEW_DAILY_GOAL = 10;

/** 从 settings 收敛 reviewDailyGoal（缺省 10，夹到 1–100），与 /api/settings 同口径。 */
function resolveReviewDailyGoal(settings: unknown): number {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).reviewDailyGoal
      : undefined;
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isInteger(n)) return DEFAULT_REVIEW_DAILY_GOAL;
  return Math.min(100, Math.max(1, n));
}

export default async function ReviewPage() {
  const user = await getCurrentUser();
  const db = getDb();

  if (!user) {
    return (
      <ReviewSession
        items={[]}
        totalDue={0}
        digestMd={null}
        reviewedToday={0}
        dailyGoal={DEFAULT_REVIEW_DAILY_GOAL}
      />
    );
  }

  // 队列查询与 /api/review/queue 共用同一实现（features/review/queue.ts），口径一致。
  const { count, items: queue } = await getReviewQueue(db, user.id);

  // 今日 daily digest（完成页展示）、今日已复习数（目标进度用）、每日目标（设置）。
  // 今日已复习：reviews.reviewed_at 落在「今天 UTC 日历日」内，归属经 cards→concepts.user_id。
  const todayUtcStart = sql`date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`;
  const [digestRows, reviewedRows, settingsRows] = await Promise.all([
    db
      .select({ content_md: digestsTable.contentMd })
      .from(digestsTable)
      .where(
        and(
          eq(digestsTable.userId, user.id),
          eq(digestsTable.type, 'daily'),
          eq(digestsTable.period, dayWindow().period)
        )
      )
      .limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewsTable)
      .innerJoin(cardsTable, eq(cardsTable.id, reviewsTable.cardId))
      .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
      .where(and(eq(conceptsTable.userId, user.id), gte(reviewsTable.reviewedAt, todayUtcStart))),
    db
      .select({ settings: profilesTable.settings })
      .from(profilesTable)
      .where(eq(profilesTable.id, user.id))
      .limit(1),
  ]);

  return (
    <ReviewSession
      items={queue}
      totalDue={count || queue.length}
      digestMd={digestRows[0]?.content_md ?? null}
      reviewedToday={reviewedRows[0]?.n ?? 0}
      dailyGoal={resolveReviewDailyGoal(settingsRows[0]?.settings)}
    />
  );
}
