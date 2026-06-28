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

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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
import type {
  WeeklyStore,
  WeeklyConceptRow,
  WeeklyLinkRow,
  WeeklyDigestRecord,
  ActionableSuggestions,
} from './weekly';

/** vector(1536) 的 pgvector 文本表示：'[a,b,c]' */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/** 周报「可操作建议」素材的取量上限（避免提示词过长 / 建议太碎）。 */
const ACTIONABLE_DUE_LIMIT = 8;
const ACTIONABLE_DOMAIN_LIMIT = 5;

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

export function createDigestStore(db: Database): DigestStore & WeeklyStore {
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

    async listUserIdsWithInboxUpTo(toIso) {
      // cron 自愈：截至 toIso（不设下限）仍有 inbox 的用户，含往日漏整理。
      const rows = await db
        .selectDistinct({ userId: notes.userId })
        .from(notes)
        .where(
          and(
            eq(notes.status, 'inbox'),
            isNull(notes.deletedAt),
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

    async listAllInboxNotes(userId) {
      // "立即整理"补积压：该用户全部 pending（不设时间下限），仍限定本人 + status=inbox + 排除软删。
      const rows = await db
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.userId, userId),
            eq(notes.status, 'inbox'),
            isNull(notes.deletedAt)
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

    // ============ 周报（WeeklyStore）============

    async listDailyDigestsInRange(userId, fromPeriod, toPeriod) {
      // period 为 'YYYY-MM-DD' 字符串，字典序即时间序，可直接 between。
      const rows = await db
        .select({ period: digests.period, contentMd: digests.contentMd })
        .from(digests)
        .where(
          and(
            eq(digests.userId, userId),
            eq(digests.type, 'daily'),
            gte(digests.period, fromPeriod),
            lte(digests.period, toPeriod)
          )
        )
        .orderBy(asc(digests.period));
      return rows;
    },

    async listConceptsInRange(userId, fromIso, toIso): Promise<WeeklyConceptRow[]> {
      const rows = await db
        .select({
          name: concepts.name,
          domain: concepts.domain,
          topic: concepts.topic,
          explanation: concepts.summary,
        })
        .from(concepts)
        .where(
          and(
            eq(concepts.userId, userId),
            gte(concepts.createdAt, new Date(fromIso)),
            lt(concepts.createdAt, new Date(toIso))
          )
        )
        .orderBy(asc(concepts.createdAt));
      return rows;
    },

    async listLinksInRange(userId, fromIso, toIso): Promise<WeeklyLinkRow[]> {
      // 取本周新建关联，并 join 两端概念名（均限定本人概念，防跨用户泄漏）。
      const ca = alias(concepts, 'ca');
      const cb = alias(concepts, 'cb');
      const rows = await db
        .select({
          from: ca.name,
          to: cb.name,
          relationType: conceptLinks.relationType,
          reason: conceptLinks.reason,
        })
        .from(conceptLinks)
        .innerJoin(ca, eq(ca.id, conceptLinks.conceptA))
        .innerJoin(cb, eq(cb.id, conceptLinks.conceptB))
        .where(
          and(
            eq(ca.userId, userId),
            eq(cb.userId, userId),
            gte(conceptLinks.createdAt, new Date(fromIso)),
            lt(conceptLinks.createdAt, new Date(toIso))
          )
        )
        .orderBy(asc(conceptLinks.createdAt));
      return rows;
    },

    async saveWeeklyDigest(userId, period, contentMd) {
      await db
        .insert(digests)
        .values({ userId, type: 'weekly', period, contentMd })
        .onConflictDoUpdate({
          target: [digests.userId, digests.type, digests.period],
          set: { contentMd },
        });
    },

    async getLatestWeeklyDigest(userId): Promise<WeeklyDigestRecord | null> {
      const rows = await db
        .select({ period: digests.period, content: digests.contentMd })
        .from(digests)
        .where(and(eq(digests.userId, userId), eq(digests.type, 'weekly')))
        .orderBy(desc(digests.period))
        .limit(1);
      return rows[0] ?? null;
    },

    async getActionableSuggestions(userId, nowIso): Promise<ActionableSuggestions> {
      // —— dueConcepts：有到期 active 卡的概念，按最早到期升序、去重限量（与 /api/recommend 同口径）——
      const dueRows = await db
        .select({
          name: concepts.name,
          nextDue: sql<string>`min(${cards.fsrsState}->>'due')`,
        })
        .from(cards)
        .innerJoin(concepts, eq(concepts.id, cards.conceptId))
        .where(
          and(
            eq(concepts.userId, userId),
            eq(cards.status, 'active'),
            sql`${cards.fsrsState}->>'due' <= ${nowIso}`
          )
        )
        .groupBy(concepts.id, concepts.name)
        .orderBy(sql`min(${cards.fsrsState}->>'due') asc`)
        .limit(ACTIONABLE_DUE_LIMIT);
      const dueConcepts = dueRows.map((r) => r.name).filter(Boolean);

      // —— domainsWithoutCards：有概念、但其下概念都还没有任何卡片的领域 ——
      // 取本人每个（非空）领域：概念总数 与「有卡片的概念」数；后者为 0 即该领域无卡。
      const domainRows = await db
        .select({
          domain: concepts.domain,
          conceptCount: sql<number>`count(distinct ${concepts.id})`,
          withCardCount: sql<number>`count(distinct ${cards.conceptId})`,
        })
        .from(concepts)
        .leftJoin(cards, eq(cards.conceptId, concepts.id))
        .where(and(eq(concepts.userId, userId), sql`${concepts.domain} is not null`))
        .groupBy(concepts.domain);
      const domainsWithoutCards = domainRows
        .filter((r) => Number(r.conceptCount) > 0 && Number(r.withCardCount) === 0)
        .map((r) => (r.domain ?? '').trim())
        .filter(Boolean)
        .slice(0, ACTIONABLE_DOMAIN_LIMIT);

      return { dueConcepts, domainsWithoutCards };
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
