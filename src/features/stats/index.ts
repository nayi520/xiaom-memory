/**
 * 统计派生（首页 Dashboard / /api/stats 用）—— 纯函数，便于单测、与查询解耦。
 *
 * 口径统一用「UTC 日历日」：与 notes.created_at（timestamptz）落库、各列表排序口径一致，
 * 避免引入用户时区带来的歧义。streak 与 weekStart 均以服务端 now（UTC）为基准。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date → 'YYYY-MM-DD'（UTC 日历日）。 */
function toUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD'（按 UTC 0 点）→ Date。 */
function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * 连续记录天数：给定一组记录日期（'YYYY-MM-DD'，可乱序/含重复），算出截至今天的连续天数。
 *
 * 规则：
 *   - 必须「今天」或「昨天」有记录才算仍在连续中（今天还没记不立刻断签，给当天补记的余地）；
 *   - 从该锚点起逐日回溯，直到出现断档为止；
 *   - 无任何记录返回 0。
 *
 * @param days   记录日期列表（UTC 日历日字符串）
 * @param nowMs  当前时间戳（默认 Date.now()，测试可注入）
 */
export function computeStreak(days: string[], nowMs: number = Date.now()): number {
  const set = new Set(days);
  if (set.size === 0) return 0;

  const today = toUtcDay(new Date(nowMs));
  const yesterday = toUtcDay(new Date(nowMs - DAY_MS));

  // 锚点：优先今天，否则昨天；都没有则连续已中断。
  let cursor: string;
  if (set.has(today)) cursor = today;
  else if (set.has(yesterday)) cursor = yesterday;
  else return 0;

  let streak = 0;
  let cursorMs = dayToDate(cursor).getTime();
  while (set.has(toUtcDay(new Date(cursorMs)))) {
    streak += 1;
    cursorMs -= DAY_MS;
  }
  return streak;
}

/**
 * 本周起点（周一 00:00 UTC）的 ISO 字符串，供「本周新增」按 created_at >= weekStart 统计。
 * 以 ISO 周（周一为一周开始）计。
 */
export function weekStartIso(nowMs: number = Date.now()): string {
  const now = new Date(nowMs);
  const dow = now.getUTCDay(); // 0=周日, 1=周一 … 6=周六
  const sinceMonday = (dow + 6) % 7; // 周一→0, 周日→6
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      sinceMonday * DAY_MS
  );
  return monday.toISOString();
}
