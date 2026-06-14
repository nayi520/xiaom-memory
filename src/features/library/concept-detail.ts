/**
 * 概念详情查询（F4.1 第三/四层）—— 复用于 JSON API（/api/library/concept/{id}）。
 *
 * 与 src/app/library/concept/[id]/page.tsx 的取数同口径：概念本体 + 关联原始记录（排除软删）
 * + 关联概念（对端名）+ 标签（来自关联记录）。授权严格按 concepts.user_id 过滤；他人/不存在返回 null。
 */

import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  concepts as conceptsTable,
  conceptLinks,
  noteConcepts,
  notes as notesTable,
  noteTags,
  tags as tagsTable,
} from '@/lib/db/schema';

export interface ConceptDetailNote {
  id: string;
  rawContent: string | null;
  type: string;
  createdAt: string;
}
export interface ConceptDetailLink {
  conceptId: string;
  title: string;
}
export interface ConceptDetail {
  concept: { id: string; title: string; summary: string | null };
  notes: ConceptDetailNote[];
  links: ConceptDetailLink[];
  tags: string[];
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

  return {
    concept: { id: concept.id, title: concept.name, summary: concept.summary },
    notes,
    links,
    tags,
  };
}
