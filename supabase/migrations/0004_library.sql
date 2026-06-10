-- 小M Memory · 阶段 4：知识库（F4.1 浏览 / F4.2 搜索）
-- 本文件幂等，可重复执行
--
-- 全文检索说明：本地 Supabase 默认镜像无 pg_jieba / zhparser 中文分词，
-- 搜索采用退化方案：ILIKE 多字段匹配 + 标签精确匹配（应用层实现）。
-- 这里加 pg_trgm GIN 索引为 ILIKE 提速（数据量小时可有可无，建上备用）。

create extension if not exists pg_trgm;

-- notes：raw_content / summary / why_important
create index if not exists notes_raw_content_trgm_idx
  on public.notes using gin (raw_content gin_trgm_ops);
create index if not exists notes_summary_trgm_idx
  on public.notes using gin (summary gin_trgm_ops);
create index if not exists notes_why_important_trgm_idx
  on public.notes using gin (why_important gin_trgm_ops);

-- concepts：name / summary（即概念解释）
create index if not exists concepts_name_trgm_idx
  on public.concepts using gin (name gin_trgm_ops);
create index if not exists concepts_summary_trgm_idx
  on public.concepts using gin (summary gin_trgm_ops);

-- 知识库下钻常用过滤：领域 / 主题
create index if not exists concepts_user_domain_topic_idx
  on public.concepts (user_id, domain, topic);
