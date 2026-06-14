import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { createDigestStore } from '@/features/digest/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/digest/weekly —— 返回当前用户最新一篇周报（无则 null）
 *
 * 契约：{ digest: { period, content } | null }（camelCase）。
 * 纯读取，不调用 LLM，无 DASHSCOPE 依赖。鉴权 getCurrentUser，严格按 userId 过滤。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const store = createDigestStore(getDb());
  const digest = await store.getLatestWeeklyDigest(user.id);
  return NextResponse.json({ digest });
}
