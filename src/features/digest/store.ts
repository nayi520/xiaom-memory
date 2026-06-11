/**
 * DigestStore 的 Drizzle 实现（去 Supabase 改造 · Phase B）
 *
 * 取代原 Supabase service-role 实现：
 *   - 数据访问全部走 Drizzle（@/lib/db），授权改应用层（每个查询显式按 user_id 过滤，原靠 RLS）。
 *   - match_concepts RPC → 对 concepts.embedding 的 pgvector 余弦查询（drizzle sql`` 模板）。
 *
 * 仅服务端使用（cron / 立即整理）。导出工厂改名 createDigestStore(db)，
 * 调用方（digest/index、api/cron/digest、api/digest/run）已同步更新。
 */

import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  cards,
  concepts,
  conceptLinks,
  corrections as correctionsTable,
  digests,
  noteConcepts,
  notes,
  noteTags,
  tags,
} from '@/lib/db/schema';
import type { Note } from '@/lib/types';
import type {
  CorrectionRow,
  DigestStore,
  MatchedConcept,
  NewCard,
} from './pipeline';

/** vector(1536) 的 pgvector 文本表示：'[a,b,c]' */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/** match_concepts 原始 SQL 行（created_at 由驱动返回 Date，相似度可能为字符串数值）
 *  用 type 别名（含索引签名）以满足 db.execute<TRow extends Record<string, unknown>>。 */
type MatchRow = {
  id: string;
  name: string;
  summary: string | null;
  created_at: Date | string;
  similarity: number | string;
  source: string | null;
  [key: string]: unknown;
};

export function createDigestStore(db: Database): DigestStore {
  return {
    async listUserIdsWithInbox(fromIso, toIso) {
      const rows = await db
        .selectDistinct({ userId: notes.userId })
        .from(notes)
        .where(
          and(
            eq(notes.status, 'inbox'),
            isNull(notes.deletedAt),
            gte(notes.createdAt, new Date(fromIso)),
            lt(notes.createdAt, new Date(toIso))
          )
        );
      return rows.map((r) => r.userId);
    },

    async listInboxNotes(userId, fromIso, toIso) {
      const rows = await db
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.userId, userId),
            eq(notes.status, 'inbox'),
            isNull(notes.deletedAt),
            gte(notes.createdAt, new Date(fromIso)),
            lt(notes.createdAt, new Date(toIso))
          )
        )
        .orderBy(asc(notes.createdAt));
      return rows.map(rowToNote);
    },

    async getDomainsTopics(userId) {
      const rows = await db
        .select({ domain: concepts.domain, topic: concepts.topic })
        .from(concepts)
        .where(and(eq(concepts.userId, userId), sql`${concepts.domain} is not null`));
      const map: Record<string, string[]> = {};
      for (const row of rows) {
        const domain = row.domain;
        if (!domain) continue;
        if (!map[domain]) map[domain] = [];
        if (row.topic && !map[domain].includes(row.topic)) map[domain].push(row.topic);
      }
      return map;
    },

    async getRecentCorrections(userId, limit) {
      const rows = await db
        .select({
          target_type: correctionsTable.targetType,
          field: correctionsTable.field,
          old_value: correctionsTable.oldValue,
          new_value: correctionsTable.newValue,
        })
        .from(correctionsTable)
        .where(eq(correctionsTable.userId, userId))
        .orderBy(desc(correctionsTable.createdAt))
        .limit(limit);
      return rows as CorrectionRow[];
    },

    async updateNote(noteId, patch) {
      // patch 用 snake_case（Note 形态），映射到 Drizzle 列名
      const set: Partial<typeof notes.$inferInsert> = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.summary !== undefined) set.summary = patch.summary;
      if (patch.raw_content !== undefined) set.rawContent = patch.raw_content;
      if (Object.keys(set).length === 0) return;
      await db.update(notes).set(set).where(eq(notes.id, noteId));
    },

    async insertConcept(userId, concept) {
      const [row] = await db
        .insert(concepts)
        .values({
          userId,
          name: concept.name,
          summary: concept.summary,
          domain: concept.domain,
          topic: concept.topic,
        })
        .returning({ id: concepts.id });
      return row.id;
    },

    async setConceptEmbedding(conceptId, embedding) {
      // customType 的 toDriver 会把 number[] 序列化为 '[...]'，直接传数组即可
      await db
        .update(concepts)
        .set({ embedding })
        .where(eq(concepts.id, conceptId));
    },

    async linkNoteConcept(noteId, conceptId) {
      await db
        .insert(noteConcepts)
        .values({ noteId, conceptId })
        .onConflictDoNothing();
    },

    async insertCards(conceptId, cardList: NewCard[], fsrsState) {
      if (cardList.length === 0) return;
      await db.insert(cards).values(
        cardList.map((c) => ({
          conceptId,
          question: c.question,
          answer: c.answer,
          fsrsState,
        }))
      );
    },

    async ensureTags(userId, noteId, tagNames) {
      const names = Array.from(new Set(tagNames.map((t) => t.trim()).filter(Boolean)));
      if (names.length === 0) return;
      // upsert 标签（user_id+name 唯一），onConflictDoUpdate 以便 returning 拿到全部 id
      const tagRows = await db
        .insert(tags)
        .values(names.map((name) => ({ userId, name })))
        .onConflictDoUpdate({
          target: [tags.userId, tags.name],
          set: { name: sql`excluded.name` },
        })
        .returning({ id: tags.id });
      if (tagRows.length === 0) return;
      await db
        .insert(noteTags)
        .values(tagRows.map((t) => ({ noteId, tagId: t.id })))
        .onConflictDoNothing();
    },

    async matchConcepts(userId, embedding, threshold, limit, excludeIds) {
      // pgvector cosine：相似度 = 1 - (embedding <=> vec)，升序取最近 topK
      // 沿用原 match_concepts 语义：过滤 user_id + embedding 非空 + 排除 + 相似度阈值，
      // 并取来源记录简述（url / 原文前 40 字）供 P3 的 old_source。
      const vec = toVectorLiteral(embedding);
      // 排除本次新建概念：excludeIds 为空时退化为恒真，避免 any('{}') 边角问题。
      // 用 sql.param 把整个数组作为单个参数绑定（$n::uuid[]）；直接内插数组会被展开成 ($a,$b)
      // 行构造器，无法 cast 成 uuid[]，故必须 sql.param。
      const excludeClause =
        excludeIds.length > 0
          ? sql`not (c.id = any(${sql.param(excludeIds)}::uuid[]))`
          : sql`true`;
      const rows = await db.execute<MatchRow>(sql`
        select
          c.id,
          c.name,
          c.summary,
          c.created_at,
          1 - (c.embedding <=> ${vec}::vector) as similarity,
          (
            select coalesce(n.url, nullif(left(coalesce(n.raw_content, n.transcript, ''), 40), ''))
            from note_concepts nc
            join notes n on n.id = nc.note_id
            where nc.concept_id = c.id
            order by n.created_at asc
            limit 1
          ) as source
        from concepts c
        where c.user_id = ${userId}
          and c.embedding is not null
          and ${excludeClause}
          and 1 - (c.embedding <=> ${vec}::vector) > ${threshold}
        order by c.embedding <=> ${vec}::vector asc
        limit ${limit}
      `);
      // postgres.js 的 RowList 即数组，逐行规整为 MatchedConcept（created_at→ISO 字符串）。
      return (rows as unknown as MatchRow[]).map((r) => ({
        id: r.id,
        name: r.name,
        summary: r.summary,
        created_at:
          r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        similarity: Number(r.similarity),
        source: r.source,
      }));
    },

    async insertConceptLink(conceptA, conceptB, relationType, reason) {
      await db
        .insert(conceptLinks)
        .values({ conceptA, conceptB, relationType, reason })
        .onConflictDoNothing();
    },

    async saveDailyDigest(userId, period, contentMd) {
      await db
        .insert(digests)
        .values({ userId, type: 'daily', period, contentMd })
        .onConflictDoUpdate({
          target: [digests.userId, digests.type, digests.period],
          set: { contentMd },
        });
    },
  };
}

/** Drizzle 行（camelCase）→ 应用层 Note（snake_case） */
function rowToNote(row: typeof notes.$inferSelect): Note {
  return {
    id: row.id,
    user_id: row.userId,
    type: row.type as Note['type'],
    raw_content: row.rawContent,
    transcript: row.transcript,
    url: row.url,
    media_path: row.mediaPath,
    why_important: row.whyImportant,
    status: row.status as Note['status'],
    summary: row.summary,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}
