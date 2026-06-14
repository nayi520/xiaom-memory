import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getDueCount } from '@/features/review/queue';

export const dynamic = 'force-dynamic';

/**
 * GET /api/review/due-count —— 今日到期 active 卡数（JSON，给 iOS 角标）
 *
 * 契约：{ count: number }
 * 与既有 /api/review/due（返回 { due } 给 PWA 底部导航）同口径，但键名按 iOS 契约为 count。
 * 复用 features/review/queue.ts 的 getDueCount。鉴权 + 按当前 userId 过滤；未登录返回 count:0。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    // 未登录返回 0（角标不显示），与 /api/review/due 行为一致。
    return NextResponse.json({ count: 0 });
  }

  const count = await getDueCount(getDb(), user.id);
  return NextResponse.json({ count });
}
