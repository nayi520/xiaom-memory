/**
 * RAG 检索（P6 问答的"召回"环节）
 *
 * 在当前 userId 的 concepts 上做 pgvector 余弦近邻召回 top-K，并带上每个概念关联记录的
 * 摘要片段，供 P6 拼接检索上下文。**严格按 user_id 过滤**（与 library/search、digest/store 同口径）：
 *   - 余弦相似度 = 1 - (embedding <=> $vec::vector)，升序取最近 topK
 *   - 只取有 embedding 的概念；阈值比关联发现宽松（问答需要尽量召回，再交给 LLM 判断是否够答）
 *   - 每个概念附一条关联记录摘要（优先 note.summary，回退原文/转写前若干字；排除软删记录）
 *
 * 数据访问与 features/library/search.ts 一致直接走 Drizzle sql``，不改动 db 底层封装。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

// ============ 常量 ============

/** 问答召回 top-K（任务要求 6~8） */
export const ASK_TOP_K = 8;
/**
 * 召回相似度下限（cosine）。问答比关联发现（0.82）宽松得多，
 * 与库搜索语义阈值（0.35）同量级，尽量多召回、由 P6 决定够不够答。
 */
export const ASK_SIMILARITY_THRESHOLD = 0.3;
/** 单概念附带的关联记录摘要最大字数 */
export const SNIPPET_MAX = 160;

// ============ 类型 ============

export interface RetrievedConcept {
  conceptId: string;
  title: string;
  /** 概念解释（concepts.summary） */
  summary: string | null;
  /** 关联记录的一句摘要（note.summary 优先，回退原文/转写截断），可能为空 */
  noteSnippet: string | null;
  similarity: number;
}

/** sql 行（含索引签名以满足 db.execute<TRow extends Record<string, unknown>>） */
type RetrievalRow = {
  id: string;
  name: string;
  summary: string | null;
  note_snippet: string | null;
  similarity: number | string;
  [key: string]: unknown;
};

// ============ 召回 ============

/** vector(1536) 的 pgvector 文本表示：'[a,b,c]'（与 store.ts 一致） */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * 在 userId 的概念上做 pgvector 余弦召回 top-K。
 * @param queryEmbedding 问题文本的 embedding（调用方先 embed(question)）
 * 返回按相似度降序的概念列表（已带关联记录摘要）。
 */
export async function retrieveConcepts(
  db: Database,
  userId: string,
  queryEmbedding: number[],
  topK: number = ASK_TOP_K,
  threshold: number = ASK_SIMILARITY_THRESHOLD
): Promise<RetrievedConcept[]> {
  const vec = toVectorLiteral(queryEmbedding);
  const rows = await db.execute<RetrievalRow>(sql`
    select
      c.id,
      c.name,
      c.summary,
      1 - (c.embedding <=> ${vec}::vector) as similarity,
      (
        select left(
          coalesce(n.summary, n.raw_content, n.transcript, ''),
          ${SNIPPET_MAX}
        )
        from note_concepts nc
        join notes n on n.id = nc.note_id
        where nc.concept_id = c.id
          and n.deleted_at is null
        order by n.created_at desc
        limit 1
      ) as note_snippet
    from concepts c
    where c.user_id = ${userId}
      and c.embedding is not null
      and 1 - (c.embedding <=> ${vec}::vector) > ${threshold}
    order by c.embedding <=> ${vec}::vector asc
    limit ${topK}
  `);
  return (rows as unknown as RetrievalRow[]).map((r) => ({
    conceptId: r.id,
    title: r.name,
    summary: r.summary,
    noteSnippet: cleanSnippet(r.note_snippet),
    similarity: Number(r.similarity),
  }));
}

/** 规整摘要片段：压空白、去空串 */
function cleanSnippet(text: string | null): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}
