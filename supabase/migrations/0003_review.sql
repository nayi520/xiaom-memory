-- 小M Memory · 阶段 3：FSRS 复习系统 + Web Push
-- 本文件幂等，可重复执行

-- ============ push_subscriptions：Web Push 订阅（F3.2） ============
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null, -- { p256dh, auth }
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_all_own" on public.push_subscriptions;
create policy "push_subscriptions_all_own" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ cards：到期查询索引 ============
-- fsrs_state->>'due' 为 ISO 8601 字符串，字典序 = 时间序，可直接 btree
create index if not exists cards_active_due_idx
  on public.cards ((fsrs_state->>'due'))
  where status = 'active';
