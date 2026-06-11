/**
 * 原始记录详情页（F4.1 第四层）
 * 原文 / 链接 / 音频、why_important、AI 摘要、所属概念、标签（可编辑 → corrections）。
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import NoteAudio from '@/features/library/components/NoteAudio';
import NoteTagEditor from '@/features/library/components/NoteTagEditor';
import NoteDeleteButton from '@/features/capture/components/NoteDeleteButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: '记录 · 小M' };

const NOTE_TYPE_LABELS: Record<string, string> = {
  text: '✏️ 文本',
  voice: '🎙️ 语音',
  link: '🔗 链接',
  image: '🖼️ 图片',
};

const STATUS_LABELS: Record<string, string> = {
  inbox: '待整理',
  processed: '已整理',
  needs_review: '整理失败，待处理',
  archived: '已归档',
};

export default async function NoteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  // 已软删（移入回收站）的记录视为不存在；恢复后可再访问
  const { data: note } = await supabase
    .from('notes')
    .select(
      'id, type, raw_content, transcript, url, media_path, why_important, summary, status, created_at'
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!note) notFound();

  const [{ data: tagRows }, { data: conceptRows }] = await Promise.all([
    supabase.from('note_tags').select('tag:tags(name)').eq('note_id', note.id),
    supabase
      .from('note_concepts')
      .select('concept:concepts(id, name)')
      .eq('note_id', note.id),
  ]);

  const tags = ((tagRows ?? []) as unknown as { tag: { name: string } | null }[])
    .map((r) => r.tag?.name)
    .filter((n): n is string => Boolean(n));
  const concepts = (
    (conceptRows ?? []) as unknown as { concept: { id: string; name: string } | null }[]
  )
    .map((r) => r.concept)
    .filter((c): c is { id: string; name: string } => c !== null);

  const text = note.raw_content || note.transcript || '';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
      <nav className="mb-3 flex items-center gap-1 text-sm text-zinc-400">
        <Link href="/library" className="transition active:text-zinc-600">
          知识库
        </Link>
        <span>›</span>
        <span className="font-medium text-zinc-600 dark:text-zinc-300">原始记录</span>
        <span className="ml-auto">
          <NoteDeleteButton noteId={note.id} redirectTo="/library" />
        </span>
      </nav>

      {/* 原文 / 链接 / 音频 */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 flex flex-wrap gap-x-3 text-xs text-zinc-400">
          <span>{NOTE_TYPE_LABELS[note.type] ?? note.type}</span>
          <span>{new Date(note.created_at).toLocaleString('zh-CN')}</span>
          <span>{STATUS_LABELS[note.status] ?? note.status}</span>
        </p>

        {text && (
          <p className="whitespace-pre-wrap break-words leading-relaxed text-zinc-800 dark:text-zinc-100">
            {text}
          </p>
        )}

        {note.url && (
          <a
            href={note.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block truncate text-sm text-brand underline underline-offset-2"
          >
            {note.url}
          </a>
        )}

        {note.media_path && <NoteAudio mediaPath={note.media_path} />}

        {note.type === 'voice' && note.transcript && note.raw_content && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-zinc-400">
              查看原始转写（未清洗）
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-500">
              {note.transcript}
            </p>
          </details>
        )}
      </section>

      {/* 为什么重要 */}
      {note.why_important && (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
          <h2 className="mb-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            💡 为什么重要
          </h2>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
            {note.why_important}
          </p>
        </section>
      )}

      {/* AI 摘要 */}
      {note.summary && (
        <section className="mt-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
            AI 摘要
          </h2>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
            {note.summary}
          </p>
        </section>
      )}

      {/* 标签（可编辑 → corrections） */}
      <section className="mt-4">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
          标签
        </h2>
        <NoteTagEditor noteId={note.id} tags={tags} />
      </section>

      {/* 提炼出的概念 */}
      {concepts.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
            提炼出的概念（{concepts.length}）
          </h2>
          <ul className="space-y-2">
            {concepts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/library/concept/${c.id}`}
                  className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3 transition active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  <span className="font-medium">💡 {c.name}</span>
                  <span className="text-zinc-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
