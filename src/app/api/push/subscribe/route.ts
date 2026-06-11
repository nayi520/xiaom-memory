import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { pushSubscriptions } from '@/lib/db/schema';

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
  const user = await getCurrentUser();
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

  // endpoint 唯一：冲突时更新 user_id / keys（换号或换密钥）。
  try {
    await getDb()
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: sub.endpoint,
        keys: sub.keys as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, keys: sub.keys as Record<string, unknown> },
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `订阅保存失败：${msg}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
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

  // 显式按 user_id 过滤：只能删自己的订阅（原靠 RLS）。
  try {
    await getDb()
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.userId, user.id)
        )
      );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `取消订阅失败：${msg}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
