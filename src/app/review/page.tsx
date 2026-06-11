import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  digests as digestsTable,
  noteConcepts,
  notes as notesTable,
} from '@/lib/db/schema';
import { dayWindow } from '@/features/digest/pipeline';
import {
  DAILY_REVIEW_LIMIT,
  sortQueue,
  type FsrsStateJson,
} from '@/features/review/fsrs';
import type { ReviewQueueItem, SourceNote } from '@/features/review/types';
import ReviewSession from '@/features/review/components/ReviewSession';

export const dynamic = 'force-dynamic';
export const metadata = { title: '复习 · 小M' };

/** 组装后的卡片行形态（与原 Supabase 嵌套查询等价，供 sortQueue + 队列映射用） */
interface CardRow {
  id: string;
  question: string;
  answer: string;
  fsrs_state: FsrsStateJson | null;
  concept: {
    id: string;
    name: string;
    note_concepts: { note: SourceNote | null }[] | null;
  } | null;
}

function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export default async function ReviewPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const nowIso = new Date().toISOString();

  if (!user) {
    return <ReviewSession items={[]} totalDue={0} digestMd={null} />;
  }

  // 到期条件：active 且 fsrs_state->>'due' <= now（ISO 字符串字典序=时间序）
  // 授权改应用层：经 concepts join 显式按 concepts.user_id 过滤（原靠 RLS）。
  const dueCondition = and(
    eq(conceptsTable.userId, user.id),
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
      .where(and(inArray(noteConcepts.conceptId, conceptIds), isNull(notesTable.deletedAt)));
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
    concept: {
      id: c.conceptId,
      name: c.conceptName,
      note_concepts: (notesByConcept.get(c.conceptId) ?? []).map((note) => ({ note })),
    },
  }));

  const queue: ReviewQueueItem[] = sortQueue(rows)
    .slice(0, DAILY_REVIEW_LIMIT)
    .map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      conceptName: row.concept?.name ?? '',
      notes: (row.concept?.note_concepts ?? [])
        .map((nc) => nc.note)
        .filter((n): n is SourceNote => n !== null),
    }));

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
