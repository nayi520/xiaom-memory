import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { createAnthropicClient } from '@/lib/llm';
import { embed } from '@/lib/embeddings';
import { runDigestForUser } from '@/features/digest/pipeline';
import { createDigestStore } from '@/features/digest/store';
import { consumeQuota } from '@/lib/quota';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/digest/run —— "立即整理"（仅当前登录用户）
 * 设置页手动触发，便于开发调试与白天即时整理。
 *
 * 范围：scope='all' —— 整理该用户【全部】待整理（inbox）记录，含往日积压
 * （不只当天），让用户可一键补整理被搁置的旧记录。日报 period 仍按今天。
 *
 * 成本注意：'all' 一次可能整理很多条，每个概念都会触发 embedding + 多次 LLM 调用。
 * 仍由下方 embedding 每日配额闸保护（计"整理一次"为一次额度）；积压很大时
 * 单次整理耗时/成本相应上升，maxDuration=300 给足时长。
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

  // 成本/滥用闸：手动「立即整理」会对每个概念调 embedding + 多次 LLM，是 embedding 的主成本面。
  // 按 userId 记 embedding 每日配额（计「整理一次」为一次额度），超额回 429 友好降级，不跑流水线。
  const quota = await consumeQuota(user.id, 'embedding');
  if (!quota.ok) {
    return NextResponse.json(
      { error: '今日额度已用尽', kind: 'embedding', limit: quota.limit },
      { status: 429 }
    );
  }

  try {
    // store 内每条查询显式按 user_id 过滤（原 admin client 绕 RLS）。
    const result = await runDigestForUser(user.id, {
      store: createDigestStore(getDb()),
      llm: createAnthropicClient(),
      embed,
      scope: 'all', // 整理全部待整理记录（含往日积压），不只当天
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[digest/run] 流水线异常：', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
