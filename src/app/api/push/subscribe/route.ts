import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Web Push 订阅管理（F3.2）
 * GET    → { configured, publicKey }（VAPID 未配置时 configured=false，前端优雅降级）
 * POST   → 保存当前用户的 PushSubscription（upsert by endpoint）
 * DELETE → 删除订阅 { endpoint }
 */

export async function GET() {
  const configured = Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
  return NextResponse.json({
    configured,
    publicKey: configured ? process.env.VAPID_PUBLIC_KEY : null,
  });
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: { subscription?: { endpoint?: unknown; keys?: unknown } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const sub = body.subscription;
  if (
    !sub ||
    typeof sub.endpoint !== 'string' ||
    !sub.endpoint ||
    typeof sub.keys !== 'object' ||
    sub.keys === null
  ) {
    return NextResponse.json(
      { error: '缺少有效的 subscription（endpoint / keys）' },
      { status: 400 }
    );
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: user.id, endpoint: sub.endpoint, keys: sub.keys },
    { onConflict: 'endpoint' }
  );
  if (error) {
    return NextResponse.json(
      { error: `订阅保存失败：${error.message}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: { endpoint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  if (typeof body.endpoint !== 'string' || !body.endpoint) {
    return NextResponse.json({ error: '缺少 endpoint' }, { status: 400 });
  }

  // RLS 保证只能删自己的
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint);
  if (error) {
    return NextResponse.json(
      { error: `取消订阅失败：${error.message}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
