import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { createAnthropicClient } from '@/lib/llm';
import { createDigestStore } from '@/features/digest/store';
import { runWeeklyDigestForUser } from '@/features/digest/weekly';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/digest/run-weekly —— 生成本周知识周报（仅当前登录用户，手动触发）
 *
 * 取本周（ISO 周，周一起，Asia/Shanghai）的每日简报 + 新概念/关联 → P5 汇总 → 存 digests(type='weekly')。
 * 契约：{ ok: boolean, period: string }。本周无沉淀时 ok=false（未生成）。
 * 降级：缺 DASHSCOPE_API_KEY → 503 { error }，不崩溃。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，AI 周报不可用' },
      { status: 503 }
    );
  }

  try {
    const result = await runWeeklyDigestForUser(user.id, {
      store: createDigestStore(getDb()),
      llm: createAnthropicClient(),
    });
    return NextResponse.json({ ok: result.generated, period: result.period });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[digest/run-weekly] 周报生成异常：', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
