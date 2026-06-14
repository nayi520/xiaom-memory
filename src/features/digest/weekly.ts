/**
 * 每周知识周报（P5）—— 把本周 daily digests + 本周新概念/关联汇总成「本周知识周报」。
 *
 * 与每日流水线（pipeline.ts）解耦：单独的 WeeklyStore 数据访问接口（Drizzle 实现见 store.ts），
 * 故不影响 pipeline.ts 的 DigestStore 契约与 scripts/test-pipeline.ts。
 *
 * 周窗口：ISO 周（周一 00:00 ~ 下周一 00:00，Asia/Shanghai）。period 标识用「YYYY-Www」（如 2026-W24）。
 * 生成函数 runWeeklyDigestForUser：取本周数据 → buildP5Prompt → llm.text(haiku, 'P5') → 存 digests(type='weekly')。
 * 至少有一篇日报或一个新概念才生成；否则返回 generated:false，不写库、不调 LLM。
 */

import { buildP5Prompt, GLOBAL_SYSTEM } from './prompts';
import type { LlmClient } from '@/lib/llm';

/** 周窗口时区（与 pipeline 的 DIGEST_TIMEZONE 一致；此处局部用，避免 barrel 重复导出） */
const DIGEST_TIMEZONE = 'Asia/Shanghai';

// ============ 数据访问接口（与每日 DigestStore 分开） ============

export interface WeeklyConceptRow {
  name: string;
  domain: string | null;
  topic: string | null;
  explanation: string | null;
}

export interface WeeklyLinkRow {
  from: string;
  to: string;
  relationType: string | null;
  reason: string | null;
}

export interface WeeklyDigestRecord {
  period: string;
  content: string;
}

export interface WeeklyStore {
  /** 本周各日 daily digest 的 Markdown（period 落在 [fromPeriod, toPeriod] 内，升序） */
  listDailyDigestsInRange(
    userId: string,
    fromPeriod: string,
    toPeriod: string
  ): Promise<{ period: string; contentMd: string }[]>;
  /** 本周新建概念（created_at 落在 [fromIso, toIso)） */
  listConceptsInRange(
    userId: string,
    fromIso: string,
    toIso: string
  ): Promise<WeeklyConceptRow[]>;
  /** 本周新建概念关联（created_at 落在 [fromIso, toIso)，带两端概念名） */
  listLinksInRange(
    userId: string,
    fromIso: string,
    toIso: string
  ): Promise<WeeklyLinkRow[]>;
  /** 周报 upsert（user_id + type='weekly' + period 唯一） */
  saveWeeklyDigest(userId: string, period: string, contentMd: string): Promise<void>;
  /** 最新一篇周报（按 period 倒序），无则 null */
  getLatestWeeklyDigest(userId: string): Promise<WeeklyDigestRecord | null>;
}

// ============ 周窗口（ISO 周，周一起，Asia/Shanghai 固定 +08:00） ============

export interface WeekWindow {
  /** 'YYYY-Www'，如 2026-W24（digests.period 用） */
  period: string;
  /** 周一 00:00 的 'YYYY-MM-DD'（daily digest period 比较下界） */
  startDate: string;
  /** 周日 00:00 的 'YYYY-MM-DD'（daily digest period 比较上界，含当天） */
  endDate: string;
  fromIso: string;
  /** 下周一 00:00（concepts/links 时间上界，开区间） */
  toIso: string;
}

const DAY_MS = 24 * 3600 * 1000;

/** 取某 Date 在 Asia/Shanghai 下的 'YYYY-MM-DD' */
function shanghaiDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DIGEST_TIMEZONE }).format(d);
}

/**
 * 把 'YYYY-MM-DD' 视为「以 UTC 午夜为锚的纯日历日」。
 * 在此锚点上 getUTCDay()/±天 运算得到的是**正确的公历星期与日期**，且不受运行环境时区影响；
 * 仅在产出 fromIso/toIso（真实时刻）时再按 +08:00 折算为沪上 00:00 的瞬间。
 */
function civilUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** 锚点 Date（UTC 午夜）→ 'YYYY-MM-DD' */
function civilStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 纯日历日（YYYY-MM-DD）→ 沪上该日 00:00 的真实瞬间 ISO */
function shanghaiMidnightIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+08:00`).toISOString();
}

/**
 * 计算 now 所在 ISO 周（周一起）的窗口。
 * 以 Asia/Shanghai 当日为锚，回退到本周一；时刻边界按沪上 00:00 折算。
 */
export function weekWindow(now: Date = new Date()): WeekWindow {
  const today = shanghaiDate(now); // YYYY-MM-DD（沪上当日）
  const anchor = civilUtc(today); // UTC 午夜锚点，星期/加减天准确
  const dow = anchor.getUTCDay(); // 0=周日…6=周六（公历星期）
  const backToMonday = (dow + 6) % 7; // 周一→0, 周日→6
  const monday = new Date(anchor.getTime() - backToMonday * DAY_MS);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);

  const startDate = civilStr(monday);
  const endDate = civilStr(sunday);

  return {
    period: isoWeekLabel(monday),
    startDate,
    endDate,
    fromIso: shanghaiMidnightIso(startDate),
    toIso: shanghaiMidnightIso(civilStr(nextMonday)),
  };
}

/**
 * ISO 8601 周编号标签 'YYYY-Www'。年份由该周周四所在年决定（ISO 规则）。
 * @param monday 该周周一（UTC 午夜锚点，由 civilUtc 产生）
 */
export function isoWeekLabel(monday: Date): string {
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  // 该年第 1 周 = 含 1/4 的那周（等价于含该年首个周四的周一）。
  const jan4 = civilUtc(`${year}-01-01`);
  jan4.setUTCDate(4);
  const jan4Dow = jan4.getUTCDay();
  const week1Monday = new Date(jan4.getTime() - ((jan4Dow + 6) % 7) * DAY_MS);
  const weekNo = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(weekNo).padStart(2, '0')}`;
}

// ============ 生成 ============

export interface WeeklyDeps {
  store: WeeklyStore;
  llm: LlmClient;
  now?: Date;
  log?: (msg: string) => void;
}

export interface WeeklyResult {
  userId: string;
  period: string;
  startDate: string;
  endDate: string;
  dailyCount: number;
  conceptCount: number;
  linkCount: number;
  generated: boolean;
}

/**
 * 为单个用户生成本周周报（手动触发用）。
 * 无任何本周日报与新概念 → 不生成（generated:false），省成本。
 */
export async function runWeeklyDigestForUser(
  userId: string,
  deps: WeeklyDeps
): Promise<WeeklyResult> {
  const { store, llm } = deps;
  const log = deps.log ?? ((msg: string) => console.log(`[weekly] ${msg}`));
  const w = weekWindow(deps.now);

  const [dailies, concepts, links] = await Promise.all([
    store.listDailyDigestsInRange(userId, w.startDate, w.endDate),
    store.listConceptsInRange(userId, w.fromIso, w.toIso),
    store.listLinksInRange(userId, w.fromIso, w.toIso),
  ]);

  const result: WeeklyResult = {
    userId,
    period: w.period,
    startDate: w.startDate,
    endDate: w.endDate,
    dailyCount: dailies.length,
    conceptCount: concepts.length,
    linkCount: links.length,
    generated: false,
  };

  log(
    `user=${userId} period=${w.period} dailies=${dailies.length} concepts=${concepts.length} links=${links.length}`
  );

  // 本周毫无沉淀：不调 LLM、不写库（避免空泛/无意义周报）
  if (dailies.length === 0 && concepts.length === 0) {
    return result;
  }

  const dailyDigestsMd =
    dailies.length > 0
      ? dailies.map((d) => `【${d.period}】\n${d.contentMd}`).join('\n\n---\n\n')
      : '（本周没有每日简报）';

  const contentMd = await llm.text(
    buildP5Prompt({
      week_label: w.period,
      week_start: w.startDate,
      week_end: w.endDate,
      daily_digests_md: dailyDigestsMd,
      concepts_json: JSON.stringify(
        concepts.map((c) => ({
          name: c.name,
          domain: c.domain ?? '',
          topic: c.topic ?? '',
          explanation: c.explanation ?? '',
        }))
      ),
      links_json: JSON.stringify(
        links.map((l) => ({
          from: l.from,
          to: l.to,
          relation_type: l.relationType ?? '',
          reason: l.reason ?? '',
        }))
      ),
    }),
    { model: 'haiku', task: 'P5', system: GLOBAL_SYSTEM }
  );

  await store.saveWeeklyDigest(userId, w.period, contentMd.trim());
  result.generated = true;
  log(`user=${userId} 周报已生成（period=${w.period}）`);
  return result;
}
