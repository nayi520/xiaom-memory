-- 迁移 0001：users 表新增 password_hash（邮箱+密码登录）。
-- 去 Supabase 改造（V1 鉴权）：把登录主方式从「邮箱魔法链接」改为「邮箱+密码」。
-- password_hash 存 bcrypt 哈希（cost=12，永不存明文），可空：
--   - 邮箱+密码用户：有值；
--   - 老魔法链接 / Apple 用户：null（注册接口可为其补设密码）。
-- 幂等（IF NOT EXISTS），不破坏现有列/数据；供线上 RDS PG16 直接执行。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
