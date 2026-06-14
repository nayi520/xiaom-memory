/**
 * 复习队列查询（F3.4）—— 复用于服务端页面（/review）与 JSON API（/api/review/queue）。
 *
 * 职责：取「今日到期 active 卡」，按遗忘风险排序，裁到每日上限，组装溯源记录。
 * 这是从 src/app/review/page.tsx 抽出的查询逻辑，页面与 API 共用同一实现，
 * 保证两端口径一致（授权按 concepts.user_id 显式过滤，原靠 RLS）。
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  noteConcepts,
  notes as notesTable,
} from '@/lib/db/schema';
import { DAILY_REVIEW_LIMIT, sortQueue, type FsrsStateJson } from './fsrs';
import type { ReviewQueueItem, SourceNote } from './types';

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
  /** 今日到期总数（active 卡，未裁剪） */
  count: number;
  /** 排序、裁剪后的队列（≤ DAILY_REVIEW_LIMIT） */
  items: ReviewQueueItem[];
}

/**
 * 取某用户今日到期的复习队列。
 * - 到期条件：concepts.user_id = userId 且 cards.status='active' 且 fsrs_state->>'due' <= now
 * - 排序：遗忘风险高者优先（sortQueue），裁到 DAILY_REVIEW_LIMIT
 * - 溯源 notes：排除软删（deleted_at is null）
 */
export async function getReviewQueue(
  db: Database,
  userId: string,
  now: Date = new Date()
): Promise<ReviewQueue> {
  const nowIso = now.toISOString();

  // 到期条件：active 且 fsrs_state->>'due' <= now（ISO 字符串字典序=时间序）
  const dueCondition = and(
    eq(conceptsTable.userId, userId),
    eq(cardsTable.status, 'active'),
    sql`${cardsTable.fsrsState}->>'due' <= ${nowIso}`
  );

  // 今日到期总数（badge / 完成页统计用）
  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardsTable)
    .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
    .where(dueCondition);
  const count = countRows[0]?.n ?? 0;

  // 到期卡片（多取一些，内存里按遗忘风险排序后取前 DAILY_REVIEW_LIMIT）
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
    .where(dueCondition)
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
    rows.map((r) => ({ ...r, fsrs_state: r.fsrs_state }))
  )
    .slice(0, DAILY_REVIEW_LIMIT)
    .map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      conceptName: row.conceptName,
      conceptId: row.conceptId,
      notes: notesByConcept.get(row.conceptId) ?? [],
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
