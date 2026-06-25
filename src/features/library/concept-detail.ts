/**
 * 概念详情查询（F4.1 第三/四层）—— 复用于 JSON API（/api/library/concept/{id}）。
 *
 * 与 src/app/library/concept/[id]/page.tsx 的取数同口径：概念本体 + 关联原始记录（排除软删）
 * + 关联概念（对端名）+ 标签（来自关联记录）。授权严格按 concepts.user_id 过滤；他人/不存在返回 null。
 */

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  concepts as conceptsTable,
  conceptLinks,
  noteConcepts,
  notes as notesTable,
  noteTags,
  tags as tagsTable,
} from '@/lib/db/schema';
import { MEETING_MIN_CHARS } from '@/lib/constants';

export interface ConceptDetailNote {
  id: string;
  rawContent: string | null;
  type: string;
  createdAt: string;
  /** V30：是否为会议（长语音，由 SQL 判定，不取整段 transcript）；非语音恒为 false。 */
  isMeeting: boolean;
}
export interface ConceptDetailLink {
  conceptId: string;
  title: string;
}
/** 反向链接：引用本概念的概念（concept_links 双向）/ 记录（note_concepts→notes）。 */
export interface ConceptBacklinkNote {
  id: string;
  title: string;
  type: string;
  createdAt: string;
}
export interface ConceptBacklinks {
  concepts: ConceptDetailLink[];
  notes: ConceptBacklinkNote[];
}
export interface ConceptDetail {
  concept: { id: string; title: string; summary: string | null };
  notes: ConceptDetailNote[];
  links: ConceptDetailLink[];
  tags: string[];
  /** V15：反向链接——哪些概念/记录引用了它（向后兼容新增字段）。 */
  backlinks: ConceptBacklinks;
}

/** 记录正文取首个非空，截断为标题。 */
function noteTitle(raw: string | null, max = 60): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '（无文字内容）';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * 取某用户某概念的详情。概念不存在 / 非本人 → 返回 null（调用方转 404）。
 * notes 按 createdAt 倒序；links 仅含对端仍存在的本人概念；tags 去重。
 */
export async function getConceptDetail(
  db: Database,
  userId: string,
  conceptId: string
): Promise<ConceptDetail | null> {
  // 概念本体：显式按 user_id 过滤，他人概念视为不存在。
  const conceptRows = await db
    .select({
      id: conceptsTable.id,
      name: conceptsTable.name,
      summary: conceptsTable.summary,
    })
    .from(conceptsTable)
    .where(and(eq(conceptsTable.id, conceptId), eq(conceptsTable.userId, userId)))
    .limit(1);
  const concept = conceptRows[0];
  if (!concept) return null;

  // 关联记录、概念链接并行取（排除软删记录）。
  const [ncRows, linkRows] = await Promise.all([
    db
      .select({
        id: notesTable.id,
        type: notesTable.type,
        raw_content: notesTable.rawContent,
        created_at: notesTable.createdAt,
        // 会议判定走 SQL（语音 + 转写字数达阈值），避免把整段 transcript 取到内存。
        is_meeting: sql<boolean>`(${notesTable.type} = 'voice' and char_length(coalesce(trim(${notesTable.transcript}), '')) >= ${MEETING_MIN_CHARS})`,
      })
      .from(noteConcepts)
      .innerJoin(notesTable, eq(notesTable.id, noteConcepts.noteId))
      .where(and(eq(noteConcepts.conceptId, concept.id), isNull(notesTable.deletedAt))),
    db
      .select({
        concept_a: conceptLinks.conceptA,
        concept_b: conceptLinks.conceptB,
      })
      .from(conceptLinks)
      .where(or(eq(conceptLinks.conceptA, concept.id), eq(conceptLinks.conceptB, concept.id))),
  ]);

  const notes: ConceptDetailNote[] = ncRows
    .map((r) => ({
      id: r.id,
      rawContent: r.raw_content,
      type: r.type,
      createdAt: isoOf(r.created_at),
      isMeeting: r.is_meeting === true,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // 标签来自关联记录（tags 挂在 notes 上）。
  let tags: string[] = [];
  if (notes.length > 0) {
    const tagRows = await db
      .select({ name: tagsTable.name })
      .from(noteTags)
      .innerJoin(tagsTable, eq(tagsTable.id, noteTags.tagId))
      .where(
        inArray(
          noteTags.noteId,
          notes.map((n) => n.id)
        )
      );
    tags = Array.from(new Set(tagRows.map((r) => r.name).filter(Boolean)));
  }

  // 关联概念：取对端概念名（双向）。对端同样限定本人概念，已删除则跳过。
  const otherIds = Array.from(
    new Set(linkRows.map((l) => (l.concept_a === concept.id ? l.concept_b : l.concept_a)))
  );
  const links: ConceptDetailLink[] = [];
  if (otherIds.length > 0) {
    const others = await db
      .select({ id: conceptsTable.id, name: conceptsTable.name })
      .from(conceptsTable)
      .where(and(inArray(conceptsTable.id, otherIds), eq(conceptsTable.userId, userId)));
    for (const o of others) links.push({ conceptId: o.id, title: o.name });
  }

  // 反向链接（V15）：引用本概念的概念 = 双向 concept_links（即 links）；
  // 引用本概念的记录 = note_concepts→notes（即 notes，取正文做标题）。
  const backlinks: ConceptBacklinks = {
    concepts: links,
    notes: notes.map((n) => ({
      id: n.id,
      title: noteTitle(n.rawContent),
      type: n.type,
      createdAt: n.createdAt,
    })),
  };

  return {
    concept: { id: concept.id, title: concept.name, summary: concept.summary },
    notes,
    links,
    tags,
    backlinks,
  };
}
