/**
 * 知识库下钻树（F4.1）—— 复用于 JSON API（/api/library/tree）。
 *
 * 与 src/app/library/page.tsx 的下钻取数同口径：一次取全量概念 + 每概念关联记录数，
 * 内存聚合为 领域 → 主题 → 概念 三层（概念层带 noteCount，第四层「原始记录」在概念详情）。
 * 授权按 concepts.user_id 显式过滤；noteCount 经 note_concepts 内连接 notes 且排除软删（deleted_at is null）。
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { concepts as conceptsTable, noteConcepts, notes } from '@/lib/db/schema';

/** 与页面一致的未分类占位（domain/topic 为空时归入此组） */
export const UNCATEGORIZED = '未分类';

export interface TreeConcept {
  id: string;
  title: string;
  noteCount: number;
}
export interface TreeTopic {
  name: string;
  concepts: TreeConcept[];
}
export interface TreeDomain {
  name: string;
  topics: TreeTopic[];
}

interface ConceptRow {
  id: string;
  name: string;
  domain: string | null;
  topic: string | null;
  created_at: Date | string;
}

/**
 * 取某用户的完整知识库树（领域 → 主题 → 概念，概念层带 noteCount）。
 * 概念在层内按创建时间倒序（与页面下钻 orderBy desc(createdAt) 一致）。
 */
export async function getLibraryTree(
  db: Database,
  userId: string
): Promise<TreeDomain[]> {
  const [conceptData, ncData] = await Promise.all([
    db
      .select({
        id: conceptsTable.id,
        name: conceptsTable.name,
        domain: conceptsTable.domain,
        topic: conceptsTable.topic,
        created_at: conceptsTable.createdAt,
      })
      .from(conceptsTable)
      .where(eq(conceptsTable.userId, userId))
      .orderBy(desc(conceptsTable.createdAt)),
    db
      .select({ concept_id: noteConcepts.conceptId })
      .from(noteConcepts)
      .innerJoin(notes, eq(notes.id, noteConcepts.noteId))
      .innerJoin(conceptsTable, eq(conceptsTable.id, noteConcepts.conceptId))
      .where(and(eq(conceptsTable.userId, userId), isNull(notes.deletedAt))),
  ]);

  const noteCount = new Map<string, number>();
  for (const row of ncData) {
    noteCount.set(row.concept_id, (noteCount.get(row.concept_id) ?? 0) + 1);
  }

  const domainOf = (c: ConceptRow) => c.domain?.trim() || UNCATEGORIZED;
  const topicOf = (c: ConceptRow) => c.topic?.trim() || UNCATEGORIZED;

  // 保持插入顺序（概念已按 createdAt desc 排序，Map 迭代序即首见序）。
  const domains = new Map<string, Map<string, TreeConcept[]>>();
  for (const c of conceptData as ConceptRow[]) {
    const d = domainOf(c);
    const t = topicOf(c);
    if (!domains.has(d)) domains.set(d, new Map());
    const topics = domains.get(d)!;
    if (!topics.has(t)) topics.set(t, []);
    topics.get(t)!.push({
      id: c.id,
      title: c.name,
      noteCount: noteCount.get(c.id) ?? 0,
    });
  }

  return Array.from(domains.entries()).map(([name, topics]) => ({
    name,
    topics: Array.from(topics.entries()).map(([tName, concepts]) => ({
      name: tName,
      concepts,
    })),
  }));
}
