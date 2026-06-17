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

// ============ V17 知识成长洞察：累计增长曲线 ============

/** 成长曲线上的一个点：UTC 日历日 + 截至该日的累计数。 */
export interface GrowthPoint {
  date: string;
  count: number;
}

/**
 * 把「每条记录的 UTC 创建日」聚成「近 windowDays 天的每日累计曲线」。
 *
 * 语义（与热力图 daily 一致的密集序列，但值是**累计**而非当日增量）：
 *   - 输出恰好 windowDays 个点，按日期升序，最后一个点是 today；
 *   - 每个点的 count = 截至该日（含）的全部记录数（包含窗口之前的历史，体现真实总量增长）；
 *   - 无任何记录时，输出一条贴着「历史基线」的水平线（全 0）。
 *
 * @param createdDays 每条记录的创建日（'YYYY-MM-DD'，可乱序/含重复/含窗口外更早的日期）
 * @param windowDays  曲线长度（含今天），如 30 / 90
 * @param nowMs       当前时间戳（默认 Date.now()，测试可注入）
 */
export function cumulativeGrowth(
  createdDays: string[],
  windowDays: number,
  nowMs: number = Date.now()
): GrowthPoint[] {
  // 每个「创建日」的当日新增数。
  const addedByDay = new Map<string, number>();
  for (const day of createdDays) {
    addedByDay.set(day, (addedByDay.get(day) ?? 0) + 1);
  }

  // 窗口起点之前的累计基线：所有早于窗口首日的记录数（让曲线从真实总量起步）。
  const todayMs = new Date(`${toUtcDay(new Date(nowMs))}T00:00:00.000Z`).getTime();
  const firstDayMs = todayMs - (windowDays - 1) * DAY_MS;
  let baseline = 0;
  for (const [day, n] of Array.from(addedByDay.entries())) {
    if (dayToDate(day).getTime() < firstDayMs) baseline += n;
  }

  const points: GrowthPoint[] = [];
  let running = baseline;
  for (let i = 0; i < windowDays; i++) {
    const day = toUtcDay(new Date(firstDayMs + i * DAY_MS));
    running += addedByDay.get(day) ?? 0;
    points.push({ date: day, count: running });
  }
  return points;
}

// ============ V17 成就徽章：纯派生（无存储） ============

/** 派生徽章定义所需的当前进度快照（全部来自既有数据聚合）。 */
export interface AchievementSnapshot {
  /** 累计未软删记录数 */
  noteCount: number;
  /** 累计概念数 */
  conceptCount: number;
  /** 累计复习日志条数 */
  reviewCount: number;
  /** 连续记录天数 */
  streak: number;
  /** 有概念的领域数（domain 去重计数） */
  domainCount: number;
  /** 长期保留率 ∈ [0,1] */
  retentionRate: number;
  /** 总复习数（用于判断保留率类徽章是否「已有足够样本」） */
  totalReviews: number;
}

/** 单个成就徽章（已得 / 未得 + 进度 0..1）。纯派生，前后端同形。 */
export interface Achievement {
  id: string;
  name: string;
  desc: string;
  achieved: boolean;
  /** 完成进度 ∈ [0,1]（已达成恒为 1），便于前端画进度环/条。 */
  progress: number;
}

/** 「达到阈值」型徽章的进度：min(current/target, 1)，target<=0 视为已达成。 */
function thresholdProgress(current: number, target: number): number {
  if (target <= 0) return 1;
  return Math.min(1, current / target);
}

/**
 * 据当前快照派生全部成就徽章（已得/未得 + 进度）。**纯函数、无存储**。
 *
 * 设计：里程碑按「记录量 / 连续 / 领域广度 / 复习量 / 保留率」五条线展开，
 * 每条线给几档阶梯，覆盖从新手到资深。保留率类徽章要求最低复习样本量，避免
 * 「只复习过 1 张且记得」就误判 90% 达成。各徽章互相独立、可同时达成。
 */
export function deriveAchievements(snap: AchievementSnapshot): Achievement[] {
  const RETENTION_MIN_SAMPLE = 20; // 保留率徽章的最低复习样本量

  const defs: Achievement[] = [
    // —— 记录量 ——
    mk('notes_10', '初record', '累计记录 10 条', snap.noteCount, 10),
    mk('notes_100', '百宝箱', '累计记录 100 条', snap.noteCount, 100),
    mk('notes_500', '记录达人', '累计记录 500 条', snap.noteCount, 500),
    // —— 概念沉淀 ——
    mk('concepts_50', '概念新芽', '沉淀 50 个概念', snap.conceptCount, 50),
    mk('concepts_200', '知识网络', '沉淀 200 个概念', snap.conceptCount, 200),
    // —— 连续记录 ——
    mk('streak_7', '七日不辍', '连续记录 7 天', snap.streak, 7),
    mk('streak_30', '月度坚持', '连续记录 30 天', snap.streak, 30),
    // —— 领域广度 ——
    mk('domains_5', '触类旁通', '涉猎 5 个领域', snap.domainCount, 5),
    mk('domains_10', '博学多识', '涉猎 10 个领域', snap.domainCount, 10),
    // —— 复习量 ——
    mk('reviews_100', '温故百次', '累计复习 100 次', snap.reviewCount, 100),
    mk('reviews_500', '复习大师', '累计复习 500 次', snap.reviewCount, 500),
    // —— 保留率（需足够样本）——
    retentionBadge(
      'retention_80',
      '记忆稳固',
      '保留率达到 80%（≥20 次复习）',
      0.8,
      snap,
      RETENTION_MIN_SAMPLE
    ),
    retentionBadge(
      'retention_90',
      '过目不忘',
      '保留率达到 90%（≥20 次复习）',
      0.9,
      snap,
      RETENTION_MIN_SAMPLE
    ),
  ];
  return defs;
}

/** 「达到阈值」型徽章构造器。 */
function mk(
  id: string,
  name: string,
  desc: string,
  current: number,
  target: number
): Achievement {
  const progress = thresholdProgress(current, target);
  return { id, name, desc, achieved: current >= target, progress };
}

/**
 * 保留率型徽章：达成需「样本量足够 且 保留率达标」。
 * 进度取「样本量进度」与「保留率进度」的较小者，引导用户先攒够复习量再谈保留率。
 */
function retentionBadge(
  id: string,
  name: string,
  desc: string,
  targetRate: number,
  snap: AchievementSnapshot,
  minSample: number
): Achievement {
  const sampleProgress = thresholdProgress(snap.totalReviews, minSample);
  const rateProgress = thresholdProgress(snap.retentionRate, targetRate);
  const achieved = snap.totalReviews >= minSample && snap.retentionRate >= targetRate;
  return {
    id,
    name,
    desc,
    achieved,
    progress: achieved ? 1 : Math.min(sampleProgress, rateProgress),
  };
}
