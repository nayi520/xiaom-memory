import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { digests as digestsTable } from '@/lib/db/schema';
import { dayWindow } from '@/features/digest/pipeline';
import { getReviewQueue } from '@/features/review/queue';
import ReviewSession from '@/features/review/components/ReviewSession';

export const dynamic = 'force-dynamic';
export const metadata = { title: '复习 · 小M' };

export default async function ReviewPage() {
  const user = await getCurrentUser();
  const db = getDb();

  if (!user) {
    return <ReviewSession items={[]} totalDue={0} digestMd={null} />;
  }

  // 队列查询与 /api/review/queue 共用同一实现（features/review/queue.ts），口径一致。
  const { count, items: queue } = await getReviewQueue(db, user.id);

  // 今日 daily digest（完成页展示）
  const digestRows = await db
    .select({ content_md: digestsTable.contentMd })
    .from(digestsTable)
    .where(
      and(
        eq(digestsTable.userId, user.id),
        eq(digestsTable.type, 'daily'),
        eq(digestsTable.period, dayWindow().period)
      )
    )
    .limit(1);

  return (
    <ReviewSession
      items={queue}
      totalDue={count || queue.length}
      digestMd={digestRows[0]?.content_md ?? null}
    />
  );
}
