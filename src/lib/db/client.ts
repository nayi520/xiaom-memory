/**
 * Drizzle 客户端（postgres.js 驱动）—— 去 Supabase 改造（P1 数据层骨架）
 *
 * 设计：
 *   - **import 期不连库、不报错**：缺 DATABASE_URL 时延迟到首次取用才抛，避免构建/无关路由崩溃。
 *   - 单例缓存连接池（Next.js 热重载下复用），生产用 RDS PG16 + pgvector。
 *   - 本阶段**暂未接线**：现有 supabase.from() 查询不动，待 RDS 就绪后由后续阶段切换。
 *
 * 用法（后续阶段）：
 *   import { getDb } from '@/lib/db/client';
 *   const db = getDb();
 *   const rows = await db.select().from(notes).where(eq(notes.userId, userId));
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export class DatabaseUrlMissingError extends Error {
  constructor() {
    super('未配置 DATABASE_URL，无法连接数据库（RDS PostgreSQL）');
    this.name = 'DatabaseUrlMissingError';
  }
}

export type Database = PostgresJsDatabase<typeof schema>;

// 跨热重载缓存（开发期避免连接句柄泄漏）
const globalForDb = globalThis as unknown as {
  __memorySql?: ReturnType<typeof postgres>;
  __memoryDb?: Database;
};

/** 取底层 postgres.js 连接（一般用 getDb 即可，特殊场景如关闭连接才用本函数） */
export function getSql(): ReturnType<typeof postgres> {
  if (globalForDb.__memorySql) return globalForDb.__memorySql;

  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseUrlMissingError();

  const client = postgres(url, {
    // 无服务器/常驻进程通用的保守池配置；联调阶段可按 RDS 规格调整
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // RDS 走内网时通常不需 ssl；如需可在连接串带 ?sslmode=require
  });
  globalForDb.__memorySql = client;
  return client;
}

/**
 * 取 Drizzle 实例（缺 DATABASE_URL 抛 DatabaseUrlMissingError，调用入口负责降级/报错）。
 * 注意：本函数**不在模块加载时执行**，确保 import 期绝不因缺环境变量崩溃。
 */
export function getDb(): Database {
  if (globalForDb.__memoryDb) return globalForDb.__memoryDb;
  const db = drizzle(getSql(), { schema });
  globalForDb.__memoryDb = db;
  return db;
}

/** 是否已配置 DATABASE_URL（供调用方做优雅降级判断，不触发连接） */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
