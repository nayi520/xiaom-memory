-- 小M Memory · 初始数据模型（PRD 5.2）
-- users 由 Supabase Auth (auth.users) 提供，业务侧用 profiles 扩展

-- ============ 扩展 ============
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ============ profiles ============
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 注册时自动建 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ notes：原始记录，一切的源头 ============
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('text', 'voice', 'link', 'image')),
  raw_content text,
  transcript text,
  url text,
  media_path text,
  why_important text,
  status text not null default 'inbox' check (status in ('inbox', 'processed', 'archived')),
  created_at timestamptz not null default now()
);

create index notes_user_status_idx on public.notes (user_id, status, created_at desc);

-- ============ concepts：知识原子，AI 从 notes 提炼 ============
create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  summary text,
  domain text,
  topic text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index concepts_user_idx on public.concepts (user_id, created_at desc);

-- ============ note_concepts：多对多 ============
create table public.note_concepts (
  note_id uuid not null references public.notes (id) on delete cascade,
  concept_id uuid not null references public.concepts (id) on delete cascade,
  primary key (note_id, concept_id)
);

-- ============ concept_links：AI 发现的关联 ============
create table public.concept_links (
  concept_a uuid not null references public.concepts (id) on delete cascade,
  concept_b uuid not null references public.concepts (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (concept_a, concept_b)
);

-- ============ cards：复习卡片 ============
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.concepts (id) on delete cascade,
  question text not null,
  answer text not null,
  fsrs_state jsonb not null default '{}'::jsonb, -- stability, difficulty, due_date, reps...
  status text not null default 'active' check (status in ('active', 'graduated', 'suspended')),
  created_at timestamptz not null default now()
);

create index cards_concept_idx on public.cards (concept_id);

-- ============ reviews：复习日志 ============
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  rating int not null check (rating between 1 and 4),
  reviewed_at timestamptz not null default now()
);

create index reviews_card_idx on public.reviews (card_id, reviewed_at desc);

-- ============ tags / note_tags ============
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  unique (user_id, name)
);

create table public.note_tags (
  note_id uuid not null references public.notes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (note_id, tag_id)
);

-- ============ digests：日报/周报 ============
create table public.digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('daily', 'weekly')),
  content_md text not null,
  period text not null, -- 如 '2026-06-10' 或 '2026-W24'
  created_at timestamptz not null default now()
);

create index digests_user_idx on public.digests (user_id, type, period);

-- ============ corrections：用户对 AI 结果的修正记录 ============
create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('note', 'concept', 'card', 'tag')),
  target_id uuid not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index corrections_user_idx on public.corrections (user_id, created_at desc);

-- ============ RLS：所有表按 user_id 隔离 ============
alter table public.profiles enable row level security;
alter table public.notes enable row level security;
alter table public.concepts enable row level security;
alter table public.note_concepts enable row level security;
alter table public.concept_links enable row level security;
alter table public.cards enable row level security;
alter table public.reviews enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;
alter table public.digests enable row level security;
alter table public.corrections enable row level security;

-- profiles
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- notes
create policy "notes_all_own" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- concepts
create policy "concepts_all_own" on public.concepts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- note_concepts：通过 note 归属判断
create policy "note_concepts_all_own" on public.note_concepts
  for all using (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- concept_links：通过 concept 归属判断
create policy "concept_links_all_own" on public.concept_links
  for all using (
    exists (select 1 from public.concepts c where c.id = concept_a and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.concepts c where c.id = concept_a and c.user_id = auth.uid())
    and exists (select 1 from public.concepts c where c.id = concept_b and c.user_id = auth.uid())
  );

-- cards：通过 concept 归属判断
create policy "cards_all_own" on public.cards
  for all using (
    exists (select 1 from public.concepts c where c.id = concept_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.concepts c where c.id = concept_id and c.user_id = auth.uid())
  );

-- reviews：通过 card → concept 归属判断
create policy "reviews_all_own" on public.reviews
  for all using (
    exists (
      select 1 from public.cards cd
      join public.concepts c on c.id = cd.concept_id
      where cd.id = card_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.cards cd
      join public.concepts c on c.id = cd.concept_id
      where cd.id = card_id and c.user_id = auth.uid()
    )
  );

-- tags
create policy "tags_all_own" on public.tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- note_tags：通过 note 归属判断
create policy "note_tags_all_own" on public.note_tags
  for all using (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- digests
create policy "digests_all_own" on public.digests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- corrections
create policy "corrections_all_own" on public.corrections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ Storage：audio bucket（私有，按用户目录隔离） ============
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

create policy "audio_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "audio_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "audio_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
