-- 小M Memory · 阶段 2：AI 每日整理流水线
-- 本文件幂等，可重复执行

-- ============ notes：status 增加 needs_review；增加 AI 摘要列 ============
alter table public.notes drop constraint if exists notes_status_check;
alter table public.notes add constraint notes_status_check
  check (status in ('inbox', 'processed', 'needs_review', 'archived'));

alter table public.notes add column if not exists summary text;

-- ============ concept_links：增加关系类型（P3 输出 relation_type） ============
alter table public.concept_links add column if not exists relation_type text;

-- ============ digests：支持按 (user, type, period) 幂等 upsert ============
create unique index if not exists digests_user_type_period_key
  on public.digests (user_id, type, period);

-- ============ 向量索引（cosine）。数据量小时是顺序扫描也可，建上备用 ============
create index if not exists concepts_embedding_idx
  on public.concepts using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============ match_concepts：cosine 相似度检索历史概念 ============
-- 返回相似度 > p_threshold 的概念，附带其来源记录的简述（供 P3 的 old_source 用）
create or replace function public.match_concepts(
  p_user_id uuid,
  p_embedding vector(1536),
  p_threshold float default 0.82,
  p_limit int default 5,
  p_exclude uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  name text,
  summary text,
  created_at timestamptz,
  similarity float,
  source text
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.summary,
    c.created_at,
    1 - (c.embedding <=> p_embedding) as similarity,
    (
      select coalesce(n.url, nullif(left(coalesce(n.raw_content, n.transcript, ''), 40), ''))
      from public.note_concepts nc
      join public.notes n on n.id = nc.note_id
      where nc.concept_id = c.id
      order by n.created_at asc
      limit 1
    ) as source
  from public.concepts c
  where c.user_id = p_user_id
    and c.embedding is not null
    and not (c.id = any(p_exclude))
    and 1 - (c.embedding <=> p_embedding) > p_threshold
  order by c.embedding <=> p_embedding asc
  limit p_limit;
$$;
