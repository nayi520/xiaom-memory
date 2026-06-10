import { createClient } from '@/lib/supabase/server';
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

/** Supabase 嵌套查询返回的行形态 */
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

export default async function ReviewPage() {
  const supabase = createClient();
  const nowIso = new Date().toISOString();

  // 今日到期总数（badge / 完成页统计用；RLS 已按用户隔离）
  const { count } = await supabase
    .from('cards')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .lte('fsrs_state->>due', nowIso);

  // 到期卡片（多取一些，在内存里按遗忘风险排序后取前 20）
  const { data } = await supabase
    .from('cards')
    .select(
      `id, question, answer, fsrs_state,
       concept:concepts!inner(
         id, name,
         note_concepts(
           note:notes(id, type, raw_content, transcript, url, media_path, why_important, created_at)
         )
       )`
    )
    .eq('status', 'active')
    .lte('fsrs_state->>due', nowIso)
    .order('fsrs_state->>due', { ascending: true })
    .limit(100);

  const rows = (data ?? []) as unknown as CardRow[];
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
  const { data: digest } = await supabase
    .from('digests')
    .select('content_md')
    .eq('type', 'daily')
    .eq('period', dayWindow().period)
    .maybeSingle();

  return (
    <ReviewSession
      items={queue}
      totalDue={count ?? queue.length}
      digestMd={digest?.content_md ?? null}
    />
  );
}
