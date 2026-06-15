import { NextResponse } from 'next/server';
import { and, eq, or, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { cards, concepts, conceptLinks } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recommend —— 智能推荐（V9，轻量；仅当前登录用户）
 *
 * 契约：{ review: [{ conceptId, name }], related: [{ conceptId, name }] }
 *  - review ：有「到期 active 卡」的概念（该复习的），按最早到期排序，去重，限量。
 *  - related：与你「最近概念」经 concept_links 关联到的其它概念（值得回看/串联的），
 *             排除已在 review 里的，去重，限量。
 *
 * 设计：纯读、零 LLM、零 embedding，首页/概念页可直接调。
 * 降级：未登录 → 空两组（前端不渲染）；未配 DATABASE_URL → 空两组（不崩溃）。
 * 授权：全部经 concepts.user_id 显式过滤（cards 经 concept join）。
 */

const REVIEW_LIMIT = 6;
const RELATED_LIMIT = 6;
/** 取「最近概念」的窗口大小，用于派生 related 的关联起点。 */
const RECENT_SEED = 12;

export interface RecommendConcept {
  conceptId: string;
  name: string;
}
export interface RecommendResult {
  review: RecommendConcept[];
  related: RecommendConcept[];
}

const EMPTY: RecommendResult = { review: [], related: [] };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json(EMPTY);
  if (!isDatabaseConfigured()) return NextResponse.json(EMPTY);

  try {
    const db = getDb();
    const nowIso = new Date().toISOString();

    // —— review：有到期 active 卡的概念，按最早到期升序、去重、限量 ——
    const reviewRows = await db
      .select({
        conceptId: concepts.id,
        name: concepts.name,
        nextDue: sql<string>`min(${cards.fsrsState}->>'due')`,
      })
      .from(cards)
      .innerJoin(concepts, eq(concepts.id, cards.conceptId))
      .where(
        and(
          eq(concepts.userId, user.id),
          eq(cards.status, 'active'),
          sql`${cards.fsrsState}->>'due' <= ${nowIso}`
        )
      )
      .groupBy(concepts.id, concepts.name)
      .orderBy(sql`min(${cards.fsrsState}->>'due') asc`)
      .limit(REVIEW_LIMIT);

    const review: RecommendConcept[] = reviewRows.map((r) => ({
      conceptId: r.conceptId,
      name: r.name,
    }));

    // —— related：取最近 RECENT_SEED 个概念，沿 concept_links 找它们关联到的其它概念 ——
    const seedRows = await db
      .select({ id: concepts.id })
      .from(concepts)
      .where(eq(concepts.userId, user.id))
      .orderBy(sql`${concepts.createdAt} desc`)
      .limit(RECENT_SEED);
    const seedIds = seedRows.map((r) => r.id);

    const related: RecommendConcept[] = [];
    if (seedIds.length > 0) {
      const seedSet = sql`(${sql.join(
        seedIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`;
      // 边可能记在 a→b 或 b→a，两个方向都查；关联到的「另一端」必须是本人现存概念。
      // 不在 SQL 里排除 seed 自身——交给下方 JS 去重（seen 含 seed/review），更稳。
      const linkRows = await db
        .select({
          conceptId: concepts.id,
          name: concepts.name,
          createdAt: conceptLinks.createdAt,
        })
        .from(conceptLinks)
        .innerJoin(
          concepts,
          or(
            and(
              sql`${conceptLinks.conceptA} in ${seedSet}`,
              eq(concepts.id, conceptLinks.conceptB)
            ),
            and(
              sql`${conceptLinks.conceptB} in ${seedSet}`,
              eq(concepts.id, conceptLinks.conceptA)
            )
          )
        )
        .where(eq(concepts.userId, user.id))
        .orderBy(sql`${conceptLinks.createdAt} desc`)
        .limit(RELATED_LIMIT * 4);

      // 去重并排除：已在 review 的、作为起点的 seed 概念自身。
      const seen = new Set<string>();
      for (const r of review) seen.add(r.conceptId);
      for (const id of seedIds) seen.add(id);
      for (const row of linkRows) {
        if (seen.has(row.conceptId)) continue;
        seen.add(row.conceptId);
        related.push({ conceptId: row.conceptId, name: row.name });
        if (related.length >= RELATED_LIMIT) break;
      }
    }

    return NextResponse.json({ review, related } satisfies RecommendResult);
  } catch (err) {
    // 推荐是锦上添花，任何异常都退化为空两组，绝不影响首页/概念页主流程。
    console.error('[recommend] 生成推荐失败：', err);
    return NextResponse.json(EMPTY);
  }
}
