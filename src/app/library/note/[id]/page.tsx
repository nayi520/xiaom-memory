/**
 * 原始记录详情页（F4.1 第四层）
 * 原文 / 链接 / 音频、why_important、AI 摘要、所属概念、标签（可编辑 → corrections）。
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  concepts as conceptsTable,
  noteConcepts,
  notes as notesTable,
  noteTags,
  tags as tagsTable,
} from '@/lib/db/schema';
import NoteAudio from '@/features/library/components/NoteAudio';
import NoteImage from '@/features/library/components/NoteImage';
import NoteTagEditor from '@/features/library/components/NoteTagEditor';
import NoteDeleteButton from '@/features/capture/components/NoteDeleteButton';
import {
  PageShell,
  SectionTitle,
  Markdown,
  NoteTypeIcon,
  NOTE_TYPE_LABELS,
  WhyIcon,
  LinkIcon,
  ChevronRight,
  cardClass,
  cn,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: '记录 · 小M' };

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
  const user = await getCurrentUser();
  if (!user) notFound();
  const db = getDb();

  // 已软删（移入回收站）的记录视为不存在；恢复后可再访问。
  // 授权改应用层：显式按 user_id 过滤（原靠 RLS），他人记录视为不存在。
  const noteRows = await db
    .select({
      id: notesTable.id,
      type: notesTable.type,
      raw_content: notesTable.rawContent,
      transcript: notesTable.transcript,
      url: notesTable.url,
      media_path: notesTable.mediaPath,
      why_important: notesTable.whyImportant,
      summary: notesTable.summary,
      status: notesTable.status,
      created_at: notesTable.createdAt,
    })
    .from(notesTable)
    .where(
      and(
        eq(notesTable.id, params.id),
        eq(notesTable.userId, user.id),
        isNull(notesTable.deletedAt)
      )
    )
    .limit(1);
  const note = noteRows[0];
  if (!note) notFound();

  const [tagRows, conceptRows] = await Promise.all([
    db
      .select({ name: tagsTable.name })
      .from(noteTags)
      .innerJoin(tagsTable, eq(tagsTable.id, noteTags.tagId))
      .where(eq(noteTags.noteId, note.id)),
    db
      .select({ id: conceptsTable.id, name: conceptsTable.name })
      .from(noteConcepts)
      .innerJoin(conceptsTable, eq(conceptsTable.id, noteConcepts.conceptId))
      .where(eq(noteConcepts.noteId, note.id)),
  ]);

  const tags = tagRows.map((r) => r.name).filter(Boolean);
  const concepts = conceptRows;

  const text = note.raw_content || note.transcript || '';

  return (
    <PageShell width="reading">
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-zinc-400">
        <Link
          href="/library"
          className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
        >
          知识库
        </Link>
        <ChevronRight aria-hidden className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <span className="font-medium text-zinc-600 dark:text-zinc-300">原始记录</span>
        <span className="ml-auto">
          <NoteDeleteButton noteId={note.id} redirectTo="/library" />
        </span>
      </nav>

      {/* 原文 / 链接 / 音频 */}
      <section className="rounded-card border border-zinc-200/80 bg-white p-6 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1 font-medium text-zinc-500 dark:text-zinc-400">
            <NoteTypeIcon type={note.type} className="h-3.5 w-3.5" />
            {NOTE_TYPE_LABELS[note.type] ?? note.type}
          </span>
          <span>{new Date(note.created_at).toLocaleString('zh-CN')}</span>
          <span>{STATUS_LABELS[note.status] ?? note.status}</span>
        </p>

        {/* 图片记录：先展示原图（签名 URL，懒加载防抖），OCR 文本作为正文随后渲染。 */}
        {note.type === 'image' && note.media_path && (
          <NoteImage mediaPath={note.media_path} alt={text || '图片记录'} className="mb-3" />
        )}

        {text && <Markdown content={text} />}

        {note.url && (
          <a
            href={note.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-md text-sm text-brand underline underline-offset-2 transition hover:text-brand-dark focus-visible:outline-none"
          >
            <LinkIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{note.url}</span>
          </a>
        )}

        {note.type === 'voice' && note.media_path && (
          <NoteAudio mediaPath={note.media_path} />
        )}

        {/* 原始转写折叠区：仅当正文是「AI 整理后的结构化内容」（与原始转写不同）时才展示，
            避免 AI 总结降级时 raw_content 回退为转写本身、与上方正文重复两遍。 */}
        {note.type === 'voice' &&
          note.transcript &&
          note.transcript.trim() !== text.trim() && (
            <details className="mt-3 border-t border-dashed border-zinc-200 pt-3 dark:border-zinc-700">
              <summary className="cursor-pointer text-xs text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-300">
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
        <section className="mt-4 rounded-card border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-900/60 dark:bg-amber-950/40">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <WhyIcon aria-hidden className="h-3.5 w-3.5" />
            为什么重要
          </h2>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
            {note.why_important}
          </p>
        </section>
      )}

      {/* AI 摘要 */}
      {note.summary && (
        <section className="mt-4 rounded-card border border-zinc-200/80 bg-white px-5 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
          <SectionTitle className="mb-1.5">AI 摘要</SectionTitle>
          <Markdown
            content={note.summary}
            className="text-sm text-zinc-700 dark:text-zinc-200"
          />
        </section>
      )}

      {/* 标签（可编辑 → corrections） */}
      <section className="mt-6">
        <SectionTitle>标签</SectionTitle>
        <NoteTagEditor noteId={note.id} tags={tags} />
      </section>

      {/* 提炼出的概念 */}
      {concepts.length > 0 && (
        <section className="mt-6">
          <SectionTitle>提炼出的概念（{concepts.length}）</SectionTitle>
          <ul className="space-y-2.5">
            {concepts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/library/concept/${c.id}`}
                  className={cn(cardClass({ interactive: true, padded: false }), 'group flex items-center justify-between gap-3 px-4 py-3.5')}
                >
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-100">
                    <WhyIcon aria-hidden className="h-4 w-4 shrink-0 text-amber-400" />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
