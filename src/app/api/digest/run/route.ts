import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { createAnthropicClient } from '@/lib/llm';
import { embed } from '@/lib/embeddings';
import { runDigestForUser } from '@/features/digest/pipeline';
import { createDigestStore } from '@/features/digest/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/digest/run —— "立即整理"（仅当前登录用户）
 * 设置页手动触发，便于开发调试与白天即时整理。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 无 key 降级：明确报错，不崩溃（LLM 已切通义千问，校验 DASHSCOPE_API_KEY）
  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，AI 整理不可用' },
      { status: 503 }
    );
  }

  try {
    // store 内每条查询显式按 user_id 过滤（原 admin client 绕 RLS）。
    const result = await runDigestForUser(user.id, {
      store: createDigestStore(getDb()),
      llm: createAnthropicClient(),
      embed,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[digest/run] 流水线异常：', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
