-- 迁移 0002：users 表新增用户资料列 name / avatar_key。
-- 用户资料能力（显示名 + 头像）：
--   - name：显示用户名（可空，1–24 字符由应用层校验，trim 后判定）。
--   - avatar_key：头像在 OSS 私有 bucket 的对象 key（形如 `avatars/{userId}/{uuid}.<ext>`）；
--     展示时由后端 getSignedUrl 现签为临时 URL（~1h），库里只存 key、不存公网地址。
-- 幂等（IF NOT EXISTS），不破坏现有列/数据；供线上 RDS PG16 直接执行。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text;
