-- 小M Memory · 阶段 5：记录软删除回收站（PRD F5）
-- 本文件幂等，可重复执行
--
-- 软删除：notes 加 deleted_at（null = 未删 / 在用；非 null = 已移入回收站）。
-- 不动现有 status（status 表达 AI 整理生命周期，与删除态正交）。
-- RLS：现有 notes_all_own 已按 user_id 覆盖增删改查，软删/恢复/永久删除均走该策略，无需新策略。

alter table public.notes add column if not exists deleted_at timestamptz;

-- 回收站列表 / "未删记录"过滤都按 (user_id, deleted_at) 走，建索引提速
create index if not exists notes_user_deleted_idx
  on public.notes (user_id, deleted_at);
