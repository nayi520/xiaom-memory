import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { createAnthropicClient } from '@/lib/llm';
import { embed } from '@/lib/embeddings';
import { runDigestForAllUsers } from '@/features/digest/pipeline';
import { createDigestStore } from '@/features/digest/store';

export const dynamic = 'force-dynamic';
// LLM 批处理较慢，尽量给足时长（Vercel 按套餐上限截断）
export const maxDuration = 300;

/**
 * POST /api/cron/digest —— AI 每日整理流水线（全部用户）
 * 鉴权：Authorization: Bearer ${CRON_SECRET}
 * Vercel Cron 以 GET 调用且自动带同样的 Bearer 头，故 GET/POST 同逻辑。
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '服务端未配置 CRON_SECRET' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '鉴权失败' }, { status: 401 });
  }

  // 无 key 降级：明确报错，不崩溃（LLM 已切通义千问，校验 DASHSCOPE_API_KEY）
  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，AI 整理不可用' },
      { status: 503 }
    );
  }

  try {
    // cron 原用 admin client 绕 RLS；现直接用 db，store 内每条查询显式按 user_id 过滤。
    const results = await runDigestForAllUsers({
      store: createDigestStore(getDb()),
      llm: createAnthropicClient(),
      embed,
    });
    return NextResponse.json({ ok: true, users: results.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/digest] 流水线异常：', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
