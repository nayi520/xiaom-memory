import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * 用户设置（profiles.settings jsonb）—— 去 Supabase 改造
 *
 * GET   → { settings: { reminderHour } }（无 profile / 未设置时回缺省 8）
 * PATCH → 写 settings.reminderHour（0–23 整点，北京时间）。
 *
 * 鉴权 getCurrentUser() 短路；授权应用层——按 user.id 读/写 profiles（原靠 RLS）。
 * 写入用 upsert + jsonb 合并（`settings || jsonb_build_object(...)`），
 * 既保证 profile 缺失时也能落库，又不覆盖 settings 内其它键。
 */

/** 复习提醒缺省小时（北京时间 8 点），与 cron/remind 的 DEFAULT_REMINDER_HOUR 一致。 */
const DEFAULT_REMINDER_HOUR = 8;

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
    return NextResponse.json({
      settings: { reminderHour: resolveReminderHour(rows[0]?.settings) },
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

  let body: { reminderHour?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const raw = body.reminderHour;
  const hour = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return NextResponse.json(
      { error: 'reminderHour 必须是 0–23 的整数' },
      { status: 400 }
    );
  }

  // upsert + jsonb 合并：profile 缺失时按默认 settings 建行；存在时仅并入 reminderHour，
  // 不覆盖其它键。按 user.id 写（profiles.id 即 users.id）。
  const patch = sql`jsonb_build_object('reminderHour', ${hour}::int)`;
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

  return NextResponse.json({ ok: true, settings: { reminderHour: hour } });
}
