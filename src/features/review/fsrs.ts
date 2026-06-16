/**
 * FSRS 调度封装（PRD F3.1 / F3.4 / F3.5）
 *
 * 基于开源 ts-fsrs（不手写算法）。职责：
 * - cards.fsrs_state(jsonb) ↔ ts-fsrs Card 的（反）序列化
 *   兼容阶段 2 初始结构 {stability:null, difficulty:null, reps:0, due}（视为新卡）
 * - applyRating：四档自评（1忘了/2模糊/3记得/4轻松 = FSRS Rating 1–4）→ 新 fsrs_state
 * - forgettingRisk / sortQueue：复习队列按遗忘风险排序（可提取性越低/逾期越久越前）
 * - shouldGraduate：毕业判定（间隔 >180 天 且 最近连续 3 次评分 = 4）
 */

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';

// ============ 常量 ============

/** 每日复习上限（F3.4） */
export const DAILY_REVIEW_LIMIT = 20;
/** 每张卡片预估耗时（秒），推送文案用 */
export const SECONDS_PER_CARD = 30;
/** 毕业条件：间隔 > 180 天（F3.5） */
export const GRADUATE_MIN_INTERVAL_DAYS = 180;
/** 毕业条件：最近连续 N 次评分 = 4（轻松） */
export const GRADUATE_EASY_STREAK = 3;
/** leech（顽固卡）默认阈值：lapses ≥ 此值即视为 leech（V14，可由 env LEECH_LAPSES 覆盖）。 */
export const DEFAULT_LEECH_LAPSES = 8;

/** 四档自评：1忘了 / 2模糊 / 3记得 / 4轻松（对应 FSRS Rating 1–4） */
export type ReviewRating = 1 | 2 | 3 | 4;

export const RATING_LABELS: Record<ReviewRating, string> = {
  1: '忘了',
  2: '模糊',
  3: '记得',
  4: '轻松',
};

// ============ fsrs_state JSON 形态 ============

/**
 * cards.fsrs_state 的 JSON 结构。
 * 阶段 2 初始写入 {stability:null, difficulty:null, reps:0, due:明天}，
 * 首次评分后由本模块补全其余字段。
 */
export interface FsrsStateJson {
  due: string;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  state?: number; // ts-fsrs State 枚举（0=New 1=Learning 2=Review 3=Relearning）
  lapses?: number;
  scheduled_days?: number;
  elapsed_days?: number;
  learning_steps?: number;
  last_review?: string | null;
}

// ============ 调度器实例 ============

// enable_fuzz=false：间隔确定可测试；enable_short_term=false：跳过分钟级学习步，
// 直接日级调度（产品形态是每日一次复习，不做当日内多轮短期记忆）
const scheduler = fsrs(
  generatorParameters({ enable_fuzz: false, enable_short_term: false })
);

// ============ 反序列化 / 序列化 ============

/** 从 fsrs_state jsonb 还原 ts-fsrs Card；stability 为 null（阶段 2 初始）视为新卡 */
export function cardFromState(json: FsrsStateJson | null | undefined): Card {
  const card = createEmptyCard(new Date());
  if (!json) return card;

  if (json.due) card.due = new Date(json.due);

  // 新卡（阶段 2 初始结构或缺字段）：保留 due，其余维持空卡默认
  if (json.stability == null || json.difficulty == null) {
    if (typeof json.reps === 'number') card.reps = json.reps;
    return card;
  }

  card.stability = json.stability;
  card.difficulty = json.difficulty;
  card.reps = json.reps ?? 0;
  card.lapses = json.lapses ?? 0;
  card.state = (json.state ?? State.Review) as State;
  card.scheduled_days = json.scheduled_days ?? 0;
  card.elapsed_days = json.elapsed_days ?? 0;
  card.learning_steps = json.learning_steps ?? 0;
  if (json.last_review) card.last_review = new Date(json.last_review);
  return card;
}

/** Card → fsrs_state jsonb（日期转 ISO 字符串） */
export function stateToJson(card: Card): FsrsStateJson {
  return {
    due: new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    scheduled_days: card.scheduled_days,
    elapsed_days: card.elapsed_days,
    learning_steps: card.learning_steps,
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null,
  };
}

// ============ 评分 ============

export interface RatingOutcome {
  /** 新的 fsrs_state，可直接写回 cards.fsrs_state */
  state: FsrsStateJson;
  /** 下次到期 ISO */
  dueIso: string;
  /** 本次安排的间隔（天） */
  scheduledDays: number;
}

/** 对一张卡评分，返回更新后的 fsrs_state（不落库，由调用方写表） */
export function applyRating(
  json: FsrsStateJson | null | undefined,
  rating: ReviewRating,
  now: Date = new Date()
): RatingOutcome {
  const card = cardFromState(json);
  const { card: next } = scheduler.next(card, now, rating as unknown as Grade);
  const state = stateToJson(next);
  return {
    state,
    dueIso: state.due,
    scheduledDays: next.scheduled_days,
  };
}

// ============ 遗忘风险排序（F3.4） ============

/**
 * 遗忘风险排序键：数值越小越该先复习。
 * - 已复习过的卡：FSRS 可提取性 retrievability ∈ [0,1]（逾期越久越低）
 * - 新卡（无 stability）：以逾期天数模拟，刚到期 ≈ 0.9，每逾期 1 天 -0.05，下限 0
 */
export function forgettingRisk(
  json: FsrsStateJson | null | undefined,
  now: Date = new Date()
): number {
  const card = cardFromState(json);
  if (card.state === State.New) {
    const overdueDays = (now.getTime() - card.due.getTime()) / 86_400_000;
    return Math.max(0, 0.9 - Math.max(0, overdueDays) * 0.05);
  }
  const r = scheduler.get_retrievability(card, now, false);
  return typeof r === 'number' && Number.isFinite(r) ? r : 0;
}

/** 队列排序：遗忘风险高（排序键小）在前 */
export function sortQueue<T extends { fsrs_state: FsrsStateJson | null }>(
  items: T[],
  now: Date = new Date()
): T[] {
  return [...items].sort(
    (a, b) => forgettingRisk(a.fsrs_state, now) - forgettingRisk(b.fsrs_state, now)
  );
}

// ============ 毕业（F3.5） ============

/**
 * 毕业判定：本次评分后的间隔 > 180 天，且最近 3 次评分（含本次，新→旧）全为 4。
 * @param scheduledDays 本次评分后安排的间隔（天）
 * @param recentRatings 最近的评分列表，最新在前（应含本次评分）
 */
export function shouldGraduate(
  scheduledDays: number,
  recentRatings: number[]
): boolean {
  if (scheduledDays <= GRADUATE_MIN_INTERVAL_DAYS) return false;
  if (recentRatings.length < GRADUATE_EASY_STREAK) return false;
  return recentRatings.slice(0, GRADUATE_EASY_STREAK).every((r) => r === 4);
}

// ============ 推送文案估时（F3.2） ============

/** 预计复习分钟数：按每张 30 秒、每日上限 20 张估算，至少 1 分钟 */
export function estimateMinutes(dueCount: number): number {
  const cards = Math.min(dueCount, DAILY_REVIEW_LIMIT);
  return Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
}

// ============ leech 标记（V14） ============

/**
 * 当前 leech 阈值：env LEECH_LAPSES 为合法非负整数则用之，否则缺省 8。
 * 仅在服务端读取（env 不暴露给客户端）；纯函数，便于测试。
 */
export function leechThreshold(): number {
  const raw = process.env.LEECH_LAPSES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_LEECH_LAPSES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_LEECH_LAPSES;
  return n;
}

/**
 * 是否为 leech（顽固卡）：fsrs_state.lapses ≥ 阈值。
 * @param threshold 阈值（默认取 leechThreshold()）。lapses 缺省视为 0。
 */
export function isLeech(
  json: FsrsStateJson | null | undefined,
  threshold: number = leechThreshold()
): boolean {
  const lapses = json?.lapses ?? 0;
  return typeof lapses === 'number' && lapses >= threshold;
}
