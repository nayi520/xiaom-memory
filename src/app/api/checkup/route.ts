import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  noteConcepts as noteConceptsTable,
  notes as notesTable,
  reviews as reviewsTable,
} from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** 久未复习榜单条数（按到期逾期最久 / lapses 最高排序取前 N）。 */
const STALE_LIMIT = 8;
/** 「久未复习」判定阈值：到期已逾期超过 N 天（约 2 周），或 lapses 偏高。 */
const STALE_OVERDUE_DAYS = 14;
const HIGH_LAPSES = 3;

/**
 * GET /api/checkup —— 知识体检报告（V17）
 *
 * 据既有数据**派生**一份「知识体检」，无存储、纯读：
 *   - gaps：覆盖盲区 [{domain,reason}]——
 *       (a) 有概念但其下概念**全无复习卡片**的领域（捕获了却无法复习）；
 *       (b) 合成项 domain='（待整理）'：有 needs_review 记录积压（AI 整理失败、未沉淀成概念）。
 *   - stale：久未复习的概念 [{conceptId,name,lastReviewed?}]——
 *       概念下 active 卡到期**逾期超 14 天**，或 lapses≥3（忘了多次）；
 *       按「最久逾期优先、再按 lapses 降序」取前 N，附该概念最近一次复习时间（无则省略）。
 *   - suggestions：string[]——据 gaps/stale/保留率给出可操作建议（无问题时给正向反馈）。
 *
 * 鉴权 getCurrentUser()（未登录 401）；授权严格按 user.id 过滤
 * （notes 直接按 user_id；cards/reviews 经 concept_id→concepts.user_id 归属）。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  // 逾期阈值时间点（早于此 ISO 即视为「逾期超 STALE_OVERDUE_DAYS 天」）。
  const overdueBeforeIso = new Date(
    Date.now() - STALE_OVERDUE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [domainCardRows, needsReviewRow, staleRows, retentionRow] =
    await Promise.all([
      // 每个领域：概念数 + 其下卡片数（按 concepts→cards 左连接聚合）。卡片数=0 即盲区。
      db
        .select({
          domain: conceptsTable.domain,
          conceptCount: sql<number>`count(distinct ${conceptsTable.id})::int`,
          cardCount: sql<number>`count(${cardsTable.id})::int`,
        })
        .from(conceptsTable)
        .leftJoin(cardsTable, eq(cardsTable.conceptId, conceptsTable.id))
        .where(
          and(
            eq(conceptsTable.userId, user.id),
            sql`${conceptsTable.domain} is not null`,
            sql`length(trim(${conceptsTable.domain})) > 0`
          )
        )
        .groupBy(conceptsTable.domain),
      // needs_review 记录积压数（AI 整理失败、未沉淀成概念）。
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(notesTable)
        .where(
          and(
            eq(notesTable.userId, user.id),
            eq(notesTable.status, 'needs_review'),
            isNull(notesTable.deletedAt)
          )
        ),
      // 久未复习的概念：概念维度聚合其 active 卡的最早到期 + 最大 lapses + 最近复习时间。
      // 仅含「最早到期逾期超阈值」或「lapses≥HIGH_LAPSES」的概念。
      db
        .select({
          conceptId: conceptsTable.id,
          name: conceptsTable.name,
          earliestDue: sql<string | null>`min(${cardsTable.fsrsState}->>'due')`,
          maxLapses: sql<number>`max(coalesce((${cardsTable.fsrsState}->>'lapses')::int, 0))::int`,
          lastReviewed: sql<string | null>`max(${reviewsTable.reviewedAt})`,
        })
        .from(cardsTable)
        .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
        .leftJoin(reviewsTable, eq(reviewsTable.cardId, cardsTable.id))
        .where(and(eq(conceptsTable.userId, user.id), eq(cardsTable.status, 'active')))
        .groupBy(conceptsTable.id, conceptsTable.name)
        .having(
          sql`min(${cardsTable.fsrsState}->>'due') < ${overdueBeforeIso}
              or max(coalesce((${cardsTable.fsrsState}->>'lapses')::int, 0)) >= ${HIGH_LAPSES}`
        )
        // 最早到期升序（逾期最久优先），再按 lapses 降序。
        .orderBy(
          sql`min(${cardsTable.fsrsState}->>'due') asc`,
          sql`max(coalesce((${cardsTable.fsrsState}->>'lapses')::int, 0)) desc`
        )
        .limit(STALE_LIMIT),
      // 长期保留率（建议措辞用）。
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

  // —— gaps：有概念但无卡片的领域 + needs_review 积压 ——
  const gaps: { domain: string; reason: string }[] = [];
  for (const r of domainCardRows) {
    if (r.domain && r.cardCount === 0 && r.conceptCount > 0) {
      gaps.push({
        domain: r.domain,
        reason: `有 ${r.conceptCount} 个概念但还没有复习卡片，记不牢`,
      });
    }
  }
  const needsReview = needsReviewRow[0]?.n ?? 0;
  if (needsReview > 0) {
    gaps.push({
      domain: '（待整理）',
      reason: `有 ${needsReview} 条记录整理未完成，尚未沉淀成概念`,
    });
  }

  // —— stale：久未复习的概念 ——
  const stale = staleRows.map((r) => ({
    conceptId: r.conceptId,
    name: r.name,
    ...(r.lastReviewed ? { lastReviewed: new Date(r.lastReviewed).toISOString() } : {}),
  }));

  // —— suggestions：据上面派生 + 保留率给可操作建议 ——
  const totalReviews = retentionRow[0]?.total ?? 0;
  const retention = totalReviews > 0 ? (retentionRow[0]?.good ?? 0) / totalReviews : 0;
  const suggestions = buildSuggestions({
    gaps,
    staleCount: stale.length,
    overdueCount: staleRows.filter(
      (r) => r.earliestDue !== null && r.earliestDue < nowIso
    ).length,
    needsReview,
    retention,
    totalReviews,
  });

  return NextResponse.json({ gaps, stale, suggestions });
}

/** 据体检结果生成「可操作建议」文案（无问题时给正向反馈，避免空报告）。 */
function buildSuggestions(input: {
  gaps: { domain: string; reason: string }[];
  staleCount: number;
  overdueCount: number;
  needsReview: number;
  retention: number;
  totalReviews: number;
}): string[] {
  const out: string[] = [];

  const cardlessDomains = input.gaps.filter((g) => g.domain !== '（待整理）');
  if (cardlessDomains.length > 0) {
    const names = cardlessDomains.slice(0, 3).map((g) => g.domain).join('、');
    out.push(
      `「${names}」等领域有概念但没有复习卡片，去概念详情生成卡片，把它们纳入复习。`
    );
  }

  if (input.needsReview > 0) {
    out.push(
      `有 ${input.needsReview} 条记录整理未完成，去设置页手动「立即整理」或检查记录内容。`
    );
  }

  if (input.staleCount > 0) {
    out.push(
      `有 ${input.staleCount} 个概念久未复习${input.overdueCount > 0 ? `（其中 ${input.overdueCount} 个已到期）` : ''}，优先复习它们能快速止损。`
    );
  }

  if (input.totalReviews >= 20 && input.retention < 0.8) {
    out.push(
      `近期保留率为 ${Math.round(input.retention * 100)}%，偏低；放慢节奏、对「记不住」的卡多停留，必要时拆分概念。`
    );
  }

  if (out.length === 0) {
    out.push('知识库很健康：领域都有卡片、没有积压的久未复习概念，继续保持。');
  }
  return out;
}
