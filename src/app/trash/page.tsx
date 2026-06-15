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
import TrashList, { type TrashedNote } from '@/features/trash/components/TrashList';
import { PageShell, ChevronRight } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: '回收站 · 小M' };

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
    <PageShell width="wide">
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-zinc-400">
        <Link
          href="/settings"
          className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
        >
          设置
        </Link>
        <ChevronRight aria-hidden className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <span className="font-medium text-zinc-600 dark:text-zinc-300">回收站</span>
      </nav>

      <header className="mb-5 lg:mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
          回收站
        </h1>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-zinc-400">
          移到回收站的记录不会出现在最近记录、知识库和搜索里。可恢复，或永久删除。
        </p>
      </header>

      <TrashList initialItems={trashedNotes} />
    </PageShell>
  );
}
