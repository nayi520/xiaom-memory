/**
 * 复习队列查询（F3.4 + V14 复习模式）—— 复用于服务端页面（/review）与 JSON API（/api/review/queue）。
 *
 * 职责：按所选模式取卡片，按遗忘风险排序，裁到每日上限，标注 leech，组装溯源记录。
 * 模式（V14）：
 *   - due（默认）：今日到期 active 卡（fsrs_state->>'due' <= now）。
 *   - all：全部 active 卡（cram，无视到期）。
 *   - leech：lapses ≥ 阈值的 active 卡（顽固卡集中攻坚）。
 * 可叠加 domain：仅取所属概念 domain = 给定值的卡。
 * 页面与 API 共用同一实现，保证两端口径一致（授权按 concepts.user_id 显式过滤，原靠 RLS）。
 */

import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  noteConcepts,
  notes as notesTable,
} from '@/lib/db/schema';
import {
  DAILY_REVIEW_LIMIT,
  isLeech,
  leechThreshold,
  sortQueue,
  type FsrsStateJson,
} from './fsrs';
import type { ReviewMode, ReviewQueueItem, SourceNote } from './types';

function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/** 组装后的卡片行形态（供 sortQueue + 队列映射用） */
interface CardRow {
  id: string;
  question: string;
  answer: string;
  fsrs_state: FsrsStateJson | null;
  conceptId: string;
  conceptName: string;
}

export interface ReviewQueue {
  /** 该模式下的卡片总数（未裁剪；due=今日到期数 / all=全部 active / leech=顽固卡数） */
  count: number;
  /** 排序、裁剪后的队列（≤ DAILY_REVIEW_LIMIT） */
  items: ReviewQueueItem[];
}

/** getReviewQueue 选项（V14）。缺省 mode='due'、不限 domain，与 V7 行为完全一致。 */
export interface ReviewQueueOptions {
  /** 复习模式，缺省 'due'。 */
  mode?: ReviewMode;
  /** 可选：仅取所属概念 domain = 此值的卡（null/undefined = 不限）。 */
  domain?: string | null;
}

/**
 * 取某用户的复习队列（按模式 + 可选领域）。
 * - 共同条件：concepts.user_id = userId 且 cards.status='active'。
 * - due：叠加 fsrs_state->>'due' <= now；all：不叠加；leech：叠加 (fsrs_state->>'lapses')::int >= 阈值。
 * - domain：叠加 concepts.domain = domain。
 * - 排序：遗忘风险高者优先（sortQueue），裁到 DAILY_REVIEW_LIMIT。
 * - 溯源 notes：排除软删（deleted_at is null）。
 */
export async function getReviewQueue(
  db: Database,
  userId: string,
  optionsOrNow: ReviewQueueOptions | Date = {},
  now: Date = new Date()
): Promise<ReviewQueue> {
  // 兼容旧签名 getReviewQueue(db, userId, now?)：第三参传 Date 时视为 now，选项取默认。
  const options: ReviewQueueOptions =
    optionsOrNow instanceof Date ? {} : optionsOrNow;
  const at = optionsOrNow instanceof Date ? optionsOrNow : now;
  const mode: ReviewMode = options.mode ?? 'due';
  const domain = options.domain ?? null;
  const nowIso = at.toISOString();
  const threshold = leechThreshold();

  // 共同条件：归属本人 + active。
  const conds: SQL[] = [
    eq(conceptsTable.userId, userId),
    eq(cardsTable.status, 'active'),
  ];
  // 模式条件。
  if (mode === 'due') {
    // 到期：fsrs_state->>'due' <= now（ISO 字符串字典序=时间序）。
    conds.push(sql`${cardsTable.fsrsState}->>'due' <= ${nowIso}`);
  } else if (mode === 'leech') {
    // 顽固卡：(fsrs_state->>'lapses')::int >= 阈值（缺省/非数视为 0，不入选）。
    conds.push(
      sql`coalesce((${cardsTable.fsrsState}->>'lapses')::int, 0) >= ${threshold}`
    );
  }
  // 领域过滤（可选，三种模式均可叠加）。
  if (domain) {
    conds.push(eq(conceptsTable.domain, domain));
  }
  const whereCond = and(...conds);

  // 该模式下卡片总数（badge / 完成页统计用，未裁剪）。
  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardsTable)
    .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
    .where(whereCond);
  const count = countRows[0]?.n ?? 0;

  // 候选卡片（多取一些，内存里按遗忘风险排序后取前 DAILY_REVIEW_LIMIT）。
  const cardRows = await db
    .select({
      id: cardsTable.id,
      question: cardsTable.question,
      answer: cardsTable.answer,
      fsrsState: cardsTable.fsrsState,
      conceptId: conceptsTable.id,
      conceptName: conceptsTable.name,
    })
    .from(cardsTable)
    .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
    .where(whereCond)
    .orderBy(asc(sql`${cardsTable.fsrsState}->>'due'`))
    .limit(100);

  // 溯源记录：取这些卡对应概念的关联记录（排除软删 notes）。
  // 该过滤只作用于 notes 这层；卡片本身仍保留（即便其唯一来源记录被删）。
  const conceptIds = Array.from(new Set(cardRows.map((c) => c.conceptId)));
  const notesByConcept = new Map<string, SourceNote[]>();
  if (conceptIds.length > 0) {
    const ncRows = await db
      .select({
        conceptId: noteConcepts.conceptId,
        id: notesTable.id,
        type: notesTable.type,
        raw_content: notesTable.rawContent,
        transcript: notesTable.transcript,
        url: notesTable.url,
        media_path: notesTable.mediaPath,
        why_important: notesTable.whyImportant,
        created_at: notesTable.createdAt,
      })
      .from(noteConcepts)
      .innerJoin(notesTable, eq(notesTable.id, noteConcepts.noteId))
      .where(
        and(inArray(noteConcepts.conceptId, conceptIds), isNull(notesTable.deletedAt))
      );
    for (const r of ncRows) {
      const note: SourceNote = {
        id: r.id,
        type: r.type as SourceNote['type'],
        raw_content: r.raw_content,
        transcript: r.transcript,
        url: r.url,
        media_path: r.media_path,
        why_important: r.why_important,
        created_at: isoOf(r.created_at),
      };
      const list = notesByConcept.get(r.conceptId) ?? [];
      list.push(note);
      notesByConcept.set(r.conceptId, list);
    }
  }

  const rows: CardRow[] = cardRows.map((c) => ({
    id: c.id,
    question: c.question,
    answer: c.answer,
    fsrs_state: c.fsrsState as FsrsStateJson | null,
    conceptId: c.conceptId,
    conceptName: c.conceptName,
  }));

  const items: ReviewQueueItem[] = sortQueue(
    rows.map((r) => ({ ...r, fsrs_state: r.fsrs_state })),
    at
  )
    .slice(0, DAILY_REVIEW_LIMIT)
    .map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      conceptName: row.conceptName,
      conceptId: row.conceptId,
      notes: notesByConcept.get(row.conceptId) ?? [],
      // leech 标记：lapses ≥ 阈值（与 mode=leech 过滤同口径）。
      leech: isLeech(row.fsrs_state, threshold),
      // 评分前快照：客户端持有以支持会话内「撤销上一次评分」。
      fsrsState: row.fsrs_state,
    }));

  return { count, items };
}

/** 今日到期 active 卡数（角标用），与 getReviewQueue 的 count 同口径但更轻。 */
export async function getDueCount(
  db: Database,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const nowIso = now.toISOString();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardsTable)
    .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
    .where(
      and(
        eq(conceptsTable.userId, userId),
        eq(cardsTable.status, 'active'),
        sql`${cardsTable.fsrsState}->>'due' <= ${nowIso}`
      )
    );
  return rows[0]?.n ?? 0;
}
