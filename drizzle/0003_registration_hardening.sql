-- 迁移 0003：注册门禁加固（邀请制 + 邮箱验证）。
-- 让注册可安全开放：邀请码闸门 + 邮箱验证 + 同意条款 + 法务页。
-- 幂等（IF NOT EXISTS / 条件回填），不破坏现有列/数据；供线上 RDS PG16 直接执行。
--
-- 关键：email_verified 加列后**把现有行回填为 true**——绝不把老用户锁在登录门外。
-- 新列默认 false 仅对「本迁移之后」新建（邮箱+密码注册）的用户生效。

-- 1) users.email_verified：邮箱是否已验证（DEFAULT false 用于将来新注册）。
-- 1.1) **一次性回填**：把本迁移之前已存在的所有用户视为已验证（含 Apple / 老魔法链接 / 老密码用户）。
--      关键：列的「新增 + 全量回填」必须**绑定在同一次（首次）执行**——只有当列尚不存在时才执行，
--      并把当时全表（皆为迁移前的老用户）一并置 true。这样：
--        - 首次执行：加列 + 老用户全部 true；之后新注册用户走 DEFAULT false。
--        - 重复执行（幂等）：列已存在 → 整个块跳过，**绝不**误把后来新注册的未验证用户翻成 true。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email_verified'
  ) THEN
    -- 先以 DEFAULT true 加列：现有行立刻全部回填为 true（一步到位，无需再 UPDATE）。
    ALTER TABLE "users" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT true;
    -- 再把默认值改回 false：仅影响「此后」新插入的行（已存在行的值不变，仍为 true）。
    ALTER TABLE "users" ALTER COLUMN "email_verified" SET DEFAULT false;
  END IF;
END $$;--> statement-breakpoint

-- 2) invite_codes：邀请制注册。code 即主键；used_count<max_uses 且未过期才有效。
CREATE TABLE IF NOT EXISTS "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"note" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- 3) email_verifications：邮箱验证一次性令牌（带过期）。校验后置 users.email_verified=true 并删除该行。
CREATE TABLE IF NOT EXISTS "email_verifications" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- 3.1) 外键：用户删除时级联清理其未消费的验证令牌。幂等：仅在约束不存在时添加。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'email_verifications_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "email_verifications"
      ADD CONSTRAINT "email_verifications_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint

-- 3.2) 按 user_id 查询/清理用索引（重发验证、注册时清旧令牌）。
CREATE INDEX IF NOT EXISTS "email_verifications_user_idx" ON "email_verifications" ("user_id");
