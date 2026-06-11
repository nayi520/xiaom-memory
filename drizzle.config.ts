/**
 * drizzle-kit 配置（去 Supabase 改造 · P1 数据层骨架）
 *
 * 离线从 schema 生成迁移（无需连库）：
 *   npx drizzle-kit generate
 * 输出到 drizzle/ 目录（首个迁移 0000_*.sql 已纳入版本库，作 RDS 初始化脚本）。
 *
 * RDS 就绪后联调可用（需 DATABASE_URL）：
 *   npx drizzle-kit migrate   # 应用迁移
 *   npx drizzle-kit studio     # 数据浏览
 */

import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // generate 不连库；migrate/studio 才用到。缺失时给占位，避免误连。
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/memory',
  },
  // pgvector 等扩展类型由 schema 的 customType 输出，无需额外声明
  strict: true,
  verbose: true,
} satisfies Config;
