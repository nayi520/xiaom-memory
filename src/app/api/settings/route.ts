import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * 用户设置（profiles.settings jsonb）—— 去 Supabase 改造
 *
 * GET   → { settings: { reminderHour, reviewDailyGoal, onboarded, quietHours, digestEmail } }
 *         （无 profile / 未设置时回各自缺省；quietHours 未启用时为 null）
 * PATCH → 写 settings.reminderHour（0–23 整点，北京时间）、settings.reviewDailyGoal（每日复习目标，1–100）、
 *         settings.onboarded（是否已看过新手引导，布尔，默认 false）、
 *         settings.quietHours（安静时段 {start,end} 两个北京整点，提醒/推送避开；传 null 清除）、
 *         settings.digestEmail（摘要邮件开关 'off'|'daily'|'weekly'，默认 'off'）。
 *         各键各自可选，可单独或同时提交；至少要带一项，否则 400。
 *
 * 鉴权 getCurrentUser() 短路；授权应用层——按 user.id 读/写 profiles（原靠 RLS）。
 * 写入用 upsert + jsonb 合并（`settings || jsonb_build_object(...)`），
 * 既保证 profile 缺失时也能落库，又不覆盖 settings 内其它键（含彼此）。
 *
 * iOS 契约：onboarded 为新增的跨端键——首次完成新手引导后置 true，仅用于「是否首展引导」。
 */

/** 复习提醒缺省小时（北京时间 8 点），与 cron/remind 的 DEFAULT_REMINDER_HOUR 一致。 */
const DEFAULT_REMINDER_HOUR = 8;
/** 每日复习目标缺省（张）；上限对齐 DAILY_REVIEW_LIMIT 内的合理目标。 */
const DEFAULT_REVIEW_DAILY_GOAL = 10;
/** 每日复习目标允许区间（张）。 */
const MIN_REVIEW_DAILY_GOAL = 1;
const MAX_REVIEW_DAILY_GOAL = 100;

/** 从 settings 收敛出 reminderHour（非法/缺省回退 8），与 cron/remind 的解析逻辑一致。 */
function resolveReminderHour(settings: unknown): number {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).reminderHour
      : undefined;
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_REMINDER_HOUR;
}

/** 从 settings 收敛出 reviewDailyGoal（非法/缺省回退 10，并夹到 1–100）。 */
function resolveReviewDailyGoal(settings: unknown): number {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).reviewDailyGoal
      : undefined;
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isInteger(n)) return DEFAULT_REVIEW_DAILY_GOAL;
  return Math.min(MAX_REVIEW_DAILY_GOAL, Math.max(MIN_REVIEW_DAILY_GOAL, n));
}

/** 从 settings 收敛出 onboarded（缺省/非布尔回退 false）。仅 true 才视为已引导过。 */
function resolveOnboarded(settings: unknown): boolean {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).onboarded
      : undefined;
  return raw === true;
}

/** 摘要邮件开关取值（V17）。'off' 不发；'daily'/'weekly' 由 cron/digest 用 sendMail 发对应摘要。 */
export type DigestEmailMode = 'off' | 'daily' | 'weekly';
const DEFAULT_DIGEST_EMAIL: DigestEmailMode = 'off';
const DIGEST_EMAIL_VALUES: DigestEmailMode[] = ['off', 'daily', 'weekly'];

/** 从 settings 收敛出 digestEmail（非法/缺省回退 'off'）。 */
function resolveDigestEmail(settings: unknown): DigestEmailMode {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).digestEmail
      : undefined;
  return DIGEST_EMAIL_VALUES.includes(raw as DigestEmailMode)
    ? (raw as DigestEmailMode)
    : DEFAULT_DIGEST_EMAIL;
}

/** 安静时段（V17）：{start,end} 两个北京整点（0–23）。提醒/推送在该时段内静默。 */
export interface QuietHours {
  start: number;
  end: number;
}

/** 把任意值收敛为 0–23 整点（非法 → null）。 */
function toHour(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
}

/**
 * 从 settings 收敛出 quietHours（V17）。未设置 / 非法 → null（= 不启用安静时段）。
 * start/end 均须为 0–23 整数；允许跨午夜（start>end，如 22→7）。start===end 视为未启用（空区间）。
 */
function resolveQuietHours(settings: unknown): QuietHours | null {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).quietHours
      : undefined;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const start = toHour(obj.start);
  const end = toHour(obj.end);
  if (start === null || end === null || start === end) return null;
  return { start, end };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const rows = await getDb()
      .select({ settings: profiles.settings })
      .from(profiles)
      .where(sql`${profiles.id} = ${user.id}`)
      .limit(1);
    const settings = rows[0]?.settings;
    return NextResponse.json({
      settings: {
        reminderHour: resolveReminderHour(settings),
        reviewDailyGoal: resolveReviewDailyGoal(settings),
        onboarded: resolveOnboarded(settings),
        quietHours: resolveQuietHours(settings),
        digestEmail: resolveDigestEmail(settings),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `读取设置失败：${msg}` }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: {
    reminderHour?: unknown;
    reviewDailyGoal?: unknown;
    onboarded?: unknown;
    quietHours?: unknown;
    digestEmail?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  // 校验提交的键（各自可选）；累积成一个 jsonb 合并对象，整体 upsert，不覆盖 settings 其它键。
  const patchEntries: ReturnType<typeof sql>[] = [];
  const echo: {
    reminderHour?: number;
    reviewDailyGoal?: number;
    onboarded?: boolean;
    quietHours?: QuietHours | null;
    digestEmail?: DigestEmailMode;
  } = {};

  if (body.reminderHour !== undefined) {
    const raw = body.reminderHour;
    const hour =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json(
        { error: 'reminderHour 必须是 0–23 的整数' },
        { status: 400 }
      );
    }
    patchEntries.push(sql`jsonb_build_object('reminderHour', ${hour}::int)`);
    echo.reminderHour = hour;
  }

  if (body.reviewDailyGoal !== undefined) {
    const raw = body.reviewDailyGoal;
    const goal =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
    if (
      !Number.isInteger(goal) ||
      goal < MIN_REVIEW_DAILY_GOAL ||
      goal > MAX_REVIEW_DAILY_GOAL
    ) {
      return NextResponse.json(
        {
          error: `reviewDailyGoal 必须是 ${MIN_REVIEW_DAILY_GOAL}–${MAX_REVIEW_DAILY_GOAL} 的整数`,
        },
        { status: 400 }
      );
    }
    patchEntries.push(sql`jsonb_build_object('reviewDailyGoal', ${goal}::int)`);
    echo.reviewDailyGoal = goal;
  }

  if (body.onboarded !== undefined) {
    const raw = body.onboarded;
    // 仅接受布尔（含字符串 'true'/'false'，便于跨端宽松提交）。
    const flag =
      typeof raw === 'boolean'
        ? raw
        : raw === 'true'
          ? true
          : raw === 'false'
            ? false
            : null;
    if (flag === null) {
      return NextResponse.json(
        { error: 'onboarded 必须是布尔值' },
        { status: 400 }
      );
    }
    patchEntries.push(sql`jsonb_build_object('onboarded', ${flag}::boolean)`);
    echo.onboarded = flag;
  }

  // quietHours：{start,end} 两个 0–23 整点，或 null（清除）。start===end 视为清除（空区间）。
  if (body.quietHours !== undefined) {
    const raw = body.quietHours;
    if (raw === null) {
      patchEntries.push(sql`jsonb_build_object('quietHours', null)`);
      echo.quietHours = null;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const start = toHour(obj.start);
      const end = toHour(obj.end);
      if (start === null || end === null) {
        return NextResponse.json(
          { error: 'quietHours.start / quietHours.end 必须是 0–23 的整数' },
          { status: 400 }
        );
      }
      if (start === end) {
        // 空区间 = 清除安静时段。
        patchEntries.push(sql`jsonb_build_object('quietHours', null)`);
        echo.quietHours = null;
      } else {
        patchEntries.push(
          sql`jsonb_build_object('quietHours', jsonb_build_object('start', ${start}::int, 'end', ${end}::int))`
        );
        echo.quietHours = { start, end };
      }
    } else {
      return NextResponse.json(
        { error: 'quietHours 必须是 {start,end} 对象或 null' },
        { status: 400 }
      );
    }
  }

  // digestEmail：'off' | 'daily' | 'weekly'。
  if (body.digestEmail !== undefined) {
    const raw = body.digestEmail;
    if (!DIGEST_EMAIL_VALUES.includes(raw as DigestEmailMode)) {
      return NextResponse.json(
        { error: "digestEmail 必须是 'off'、'daily' 或 'weekly'" },
        { status: 400 }
      );
    }
    patchEntries.push(sql`jsonb_build_object('digestEmail', ${raw}::text)`);
    echo.digestEmail = raw as DigestEmailMode;
  }

  if (patchEntries.length === 0) {
    return NextResponse.json(
      {
        error:
          '参数错误：需要 reminderHour、reviewDailyGoal、onboarded、quietHours 或 digestEmail 中的至少一项',
      },
      { status: 400 }
    );
  }

  // 把待写入的若干键合并成一个 jsonb（`{} || a || b`），整体并入 settings，互不覆盖。
  const patch = patchEntries.reduce(
    (acc, entry) => sql`${acc} || ${entry}`,
    sql`'{}'::jsonb`
  );

  // upsert + jsonb 合并：profile 缺失时按 patch 建行；存在时仅并入提交的键，不覆盖其它键。
  // 按 user.id 写（profiles.id 即 users.id）。
  try {
    await getDb()
      .insert(profiles)
      .values({
        id: user.id,
        email: user.email,
        settings: patch,
      })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { settings: sql`${profiles.settings} || ${patch}` },
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `设置保存失败：${msg}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings: echo });
}
