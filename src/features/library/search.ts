/**
 * 知识库搜索（F4.2）
 *
 * 单一搜索框，三路并行：
 * 1. 关键词：ILIKE 多字段匹配（notes.raw_content/summary/why_important、
 *    concepts.name/summary）。本地 Supabase 无 pg_jieba/zhparser 中文分词，
 *    MVP 用此退化方案，0004 migration 已加 pg_trgm 索引提速。
 * 2. 标签：tags.name 精确匹配 → 关联 notes。
 * 3. 语义：query 算 embedding → match_concepts RPC（pgvector cosine）。
 *    未配置 OPENAI_API_KEY 时优雅降级，只跑关键词与标签。
 *
 * 结果合并去重（mergeHits 为纯函数，scripts/test-search.ts 覆盖），
 * 每条标注命中来源（关键词 / 标签 / 语义）。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { embed, EmbeddingKeyMissingError } from '@/lib/embeddings';

// ============ 类型 ============

export type HitSource = 'keyword' | 'tag' | 'semantic';

export const HIT_SOURCE_LABELS: Record<HitSource, string> = {
  keyword: '关键词',
  tag: '标签',
  semantic: '语义',
};

/** 合并前的单路命中（不含来源，来源由所在分组决定） */
export interface RawHit {
  kind: 'concept' | 'note';
  id: string;
  title: string;
  snippet: string;
  /** 语义命中附带相似度 */
  similarity?: number;
  created_at: string;
}

/** 合并后的最终命中 */
export interface SearchHit extends RawHit {
  sources: HitSource[];
}

export interface LibrarySearchResult {
  hits: SearchHit[];
  /** 本次是否跑了语义检索（未配 OPENAI_API_KEY 时为 false） */
  semanticUsed: boolean;
}

// ============ 纯函数：合并去重 ============

/**
 * 多路结果合并去重：
 * - 以 kind+id 去重，命中来源取并集，相似度取最大值，snippet 取首个非空
 * - 排序：命中来源数多者优先 → 语义相似度高者优先 → 时间新者优先
 */
export function mergeHits(
  groups: { source: HitSource; hits: RawHit[] }[]
): SearchHit[] {
  const map = new Map<string, SearchHit>();
  for (const group of groups) {
    for (const hit of group.hits) {
      const key = `${hit.kind}:${hit.id}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.includes(group.source)) {
          existing.sources.push(group.source);
        }
        if (
          hit.similarity !== undefined &&
          (existing.similarity === undefined || hit.similarity > existing.similarity)
        ) {
          existing.similarity = hit.similarity;
        }
        if (!existing.snippet && hit.snippet) existing.snippet = hit.snippet;
      } else {
        map.set(key, { ...hit, sources: [group.source] });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.sources.length !== a.sources.length) {
      return b.sources.length - a.sources.length;
    }
    const sa = a.similarity ?? -1;
    const sb = b.similarity ?? -1;
    if (sb !== sa) return sb - sa;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** ILIKE 模式转义（%、_、\ 是通配符） */
export function escapeIlike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function excerpt(text: string | null | undefined, max = 80): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ============ 数据形态 → RawHit ============

interface ConceptRow {
  id: string;
  name: string;
  summary: string | null;
  created_at: string;
}

interface NoteRow {
  id: string;
  raw_content: string | null;
  transcript: string | null;
  summary: string | null;
  why_important: string | null;
  url: string | null;
  created_at: string;
}

function conceptToHit(row: ConceptRow, similarity?: number): RawHit {
  return {
    kind: 'concept',
    id: row.id,
    title: row.name,
    snippet: excerpt(row.summary),
    similarity,
    created_at: row.created_at,
  };
}

function noteToHit(row: NoteRow): RawHit {
  const body = row.summary || row.raw_content || row.transcript || row.url || '';
  return {
    kind: 'note',
    id: row.id,
    title: excerpt(body, 60) || '（无文字内容）',
    snippet: excerpt(row.why_important ? `💡 ${row.why_important}` : ''),
    created_at: row.created_at,
  };
}

// ============ 检索常量 ============

/** 语义检索相似度阈值（搜索召回比关联发现的 0.82 宽松得多） */
export const SEMANTIC_THRESHOLD = 0.35;
export const SEMANTIC_LIMIT = 8;
export const KEYWORD_LIMIT = 20;

// ============ 服务端执行 ============

const CONCEPT_COLS = 'id, name, summary, created_at';
const NOTE_COLS =
  'id, raw_content, transcript, summary, why_important, url, created_at';

export async function runLibrarySearch(
  supabase: SupabaseClient,
  userId: string,
  q: string
): Promise<LibrarySearchResult> {
  const query = q.trim();
  if (!query) return { hits: [], semanticUsed: false };
  const pattern = `%${escapeIlike(query)}%`;

  // ---- 关键词（ILIKE 多字段） + 标签精确匹配，并行 ----
  const [cName, cSummary, nRaw, nSummary, nWhy, tagRes] = await Promise.all([
    supabase.from('concepts').select(CONCEPT_COLS).ilike('name', pattern).limit(KEYWORD_LIMIT),
    supabase.from('concepts').select(CONCEPT_COLS).ilike('summary', pattern).limit(KEYWORD_LIMIT),
    supabase.from('notes').select(NOTE_COLS).ilike('raw_content', pattern).limit(KEYWORD_LIMIT),
    supabase.from('notes').select(NOTE_COLS).ilike('summary', pattern).limit(KEYWORD_LIMIT),
    supabase.from('notes').select(NOTE_COLS).ilike('why_important', pattern).limit(KEYWORD_LIMIT),
    supabase.from('tags').select('id').eq('name', query).maybeSingle(),
  ]);

  const keywordHits: RawHit[] = [
    ...((cName.data ?? []) as ConceptRow[]).map((r) => conceptToHit(r)),
    ...((cSummary.data ?? []) as ConceptRow[]).map((r) => conceptToHit(r)),
    ...((nRaw.data ?? []) as NoteRow[]).map(noteToHit),
    ...((nSummary.data ?? []) as NoteRow[]).map(noteToHit),
    ...((nWhy.data ?? []) as NoteRow[]).map(noteToHit),
  ];

  // ---- 标签命中的记录 ----
  let tagHits: RawHit[] = [];
  if (tagRes.data?.id) {
    const { data } = await supabase
      .from('note_tags')
      .select(`note:notes(${NOTE_COLS})`)
      .eq('tag_id', tagRes.data.id);
    tagHits = ((data ?? []) as unknown as { note: NoteRow | null }[])
      .map((r) => r.note)
      .filter((n): n is NoteRow => n !== null)
      .map(noteToHit);
  }

  // ---- 语义（无 OPENAI_API_KEY 时优雅降级） ----
  let semanticHits: RawHit[] = [];
  let semanticUsed = false;
  try {
    const vector = await embed(query);
    const { data, error } = await supabase.rpc('match_concepts', {
      p_user_id: userId,
      p_embedding: JSON.stringify(vector),
      p_threshold: SEMANTIC_THRESHOLD,
      p_limit: SEMANTIC_LIMIT,
      p_exclude: [],
    });
    if (error) throw new Error(`match_concepts 失败：${error.message}`);
    semanticUsed = true;
    semanticHits = (
      (data ?? []) as { id: string; name: string; summary: string | null; created_at: string; similarity: number }[]
    ).map((r) =>
      conceptToHit(
        { id: r.id, name: r.name, summary: r.summary, created_at: r.created_at },
        r.similarity
      )
    );
  } catch (err) {
    if (!(err instanceof EmbeddingKeyMissingError)) {
      // 语义检索故障不阻塞关键词结果，只记日志
      console.error('[library] 语义检索失败：', err instanceof Error ? err.message : err);
    }
  }

  return {
    hits: mergeHits([
      { source: 'keyword', hits: keywordHits },
      { source: 'tag', hits: tagHits },
      { source: 'semantic', hits: semanticHits },
    ]),
    semanticUsed,
  };
}
