import { and, asc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  digests as digestsTable,
  notes as notesTable,
  profiles as profilesTable,
  reviews as reviewsTable,
} from '@/lib/db/schema';
import { dayWindow } from '@/features/digest/pipeline';
import { getReviewQueue } from '@/features/review/queue';
import type { ReviewMode } from '@/features/review/types';
import { computeStreak } from '@/features/stats';
import ReviewSession from '@/features/review/components/ReviewSession';

export const dynamic = 'force-dynamic';
export const metadata = { title: '复习 · 小M' };

/** 每日复习目标缺省（张），与 /api/settings 的 DEFAULT_REVIEW_DAILY_GOAL 一致。 */
const DEFAULT_REVIEW_DAILY_GOAL = 10;

/** 把 searchParams.mode 收敛为合法复习模式（缺省/非法回落 'due'）。 */
function resolveMode(raw: string | string[] | undefined): ReviewMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'all' || v === 'leech' ? v : 'due';
}

/** 把 searchParams.domain 收敛为非空字符串或 null。 */
function resolveDomain(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.trim() ? v.trim() : null;
}

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

export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: { mode?: string | string[]; domain?: string | string[] };
}) {
  const user = await getCurrentUser();
  const db = getDb();

  // 复习模式与领域过滤（V14）：从 URL query 读取，由 ReviewSession 的模式切换 UI 写入。
  const mode = resolveMode(searchParams?.mode);
  const domain = resolveDomain(searchParams?.domain);

  if (!user) {
    return (
      <ReviewSession
        items={[]}
        totalDue={0}
        digestMd={null}
        reviewedToday={0}
        dailyGoal={DEFAULT_REVIEW_DAILY_GOAL}
        streak={0}
        mode={mode}
        domain={domain}
        domains={[]}
      />
    );
  }

  // 队列查询与 /api/review/queue 共用同一实现（features/review/queue.ts），口径一致。
  const { count, items: queue } = await getReviewQueue(db, user.id, { mode, domain });

  // 今日 daily digest（完成页展示）、今日已复习数（目标进度用）、每日目标（设置）、领域选项。
  // 今日已复习：reviews.reviewed_at 落在「今天 UTC 日历日」内，归属经 cards→concepts.user_id。
  const todayUtcStart = sql`date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`;
  const [digestRows, reviewedRows, settingsRows, domainRows, streakDayRows] = await Promise.all([
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
    // 领域下拉选项：本人概念里出现过的 distinct domain（非空），按字母序。
    db
      .selectDistinct({ domain: conceptsTable.domain })
      .from(conceptsTable)
      .where(and(eq(conceptsTable.userId, user.id), isNotNull(conceptsTable.domain)))
      .orderBy(asc(conceptsTable.domain)),
    // 连续记录天数（庆祝里程碑用）：未软删记录的 distinct UTC 日历日，与 /api/stats 同口径。
    db
      .selectDistinct({
        day: sql<string>`to_char(${notesTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      })
      .from(notesTable)
      .where(and(eq(notesTable.userId, user.id), isNull(notesTable.deletedAt))),
  ]);

  const domains = domainRows
    .map((r) => r.domain)
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0);

  // 连续打卡天数（按 notes 的 UTC 日历日连续计数，今日/昨日有记录才延续）。
  const streak = computeStreak(streakDayRows.map((r) => r.day));

  return (
    <ReviewSession
      items={queue}
      totalDue={count || queue.length}
      digestMd={digestRows[0]?.content_md ?? null}
      reviewedToday={reviewedRows[0]?.n ?? 0}
      dailyGoal={resolveReviewDailyGoal(settingsRows[0]?.settings)}
      streak={streak}
      mode={mode}
      domain={domain}
      domains={domains}
    />
  );
}
