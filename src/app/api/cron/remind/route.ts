import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { estimateMinutes } from '@/features/review/fsrs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET/POST /api/cron/remind —— 每晨复习提醒（F3.2）
 * 鉴权：Authorization: Bearer ${CRON_SECRET}
 * 逻辑：取全部 push 订阅 → 按用户统计到期 active 卡数 → >0 则推送
 *      "今天有 N 张卡片待复习，预计 X 分钟"（每张 30 秒、上限 20 张估时）。
 * Vercel Cron：UTC 0:00（北京时间 8:00），见 vercel.json。
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

    const nowIso = new Date().toISOString();
    let usersNotified = 0;
    let sent = 0;
    let removed = 0;
    const errors: string[] = [];

    for (const [userId, userSubs] of Array.from(byUser.entries())) {
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
      const payload = JSON.stringify({
        title: '小M · 该复习了',
        body: `今天有 ${due} 张卡片待复习，预计 ${estimateMinutes(due)} 分钟`,
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
      subscriptions: subs?.length ?? 0,
      usersNotified,
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
