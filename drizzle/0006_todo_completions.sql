-- V28 行动项中心：待办「完成」状态表（幂等，可重复执行）
-- 待办文本从 note.raw_content 实时解析（GFM 任务清单 - [ ] / - [x]）；本表只持久化「完成」状态，
-- 不改 raw_content。命中 (note_id, item_key) 即视为已完成。所有读写按 user_id 过滤（无 RLS）。
CREATE TABLE IF NOT EXISTS "todo_completions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "note_id" uuid NOT NULL,
  "item_key" text NOT NULL,
  "done_at" timestamptz DEFAULT now() NOT NULL
);

-- 外键：用户 / 记录删除时级联清理完成态（用 DO 块包裹，缺失才加，保证幂等）。
DO $$ BEGIN
  ALTER TABLE "todo_completions"
    ADD CONSTRAINT "todo_completions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "todo_completions"
    ADD CONSTRAINT "todo_completions_note_id_notes_id_fk"
    FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 唯一约束：同一用户、同一记录、同一待办至多一行（toggle done=true 走 upsert）。
CREATE UNIQUE INDEX IF NOT EXISTS "todo_completions_user_note_item_key"
  ON "todo_completions" ("user_id", "note_id", "item_key");

-- 按用户聚合查询的辅助索引。
CREATE INDEX IF NOT EXISTS "todo_completions_user_idx"
  ON "todo_completions" ("user_id");
