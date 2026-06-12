/**
 * 概念详情页（F4.1 第三层 → 第四层入口）
 * 解释、所属领域/主题、标签（来自关联记录）、关联概念（relation_type + reason，可跳转）、
 * 关联卡片（问题 + 状态 + 下次复习时间）、原始记录列表（摘要 + 跳转详情）。
 * 修正入口（F2 修正回填）：概念名 / 解释 / 领域 / 主题可编辑，写 corrections 表。
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  conceptLinks,
  noteConcepts,
  notes as notesTable,
  noteTags,
  tags as tagsTable,
} from '@/lib/db/schema';
import { excerpt } from '@/features/library/search';
import ConceptEditor from '@/features/library/components/ConceptEditor';
import { PageShell, SectionTitle, Badge, cardClass, cn } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: '概念 · 小M' };

const NOTE_TYPE_ICON: Record<string, string> = {
  text: '✏️',
  voice: '🎙️',
  link: '🔗',
  image: '🖼️',
};

const CARD_STATUS_LABELS: Record<string, string> = {
  active: '复习中',
  graduated: '已内化 🎓',
  suspended: '已暂停',
};

interface NoteRow {
  id: string;
  type: string;
  raw_content: string | null;
  transcript: string | null;
  url: string | null;
  summary: string | null;
  why_important: string | null;
  created_at: string;
}

export default async function ConceptDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) notFound();
  const db = getDb();

  // 概念本体：显式按 user_id 过滤（原靠 RLS），他人概念视为不存在。
  const conceptRows = await db
    .select({
      id: conceptsTable.id,
      name: conceptsTable.name,
      summary: conceptsTable.summary,
      domain: conceptsTable.domain,
      topic: conceptsTable.topic,
    })
    .from(conceptsTable)
    .where(and(eq(conceptsTable.id, params.id), eq(conceptsTable.userId, user.id)))
    .limit(1);
  const concept = conceptRows[0];
  if (!concept) notFound();

  // 关联记录、卡片、概念链接并行取
  const [ncRows, cards, linkRows] = await Promise.all([
    db
      .select({
        id: notesTable.id,
        type: notesTable.type,
        raw_content: notesTable.rawContent,
        transcript: notesTable.transcript,
        url: notesTable.url,
        summary: notesTable.summary,
        why_important: notesTable.whyImportant,
        created_at: notesTable.createdAt,
      })
      .from(noteConcepts)
      .innerJoin(notesTable, eq(notesTable.id, noteConcepts.noteId))
      .where(and(eq(noteConcepts.conceptId, concept.id), isNull(notesTable.deletedAt))),
    db
      .select({
        id: cardsTable.id,
        question: cardsTable.question,
        status: cardsTable.status,
        fsrs_state: cardsTable.fsrsState,
      })
      .from(cardsTable)
      .where(eq(cardsTable.conceptId, concept.id))
      .orderBy(asc(cardsTable.createdAt)),
    db
      .select({
        concept_a: conceptLinks.conceptA,
        concept_b: conceptLinks.conceptB,
        relation_type: conceptLinks.relationType,
        reason: conceptLinks.reason,
      })
      .from(conceptLinks)
      .where(or(eq(conceptLinks.conceptA, concept.id), eq(conceptLinks.conceptB, concept.id))),
  ]);

  const notes: NoteRow[] = ncRows
    .map((r) => ({
      ...r,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // 标签来自关联记录（tags 挂在 notes 上，记录详情页可修改）
  let tagNames: string[] = [];
  if (notes.length > 0) {
    const tagRows = await db
      .select({ name: tagsTable.name })
      .from(noteTags)
      .innerJoin(tagsTable, eq(tagsTable.id, noteTags.tagId))
      .where(inArray(noteTags.noteId, notes.map((n) => n.id)));
    tagNames = Array.from(new Set(tagRows.map((r) => r.name).filter(Boolean)));
  }

  // 关联概念：取对端概念名（双向）。对端同样限定本人概念。
  const links = linkRows;
  const otherIds = Array.from(
    new Set(
      links.map((l) => (l.concept_a === concept.id ? l.concept_b : l.concept_a))
    )
  );
  const otherNames = new Map<string, string>();
  if (otherIds.length > 0) {
    const others = await db
      .select({ id: conceptsTable.id, name: conceptsTable.name })
      .from(conceptsTable)
      .where(and(inArray(conceptsTable.id, otherIds), eq(conceptsTable.userId, user.id)));
    for (const o of others) otherNames.set(o.id, o.name);
  }

  return (
    <PageShell>
      {/* 面包屑 */}
      <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-zinc-400">
        <Link
          href="/library"
          className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
        >
          知识库
        </Link>
        {concept.domain && (
          <>
            <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>›</span>
            <Link
              href={`/library?domain=${encodeURIComponent(concept.domain)}`}
              className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
            >
              {concept.domain}
            </Link>
          </>
        )}
        {concept.domain && concept.topic && (
          <>
            <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>›</span>
            <Link
              href={`/library?domain=${encodeURIComponent(concept.domain)}&topic=${encodeURIComponent(concept.topic)}`}
              className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
            >
              {concept.topic}
            </Link>
          </>
        )}
      </nav>

      {/* 概念主体 + 修正入口 */}
      <ConceptEditor
        concept={{
          id: concept.id,
          name: concept.name,
          explanation: concept.summary ?? '',
          domain: concept.domain ?? '',
          topic: concept.topic ?? '',
        }}
      />

      {/* 标签（来自关联记录） */}
      {tagNames.length > 0 && (
        <section className="mt-6">
          <SectionTitle>标签</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {tagNames.map((t) => (
              <Link
                key={t}
                href={`/library?q=${encodeURIComponent(t)}`}
                className="rounded-pill bg-brand-light px-2.5 py-1 text-xs font-medium text-brand transition hover:bg-brand/15 active:scale-95 dark:bg-brand/15 dark:text-brand-100 dark:hover:bg-brand/25"
              >
                #{t}
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            标签挂在原始记录上，可在下方记录详情中修改。
          </p>
        </section>
      )}

      {/* 关联概念 */}
      {links.length > 0 && (
        <section className="mt-6">
          <SectionTitle>关联概念（{links.length}）</SectionTitle>
          <ul className="space-y-2.5">
            {links.map((l) => {
              const otherId = l.concept_a === concept.id ? l.concept_b : l.concept_a;
              return (
                <li key={`${l.concept_a}-${l.concept_b}`}>
                  <Link
                    href={`/library/concept/${otherId}`}
                    className={cn(cardClass({ interactive: true, padded: false }), 'block px-4 py-3.5')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                        {otherNames.get(otherId) ?? '（概念已删除）'}
                      </span>
                      {l.relation_type && <Badge tone="sky">{l.relation_type}</Badge>}
                    </div>
                    {l.reason && (
                      <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {l.reason}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 关联卡片 */}
      <section className="mt-6">
        <SectionTitle>复习卡片（{(cards ?? []).length}）</SectionTitle>
        {(cards ?? []).length === 0 ? (
          <p className="text-sm text-zinc-400">还没有卡片。</p>
        ) : (
          <ul className="space-y-2.5">
            {(cards ?? []).map((card) => {
              const due = (card.fsrs_state as { due?: string } | null)?.due;
              return (
                <li
                  key={card.id}
                  className={cn(cardClass({ padded: false }), 'px-4 py-3.5')}
                >
                  <p className="font-medium leading-snug text-zinc-800 dark:text-zinc-100">
                    {card.question}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                    <span>{CARD_STATUS_LABELS[card.status] ?? card.status}</span>
                    {card.status === 'active' && due && (
                      <span>下次复习：{new Date(due).toLocaleDateString('zh-CN')}</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 原始记录（第四层下钻） */}
      <section className="mt-6">
        <SectionTitle>原始记录（{notes.length}）</SectionTitle>
        {notes.length === 0 ? (
          <p className="text-sm text-zinc-400">没有关联的原始记录。</p>
        ) : (
          <ul className="space-y-2.5">
            {notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/library/note/${note.id}`}
                  className={cn(cardClass({ interactive: true, padded: false }), 'group block px-4 py-3.5')}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">
                      {NOTE_TYPE_ICON[note.type] ?? '📝'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                        {excerpt(
                          note.summary ||
                            note.raw_content ||
                            note.transcript ||
                            note.url,
                          90
                        ) || '（无文字内容）'}
                      </p>
                      <p className="mt-1.5 text-xs text-zinc-400">
                        {new Date(note.created_at).toLocaleDateString('zh-CN')} ·{' '}
                        <span className="text-brand/70 transition group-hover:text-brand">查看详情 ›</span>
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
