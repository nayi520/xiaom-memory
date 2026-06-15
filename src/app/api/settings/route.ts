import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * 用户设置（profiles.settings jsonb）—— 去 Supabase 改造
 *
 * GET   → { settings: { reminderHour, reviewDailyGoal } }（无 profile / 未设置时回各自缺省）
 * PATCH → 写 settings.reminderHour（0–23 整点，北京时间）和/或 settings.reviewDailyGoal（每日复习目标，1–100）。
 *         两键各自可选，可单独或同时提交；至少要带一项，否则 400。
 *
 * 鉴权 getCurrentUser() 短路；授权应用层——按 user.id 读/写 profiles（原靠 RLS）。
 * 写入用 upsert + jsonb 合并（`settings || jsonb_build_object(...)`），
 * 既保证 profile 缺失时也能落库，又不覆盖 settings 内其它键（含彼此）。
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

  let body: { reminderHour?: unknown; reviewDailyGoal?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  // 校验提交的键（各自可选）；累积成一个 jsonb 合并对象，整体 upsert，不覆盖 settings 其它键。
  const patchEntries: ReturnType<typeof sql>[] = [];
  const echo: { reminderHour?: number; reviewDailyGoal?: number } = {};

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

  if (patchEntries.length === 0) {
    return NextResponse.json(
      { error: '参数错误：需要 reminderHour 或 reviewDailyGoal 中的至少一项' },
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
