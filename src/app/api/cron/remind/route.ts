import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { estimateMinutes } from '@/features/review/fsrs';
import { DIGEST_TIMEZONE } from '@/features/digest/pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 未设置提醒小时时的缺省（北京时间 8 点），与历史行为一致 */
const DEFAULT_REMINDER_HOUR = 8;
/** 简报一行摘要的最大字数（Web Push body 不宜过长） */
const DIGEST_SNIPPET_MAX = 50;

/** 当前北京时间的小时（0–23），无夏令时固定 +08:00。 */
function beijingHour(now: Date = new Date()): number {
  const hh = new Intl.DateTimeFormat('en-GB', {
    timeZone: DIGEST_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number.parseInt(hh, 10);
}

/**
 * 从 profiles.settings.reminderHour 解析提醒小时；非法/缺省回退到 8。
 * settings 为 jsonb，admin client 未生成类型，故按 unknown 取值后做收敛。
 */
function resolveReminderHour(settings: unknown): number {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).reminderHour
      : undefined;
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_REMINDER_HOUR;
}

/**
 * 把简报 Markdown 收成一行摘要：取首个有内容的行，去掉 #/-/* 等标记，截断。
 * 无内容时返回 null（调用方据此优雅省略该行）。
 */
function digestSnippet(contentMd: string | null | undefined): string | null {
  if (!contentMd) return null;
  for (const rawLine of contentMd.split('\n')) {
    const line = rawLine
      .replace(/^\s*#{1,6}\s*/, '') // 标题井号
      .replace(/^\s*[-*+]\s+/, '') // 无序列表符号
      .replace(/^\s*\d+\.\s+/, '') // 有序列表序号
      .replace(/[*_`]/g, '') // 行内强调/代码标记
      .trim();
    if (!line) continue;
    return line.length > DIGEST_SNIPPET_MAX
      ? `${line.slice(0, DIGEST_SNIPPET_MAX)}…`
      : line;
  }
  return null;
}

/**
 * GET/POST /api/cron/remind —— 每晨复习提醒（F2.6 + F3.2）
 * 鉴权：Authorization: Bearer ${CRON_SECRET}
 * 逻辑：每整点运行 → 仅给"settings.reminderHour == 当前北京小时"的用户推送
 *      （未设置者缺省 8 点）→ 统计到期 active 卡数 → >0 则推送
 *      "今天有 N 张卡片待复习，预计 X 分钟"（每张 30 秒、上限 20 张估时），
 *      并附最近一条 daily 简报的一行摘要（无简报时省略）。
 * Vercel Cron：每整点 UTC（见 vercel.json），到点用户由 reminderHour 决定。
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '服务端未配置 CRON_SECRET' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '鉴权失败' }, { status: 401 });
  }

  // 无 VAPID key 优雅降级：明确报错，不崩溃
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json(
      { error: '未配置 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY，推送不可用' },
      { status: 503 }
    );
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@nayitools.cn',
    vapidPublic,
    vapidPrivate
  );

  try {
    const supabase = createAdminClient();
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, keys');
    if (error) throw new Error(`查询订阅失败：${error.message}`);

    // 按用户分组
    const byUser = new Map<string, typeof subs>();
    for (const sub of subs ?? []) {
      const list = byUser.get(sub.user_id) ?? [];
      list.push(sub);
      byUser.set(sub.user_id, list);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const currentHour = beijingHour(now);
    let usersNotified = 0;
    let usersSkippedHour = 0;
    let sent = 0;
    let removed = 0;
    const errors: string[] = [];

    for (const [userId, userSubs] of Array.from(byUser.entries())) {
      // 每用户提醒小时过滤：仅推送给 reminderHour == 当前北京小时的用户
      // （未设置 / 非法值缺省 8 点，行为与历史一致）
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('settings')
        .eq('id', userId)
        .maybeSingle();
      if (profileErr) {
        errors.push(`user=${userId} 读取设置失败：${profileErr.message}`);
        continue;
      }
      if (resolveReminderHour(profile?.settings) !== currentHour) {
        usersSkippedHour += 1;
        continue;
      }

      // admin client 绕过 RLS，必须显式按 concepts.user_id 过滤
      const { count, error: countErr } = await supabase
        .from('cards')
        .select('id, concepts!inner(user_id)', { count: 'exact', head: true })
        .eq('concepts.user_id', userId)
        .eq('status', 'active')
        .lte('fsrs_state->>due', nowIso);
      if (countErr) {
        errors.push(`user=${userId} 到期统计失败：${countErr.message}`);
        continue;
      }
      const due = count ?? 0;
      if (due <= 0) continue;

      usersNotified += 1;

      // 附最近一条 daily 简报的一行摘要（F2.6）；读取失败/无简报均优雅省略
      let snippet: string | null = null;
      const { data: digest, error: digestErr } = await supabase
        .from('digests')
        .select('content_md')
        .eq('user_id', userId)
        .eq('type', 'daily')
        .order('period', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (digestErr) {
        errors.push(`user=${userId} 读取简报失败：${digestErr.message}`);
      } else {
        snippet = digestSnippet(digest?.content_md as string | null | undefined);
      }

      const reviewLine = `今天有 ${due} 张卡片待复习，预计 ${estimateMinutes(due)} 分钟`;
      const payload = JSON.stringify({
        title: '小M · 该复习了',
        body: snippet ? `${reviewLine}\n简报：${snippet}` : reviewLine,
        url: '/review',
      });

      for (const sub of userSubs ?? []) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys as { p256dh: string; auth: string },
            },
            payload
          );
          sent += 1;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // 订阅已失效，清理
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
            removed += 1;
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`推送失败（user=${userId}）：${msg}`);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      currentHour,
      subscriptions: subs?.length ?? 0,
      usersNotified,
      usersSkippedHour,
      sent,
      removed,
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/remind] 异常：', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
