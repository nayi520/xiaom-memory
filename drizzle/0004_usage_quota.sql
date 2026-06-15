-- 迁移 0004：per-user 每日 AI 用量配额（成本/滥用闸）。
-- 给付费 AI 端点（ask / transcribe / clip / embedding）加每日上限：原子自增 + 判超额。
-- 幂等（CREATE TABLE IF NOT EXISTS / 约束按存在性条件添加），不破坏现有列/数据；
-- 供线上 RDS PG16 直接执行，可重复跑。

-- 1) usage_counters：某用户某 UTC 日某类 AI 操作的累计次数。
--    主键 (user_id, day, kind) → 原子 UPSERT 自增的天然冲突目标。
--    count 默认 0，NOT NULL；day 为日历日（UTC，应用层计算后传入）。
CREATE TABLE IF NOT EXISTS "usage_counters" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_day_kind_pk" PRIMARY KEY("user_id","day","kind")
);--> statement-breakpoint

-- 1.1) 外键：用户删除时级联清理其用量计数。幂等：仅在约束不存在时添加
--      （兼容「表已先存在但缺 FK」的历史环境）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'usage_counters_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "usage_counters"
      ADD CONSTRAINT "usage_counters_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;
