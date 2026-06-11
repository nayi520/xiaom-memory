/**
 * 回收站（PRD F5 记录软删除回收站）
 * 列出已移入回收站（deleted_at 非空）的记录，每条可恢复 / 永久删除。
 * 入口：设置页「回收站」。RLS 已按 user_id 隔离，只会看到自己的记录。
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import TrashItemActions from '@/features/trash/components/TrashItemActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: '回收站 · 小M' };

const TYPE_ICON: Record<string, string> = {
  text: '✏️',
  voice: '🎙️',
  link: '🔗',
  image: '🖼️',
};

interface TrashedNote {
  id: string;
  type: string;
  raw_content: string | null;
  transcript: string | null;
  url: string | null;
  why_important: string | null;
  summary: string | null;
  deleted_at: string;
}

function preview(note: TrashedNote): string {
  const text =
    note.summary || note.raw_content || note.transcript || note.url || '';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export default async function TrashPage() {
  const supabase = createClient();

  const { data } = await supabase
    .from('notes')
    .select(
      'id, type, raw_content, transcript, url, why_important, summary, deleted_at'
    )
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  const notes = (data ?? []) as TrashedNote[];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
      <nav className="mb-3 flex items-center gap-1 text-sm text-zinc-400">
        <Link href="/settings" className="transition active:text-zinc-600">
          设置
        </Link>
        <span>›</span>
        <span className="font-medium text-zinc-600 dark:text-zinc-300">回收站</span>
      </nav>

      <header className="mb-4">
        <h1 className="text-xl font-bold text-brand">回收站</h1>
        <p className="mt-1 text-xs text-zinc-400">
          移到回收站的记录不会出现在最近记录、知识库和搜索里。可恢复，或永久删除。
        </p>
      </header>

      {notes.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-400">
          回收站是空的。
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {TYPE_ICON[note.type] ?? '📝'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words leading-relaxed">
                    {preview(note) || '（无文字内容）'}
                  </p>
                  {note.why_important && (
                    <p className="mt-1 text-xs text-zinc-400">
                      💡 {note.why_important}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-zinc-400">
                    删除于 {new Date(note.deleted_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
              <TrashItemActions noteId={note.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
