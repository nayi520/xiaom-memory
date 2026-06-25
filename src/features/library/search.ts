/**
 * 知识库搜索（F4.2 + V8 混合检索升级）—— 去 Supabase 改造（Drizzle 数据访问）
 *
 * 单一搜索框，多路并行后融合排序：
 * 1. 关键词：ILIKE 多字段匹配（notes.raw_content/summary/why_important、
 *    concepts.name/summary）。无中文分词，MVP 用此退化方案，pg_trgm 索引提速。
 * 2. 标签：tags.name 精确匹配 → 关联 notes。
 * 3. 语义：query 算 embedding → 对 concepts.embedding 的 pgvector cosine 查询。
 *    未配置 DASHSCOPE_API_KEY 时优雅降级，只跑关键词与标签。
 *
 * V8 升级（向后兼容）：
 *   - 第三参数可继续传字符串 q（旧调用零改动），也可传 { q, domain?, mode? } 选项对象。
 *   - domain：仅返回该领域下的概念，以及「关联概念落在该领域」的记录（按 note_concepts→concepts.domain）。
 *   - mode：'hybrid'（默认，关键词+标签+语义全跑）/ 'keyword'（仅关键词+标签）/ 'semantic'（仅语义）。
 *
 * 授权改应用层：concepts/notes/tags 各路均显式按 user_id 过滤（原靠 RLS）。
 * 结果合并去重（mergeHits 为纯函数，scripts/test-search.ts 覆盖），
 * 每条标注命中来源（关键词 / 标签 / 语义）。
 */

import { and, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { concepts, noteConcepts, noteTags, notes, tags } from '@/lib/db/schema';
import { embed, EmbeddingKeyMissingError } from '@/lib/embeddings';
import { MEETING_MIN_CHARS } from '@/lib/constants';

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
  /** V30：记录是否为会议（长语音，由 SQL 判定）；概念命中恒为 undefined。前端据此显示「会议」徽标。 */
  isMeeting?: boolean;
}

/** 合并后的最终命中 */
export interface SearchHit extends RawHit {
  sources: HitSource[];
}

export interface LibrarySearchResult {
  hits: SearchHit[];
  /** 本次是否跑了语义检索（未配 DASHSCOPE_API_KEY / mode=keyword 时为 false） */
  semanticUsed: boolean;
}

/** 检索模式：混合（默认）/ 仅关键词+标签 / 仅语义 */
export type SearchMode = 'hybrid' | 'keyword' | 'semantic';

export const SEARCH_MODES: SearchMode[] = ['hybrid', 'keyword', 'semantic'];

export function normalizeMode(raw: string | null | undefined): SearchMode {
  return raw === 'keyword' || raw === 'semantic' ? raw : 'hybrid';
}

/** V8 检索选项（向后兼容：旧调用直接传字符串 q）。 */
export interface LibrarySearchOptions {
  q: string;
  /** 领域筛选（仅返回该领域概念 + 关联到该领域的记录）。 */
  domain?: string | null;
  /** 检索模式，默认 'hybrid'。 */
  mode?: SearchMode;
  /**
   * V15 标签筛选：仅返回挂了该标签的记录，以及「关联记录挂了该标签」的概念。
   * 与既有 domain 筛选可叠加（同时满足）。tag 为空则不限制。
   */
  tag?: string | null;
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

// ============ 命中词高亮（纯函数；实现见 ./highlight，无服务端依赖，便于客户端组件复用） ============
// 从纯模块 re-export：旧引用（含 scripts/test-search.ts）与 /api 调用零改动，
// 同时让 CommandPalette 等客户端组件能只引 ./highlight，不把 db/drizzle 拖进浏览器包。
export { tokenizeQuery, splitByTerms, type HighlightSegment } from './highlight';

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
  /** 该记录是否为会议（语音且转写字数达阈值），由 SQL 算出。 */
  is_meeting?: boolean;
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
    isMeeting: row.is_meeting === true,
  };
}

// ============ 检索常量 ============

/** 语义检索相似度阈值（搜索召回比关联发现的 0.82 宽松得多） */
export const SEMANTIC_THRESHOLD = 0.35;
export const SEMANTIC_LIMIT = 8;
export const KEYWORD_LIMIT = 20;

// ============ 服务端执行 ============

/** concepts 查询投影（→ ConceptRow，created_at 由 Date 折算 ISO） */
const conceptCols = {
  id: concepts.id,
  name: concepts.name,
  summary: concepts.summary,
  created_at: concepts.createdAt,
};

/** notes 查询投影（→ NoteRow）。is_meeting 由 SQL 算出（语音且转写字数达阈值），驱动「会议」徽标。 */
const noteCols = {
  id: notes.id,
  raw_content: notes.rawContent,
  transcript: notes.transcript,
  summary: notes.summary,
  why_important: notes.whyImportant,
  url: notes.url,
  created_at: notes.createdAt,
  is_meeting: sql<boolean>`(${notes.type} = 'voice' and char_length(coalesce(trim(${notes.transcript}), '')) >= ${MEETING_MIN_CHARS})`,
};

/** Date → ISO 字符串（投影出来的 created_at 是 Date，RawHit/排序需要字符串） */
function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function runLibrarySearch(
  db: Database,
  userId: string,
  input: string | LibrarySearchOptions
): Promise<LibrarySearchResult> {
  // 向后兼容：第三参数可为字符串 q，或 { q, domain?, mode? } 选项对象。
  const opts: LibrarySearchOptions =
    typeof input === 'string' ? { q: input } : input;
  const query = opts.q.trim();
  if (!query) return { hits: [], semanticUsed: false };
  const domain = opts.domain?.trim() || null;
  const tag = opts.tag?.trim() || null;
  const mode = opts.mode ?? 'hybrid';
  const runKeyword = mode === 'hybrid' || mode === 'keyword';
  const runSemantic = mode === 'hybrid' || mode === 'semantic';
  const pattern = `%${escapeIlike(query)}%`;

  // domain 过滤：先取该领域下的本人概念 id 集合（用于过滤关键词/语义的概念命中），
  // 以及该领域概念关联的记录 id 集合（用于过滤记录命中）。domain 为空则不限制。
  const domainConceptIds = new Set<string>();
  const domainNoteIds = new Set<string>();
  if (domain) {
    const dConcepts = await db
      .select({ id: concepts.id })
      .from(concepts)
      .where(and(eq(concepts.userId, userId), eq(concepts.domain, domain)));
    for (const c of dConcepts) domainConceptIds.add(c.id);
    if (domainConceptIds.size > 0) {
      const dNotes = await db
        .select({ note_id: noteConcepts.noteId })
        .from(noteConcepts)
        .where(inArray(noteConcepts.conceptId, Array.from(domainConceptIds)));
      for (const n of dNotes) domainNoteIds.add(n.note_id);
    }
  }

  // V15 tag 过滤：取挂该标签的本人记录 id 集合，以及这些记录关联到的概念 id 集合。
  // 标签按本人 tags.name 精确匹配（与关键词路的标签命中同口径）。tag 为空则不限制。
  const tagNoteIds = new Set<string>();
  const tagConceptIds = new Set<string>();
  if (tag) {
    const tagRows = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, userId), eq(tags.name, tag)))
      .limit(1);
    const tagId = tagRows[0]?.id;
    if (tagId) {
      const tNotes = await db
        .select({ note_id: noteTags.noteId })
        .from(noteTags)
        .innerJoin(notes, eq(notes.id, noteTags.noteId))
        .where(and(eq(noteTags.tagId, tagId), eq(notes.userId, userId), isNull(notes.deletedAt)));
      for (const n of tNotes) tagNoteIds.add(n.note_id);
      if (tagNoteIds.size > 0) {
        const tConcepts = await db
          .select({ concept_id: noteConcepts.conceptId })
          .from(noteConcepts)
          .where(inArray(noteConcepts.noteId, Array.from(tagNoteIds)));
        for (const c of tConcepts) tagConceptIds.add(c.concept_id);
      }
    }
  }

  // 概念/记录是否保留：domain 与 tag 两个筛选叠加（均不设则全放行）。
  const keepConcept = (id: string) =>
    (!domain || domainConceptIds.has(id)) && (!tag || tagConceptIds.has(id));
  const keepNote = (id: string) =>
    (!domain || domainNoteIds.has(id)) && (!tag || tagNoteIds.has(id));

  const toConcept = (r: { id: string; name: string; summary: string | null; created_at: Date | string }) =>
    conceptToHit({ id: r.id, name: r.name, summary: r.summary, created_at: iso(r.created_at) });
  const toNote = (r: {
    id: string; raw_content: string | null; transcript: string | null;
    summary: string | null; why_important: string | null; url: string | null; created_at: Date | string;
    is_meeting?: boolean;
  }) => noteToHit({ ...r, created_at: iso(r.created_at) });

  // ---- 关键词（ILIKE 多字段） + 标签精确匹配，并行（mode=semantic 时跳过） ----
  // concepts/notes/tags 均显式按 user_id 过滤（原靠 RLS）；
  // notes 各路排除软删记录（deleted_at is null），回收站内容不进搜索结果。
  let keywordHits: RawHit[] = [];
  let tagHits: RawHit[] = [];
  if (runKeyword) {
    // V15：记录正文全文检索补齐 transcript（语音转写正文），与 raw_content/summary/why_important 并列。
    const [cName, cSummary, nRaw, nTranscript, nSummary, nWhy, tagRes] = await Promise.all([
      db.select(conceptCols).from(concepts)
        .where(and(eq(concepts.userId, userId), ilike(concepts.name, pattern)))
        .limit(KEYWORD_LIMIT),
      db.select(conceptCols).from(concepts)
        .where(and(eq(concepts.userId, userId), ilike(concepts.summary, pattern)))
        .limit(KEYWORD_LIMIT),
      db.select(noteCols).from(notes)
        .where(and(eq(notes.userId, userId), isNull(notes.deletedAt), ilike(notes.rawContent, pattern)))
        .limit(KEYWORD_LIMIT),
      db.select(noteCols).from(notes)
        .where(and(eq(notes.userId, userId), isNull(notes.deletedAt), ilike(notes.transcript, pattern)))
        .limit(KEYWORD_LIMIT),
      db.select(noteCols).from(notes)
        .where(and(eq(notes.userId, userId), isNull(notes.deletedAt), ilike(notes.summary, pattern)))
        .limit(KEYWORD_LIMIT),
      db.select(noteCols).from(notes)
        .where(and(eq(notes.userId, userId), isNull(notes.deletedAt), ilike(notes.whyImportant, pattern)))
        .limit(KEYWORD_LIMIT),
      db.select({ id: tags.id }).from(tags)
        .where(and(eq(tags.userId, userId), eq(tags.name, query)))
        .limit(1),
    ]);

    keywordHits = [
      ...cName.filter((r) => keepConcept(r.id)).map(toConcept),
      ...cSummary.filter((r) => keepConcept(r.id)).map(toConcept),
      ...nRaw.filter((r) => keepNote(r.id)).map(toNote),
      ...nTranscript.filter((r) => keepNote(r.id)).map(toNote),
      ...nSummary.filter((r) => keepNote(r.id)).map(toNote),
      ...nWhy.filter((r) => keepNote(r.id)).map(toNote),
    ];

    // 标签命中的记录（join notes + deleted_at is null：排除软删记录）
    const tagId = tagRes[0]?.id;
    if (tagId) {
      const rows = await db
        .select(noteCols)
        .from(noteTags)
        .innerJoin(notes, eq(notes.id, noteTags.noteId))
        .where(and(eq(noteTags.tagId, tagId), eq(notes.userId, userId), isNull(notes.deletedAt)));
      tagHits = rows.filter((r) => keepNote(r.id)).map(toNote);
    }
  }

  // ---- 语义（无 DASHSCOPE_API_KEY 时优雅降级；mode=keyword 时跳过） ----
  let semanticHits: RawHit[] = [];
  let semanticUsed = false;
  if (runSemantic) {
    try {
      const vector = await embed(query);
      const rows = await semanticSearch(db, userId, vector);
      semanticHits = rows.filter((r) => keepConcept(r.id));
      semanticUsed = true;
    } catch (err) {
      if (!(err instanceof EmbeddingKeyMissingError)) {
        // 语义检索故障不阻塞关键词结果，只记日志
        console.error('[library] 语义检索失败：', err instanceof Error ? err.message : err);
      }
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

/** 语义命中：对 concepts.embedding 的 pgvector 余弦查询（阈值 SEMANTIC_THRESHOLD，topK = SEMANTIC_LIMIT） */
async function semanticSearch(
  db: Database,
  userId: string,
  vector: number[]
): Promise<RawHit[]> {
  const vec = `[${vector.join(',')}]`;
  type Row = {
    id: string;
    name: string;
    summary: string | null;
    created_at: Date | string;
    similarity: number | string;
    [key: string]: unknown;
  };
  const rows = await db.execute<Row>(sql`
    select
      c.id,
      c.name,
      c.summary,
      c.created_at,
      1 - (c.embedding <=> ${vec}::vector) as similarity
    from concepts c
    where c.user_id = ${userId}
      and c.embedding is not null
      and 1 - (c.embedding <=> ${vec}::vector) > ${SEMANTIC_THRESHOLD}
    order by c.embedding <=> ${vec}::vector asc
    limit ${SEMANTIC_LIMIT}
  `);
  return (rows as unknown as Row[]).map((r) =>
    conceptToHit(
      { id: r.id, name: r.name, summary: r.summary, created_at: iso(r.created_at) },
      Number(r.similarity)
    )
  );
}
