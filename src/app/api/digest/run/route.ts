import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createAnthropicClient } from '@/lib/llm';
import { embed } from '@/lib/embeddings';
import { runDigestForUser } from '@/features/digest/pipeline';
import { createSupabaseDigestStore } from '@/features/digest/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/digest/run —— "立即整理"（仅当前登录用户）
 * 设置页手动触发，便于开发调试与白天即时整理。
 */
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 无 key 降级：明确报错，不崩溃
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: '未配置 ANTHROPIC_API_KEY，AI 整理不可用' },
      { status: 503 }
    );
  }

  try {
    const admin = createAdminClient();
    const result = await runDigestForUser(user.id, {
      store: createSupabaseDigestStore(admin),
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
