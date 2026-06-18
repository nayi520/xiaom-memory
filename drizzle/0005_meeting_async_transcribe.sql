-- V27 会议记录：异步转写状态字段（幂等，可重复执行）
-- transcribe_status ∈ transcribing/done/failed（短同步路径为空）；transcribe_task_id = Fun-ASR 异步任务号。
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "transcribe_status" text;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "transcribe_task_id" text;

-- 部分索引：cron 兜底只扫「转写中」的记录，命中行少、扫描快。
CREATE INDEX IF NOT EXISTS "notes_transcribing_idx"
  ON "notes" ("transcribe_status")
  WHERE "transcribe_status" = 'transcribing';
