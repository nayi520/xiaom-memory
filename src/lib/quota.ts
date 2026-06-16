/**
 * per-user 每日 AI 配额（成本/滥用闸）—— 基于 usage_counters 表
 *
 * 目的：给付费 AI 端点（ask / transcribe / clip / embedding）设**每日上限**，防单用户刷爆成本。
 * 计量口径：**UTC 日历日**（与 stats 一致，用 new Date().toISOString().slice(0,10)），按 userId 严格隔离。
 *
 * 原子性：用 `insert ... on conflict (user_id,day,kind) do update set count=count+1 returning count`
 *   一次往返既自增又拿到自增后的值，天然并发安全（主键冲突即 UPSERT，无读改写竞态）。
 *
 * 上限可由 env 配置（缺省给「够日常自用」的合理默认）：
 *   QUOTA_ASK_DAILY=100  QUOTA_TRANSCRIBE_DAILY=50  QUOTA_CLIP_DAILY=100  QUOTA_EMBED_DAILY=500
 * 设为 0 表示**禁用该类**（直接判超额）；设为负数视为「不限」（never）。
 *
 * 降级：DB 不可用时不应连累 AI 主流程（调用方已各自处理无 DATABASE_URL 的情况），
 *   故 consumeQuota 内部的 DB 异常**放行**（fail-open）——配额是成本闸而非安全闸，宁可漏计不可误杀。
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { usageCounters } from '@/lib/db/schema';

/** 配额计量的操作类型（= usage_counters.kind 取值）。ocr=图片转文字（V13，qwen-vl）。 */
export type QuotaKind = 'ask' | 'transcribe' | 'clip' | 'embedding' | 'ocr';

/** 各 kind 的 env 变量名与缺省每日上限（够日常自用）。 */
const QUOTA_CONFIG: Record<QuotaKind, { env: string; fallback: number }> = {
  ask: { env: 'QUOTA_ASK_DAILY', fallback: 100 },
  transcribe: { env: 'QUOTA_TRANSCRIBE_DAILY', fallback: 50 },
  clip: { env: 'QUOTA_CLIP_DAILY', fallback: 100 },
  embedding: { env: 'QUOTA_EMBED_DAILY', fallback: 500 },
  // 图片 OCR（qwen-vl 多模态）：与转写同档（图片捕获频率与语音相当）。
  ocr: { env: 'QUOTA_OCR_DAILY', fallback: 50 },
};

/** 解析某 kind 的每日上限：env 有合法整数则用之，否则用缺省。负数 = 不限。 */
export function dailyLimit(kind: QuotaKind): number {
  const { env, fallback } = QUOTA_CONFIG[kind];
  const raw = process.env[env];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/** 当前 UTC 日历日（'YYYY-MM-DD'），与 stats 口径一致。 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface QuotaResult {
  /** 是否放行（true=本次在额度内，已计入）。 */
  ok: boolean;
  /** 该 kind 的每日上限（< 0 表示不限）。 */
  limit: number;
  /** 计入本次后的当日累计次数（fail-open 放行时为 -1，表示未计量）。 */
  used: number;
}

/**
 * 消耗一次配额并判断是否超额（**原子自增**）。在端点**实际产生 AI 成本前**调用：
 *   - 放行（ok:true）：已把当日计数 +1，继续执行 AI 调用。
 *   - 超额（ok:false）：当日已达上限，调用方回 429 {error:'今日额度已用尽', kind, limit}。
 *
 * 语义细节：
 *   - limit < 0（env 设负）→ 不限：直接放行，**不写库**（省一次往返）。
 *   - limit === 0 → 该类禁用：直接超额（不写库）。
 *   - 否则：UPSERT 自增取回 count，count > limit 即超额。注意「先增后判」，
 *     故第 limit 次放行、第 limit+1 次起拒绝（即每日恰好允许 limit 次）。
 *   - DB 异常 → fail-open 放行（成本闸不挡正常使用），used 记 -1。
 *
 * @param userId 当前登录用户 id（严格按此计量，调用方从 getCurrentUser 取得）。
 * @param kind   操作类型。
 */
export async function consumeQuota(userId: string, kind: QuotaKind): Promise<QuotaResult> {
  const limit = dailyLimit(kind);
  if (limit < 0) return { ok: true, limit, used: -1 }; // 不限
  if (limit === 0) return { ok: false, limit, used: 0 }; // 禁用该类

  const day = todayUtc();
  try {
    const rows = await getDb()
      .insert(usageCounters)
      .values({ userId, day, kind, count: 1 })
      .onConflictDoUpdate({
        target: [usageCounters.userId, usageCounters.day, usageCounters.kind],
        set: { count: sql`${usageCounters.count} + 1` },
      })
      .returning({ count: usageCounters.count });

    const used = rows[0]?.count ?? 1;
    return { ok: used <= limit, limit, used };
  } catch (err) {
    // 配额是成本闸而非安全闸：DB 故障时放行，避免误杀正常用户（不打印敏感信息）。
    console.error(`[quota] 计量失败（kind=${kind}），fail-open 放行：`, err instanceof Error ? err.message : err);
    return { ok: true, limit, used: -1 };
  }
}
