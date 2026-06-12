/**
 * 回收站（PRD F5 记录软删除回收站）
 * 列出已移入回收站（deleted_at 非空）的记录，每条可恢复 / 永久删除。
 * 入口：设置页「回收站」。授权改应用层：显式按 user_id 过滤，只会看到自己的记录。
 */

import Link from 'next/link';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import TrashItemActions from '@/features/trash/components/TrashItemActions';
import { PageShell, EmptyState } from '@/components/ui';

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
  const user = await getCurrentUser();
  const rows = user
    ? await getDb()
        .select({
          id: notes.id,
          type: notes.type,
          raw_content: notes.rawContent,
          transcript: notes.transcript,
          url: notes.url,
          why_important: notes.whyImportant,
          summary: notes.summary,
          deleted_at: notes.deletedAt,
        })
        .from(notes)
        .where(and(eq(notes.userId, user.id), isNotNull(notes.deletedAt)))
        .orderBy(desc(notes.deletedAt))
    : [];

  const trashedNotes: TrashedNote[] = rows.map((r) => ({
    ...r,
    deleted_at:
      r.deleted_at instanceof Date ? r.deleted_at.toISOString() : String(r.deleted_at),
  }));

  return (
    <PageShell>
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-zinc-400">
        <Link
          href="/settings"
          className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
        >
          设置
        </Link>
        <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>›</span>
        <span className="font-medium text-zinc-600 dark:text-zinc-300">回收站</span>
      </nav>

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          回收站
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          移到回收站的记录不会出现在最近记录、知识库和搜索里。可恢复，或永久删除。
        </p>
      </header>

      {trashedNotes.length === 0 ? (
        <EmptyState
          icon="🗑️"
          title="回收站是空的"
          description="删除的记录会出现在这里，随时可以恢复。"
        />
      ) : (
        <ul className="space-y-2.5">
          {trashedNotes.map((note) => (
            <li
              key={note.id}
              className="rounded-card border border-zinc-200/80 bg-white px-4 py-3.5 text-sm shadow-card dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">{TYPE_ICON[note.type] ?? '📝'}</span>
                <div className="min-w-0 flex-1">
                  <p className="break-words leading-relaxed text-zinc-700 dark:text-zinc-200">
                    {preview(note) || '（无文字内容）'}
                  </p>
                  {note.why_important && (
                    <p className="mt-1 text-xs text-zinc-400">💡 {note.why_important}</p>
                  )}
                  <p className="mt-1.5 text-xs text-zinc-400">
                    删除于 {new Date(note.deleted_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
              <TrashItemActions noteId={note.id} />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
