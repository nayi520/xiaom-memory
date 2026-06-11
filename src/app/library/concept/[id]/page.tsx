/**
 * 概念详情页（F4.1 第三层 → 第四层入口）
 * 解释、所属领域/主题、标签（来自关联记录）、关联概念（relation_type + reason，可跳转）、
 * 关联卡片（问题 + 状态 + 下次复习时间）、原始记录列表（摘要 + 跳转详情）。
 * 修正入口（F2 修正回填）：概念名 / 解释 / 领域 / 主题可编辑，写 corrections 表。
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { excerpt } from '@/features/library/search';
import ConceptEditor from '@/features/library/components/ConceptEditor';

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
  const supabase = createClient();

  const { data: concept } = await supabase
    .from('concepts')
    .select('id, name, summary, domain, topic, created_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!concept) notFound();

  // 关联记录、卡片、概念链接并行取
  const [{ data: ncRows }, { data: cards }, { data: linkRows }] = await Promise.all([
    supabase
      .from('note_concepts')
      .select(
        'note:notes!inner(id, type, raw_content, transcript, url, summary, why_important, created_at)'
      )
      .eq('concept_id', concept.id)
      .is('note.deleted_at', null),
    supabase
      .from('cards')
      .select('id, question, status, fsrs_state')
      .eq('concept_id', concept.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('concept_links')
      .select('concept_a, concept_b, relation_type, reason')
      .or(`concept_a.eq.${concept.id},concept_b.eq.${concept.id}`),
  ]);

  const notes = ((ncRows ?? []) as unknown as { note: NoteRow | null }[])
    .map((r) => r.note)
    .filter((n): n is NoteRow => n !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // 标签来自关联记录（tags 挂在 notes 上，记录详情页可修改）
  let tagNames: string[] = [];
  if (notes.length > 0) {
    const { data: tagRows } = await supabase
      .from('note_tags')
      .select('tag:tags(name)')
      .in(
        'note_id',
        notes.map((n) => n.id)
      );
    tagNames = Array.from(
      new Set(
        ((tagRows ?? []) as unknown as { tag: { name: string } | null }[])
          .map((r) => r.tag?.name)
          .filter((n): n is string => Boolean(n))
      )
    );
  }

  // 关联概念：取对端概念名（双向）
  const links = (linkRows ?? []) as {
    concept_a: string;
    concept_b: string;
    relation_type: string | null;
    reason: string | null;
  }[];
  const otherIds = Array.from(
    new Set(
      links.map((l) => (l.concept_a === concept.id ? l.concept_b : l.concept_a))
    )
  );
  const otherNames = new Map<string, string>();
  if (otherIds.length > 0) {
    const { data: others } = await supabase
      .from('concepts')
      .select('id, name')
      .in('id', otherIds);
    for (const o of others ?? []) otherNames.set(o.id as string, o.name as string);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
      {/* 面包屑 */}
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-zinc-400">
        <Link href="/library" className="transition active:text-zinc-600">
          知识库
        </Link>
        {concept.domain && (
          <>
            <span>›</span>
            <Link
              href={`/library?domain=${encodeURIComponent(concept.domain)}`}
              className="transition active:text-zinc-600"
            >
              {concept.domain}
            </Link>
          </>
        )}
        {concept.domain && concept.topic && (
          <>
            <span>›</span>
            <Link
              href={`/library?domain=${encodeURIComponent(concept.domain)}&topic=${encodeURIComponent(concept.topic)}`}
              className="transition active:text-zinc-600"
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
        <section className="mt-4">
          <SectionTitle>标签</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {tagNames.map((t) => (
              <Link
                key={t}
                href={`/library?q=${encodeURIComponent(t)}`}
                className="rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand transition active:opacity-70 dark:bg-zinc-800 dark:text-zinc-300"
              >
                #{t}
              </Link>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-zinc-400">
            标签挂在原始记录上，可在下方记录详情中修改。
          </p>
        </section>
      )}

      {/* 关联概念 */}
      {links.length > 0 && (
        <section className="mt-5">
          <SectionTitle>关联概念（{links.length}）</SectionTitle>
          <ul className="space-y-2">
            {links.map((l) => {
              const otherId = l.concept_a === concept.id ? l.concept_b : l.concept_a;
              return (
                <li key={`${l.concept_a}-${l.concept_b}`}>
                  <Link
                    href={`/library/concept/${otherId}`}
                    className="block rounded-2xl border border-zinc-200 bg-white px-4 py-3 transition active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {otherNames.get(otherId) ?? '（概念已删除）'}
                      </span>
                      {l.relation_type && (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-600 dark:bg-sky-950 dark:text-sky-400">
                          {l.relation_type}
                        </span>
                      )}
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
      <section className="mt-5">
        <SectionTitle>复习卡片（{(cards ?? []).length}）</SectionTitle>
        {(cards ?? []).length === 0 ? (
          <p className="text-sm text-zinc-400">还没有卡片。</p>
        ) : (
          <ul className="space-y-2">
            {(cards ?? []).map((card) => {
              const due = (card.fsrs_state as { due?: string } | null)?.due;
              return (
                <li
                  key={card.id}
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="font-medium leading-snug">{card.question}</p>
                  <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-zinc-400">
                    <span>{CARD_STATUS_LABELS[card.status] ?? card.status}</span>
                    {card.status === 'active' && due && (
                      <span>
                        下次复习：{new Date(due).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 原始记录（第四层下钻） */}
      <section className="mt-5">
        <SectionTitle>原始记录（{notes.length}）</SectionTitle>
        {notes.length === 0 ? (
          <p className="text-sm text-zinc-400">没有关联的原始记录。</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/library/note/${note.id}`}
                  className="block rounded-2xl border border-zinc-200 bg-white px-4 py-3 transition active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">
                      {NOTE_TYPE_ICON[note.type] ?? '📝'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm leading-relaxed">
                        {excerpt(
                          note.summary ||
                            note.raw_content ||
                            note.transcript ||
                            note.url,
                          90
                        ) || '（无文字内容）'}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {new Date(note.created_at).toLocaleDateString('zh-CN')} · 查看详情 ›
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
      {children}
    </h2>
  );
}
