import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { createAnthropicClient } from '@/lib/llm';
import { embed } from '@/lib/embeddings';
import { runDigestForAllUsers } from '@/features/digest/pipeline';
import { createDigestStore } from '@/features/digest/store';
import { sendDigestEmails } from '@/features/digest/email';

export const dynamic = 'force-dynamic';
// LLM 批处理较慢，尽量给足时长（Vercel 按套餐上限截断）
export const maxDuration = 300;

/**
 * POST /api/cron/digest —— AI 每日整理流水线（全部用户）+ 摘要邮件（V17）
 * 鉴权：Authorization: Bearer ${CRON_SECRET}
 * Vercel Cron 以 GET 调用且自动带同样的 Bearer 头，故 GET/POST 同逻辑。
 *
 * 流程：先跑 runDigestForAllUsers（生成当日 daily 摘要等），再 sendDigestEmails——
 * 据 profiles.settings.digestEmail（'daily'|'weekly'）给到对应摘要的用户用 DirectMail 发邮件
 * （复用既有 digests 内容，不重复调 LLM）。DirectMail 未配置则整体跳过、不影响整理。
 * 邮件步骤异常被捕获、不让 cron 失败（整理已成功落库）。
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
    const db = getDb();
    // cron 原用 admin client 绕 RLS；现直接用 db，store 内每条查询显式按 user_id 过滤。
    const results = await runDigestForAllUsers({
      store: createDigestStore(db),
      llm: createAnthropicClient(),
      embed,
    });

    // 摘要邮件（V17）：整理完成后按开关发送。内部已对「DirectMail 未配置 / 单用户失败」优雅降级；
    // 再包一层 try，确保即使邮件环节异常也不让整理结果丢失（cron 仍视为成功）。
    let email;
    try {
      email = await sendDigestEmails(db);
    } catch (mailErr) {
      const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
      console.error('[cron/digest] 摘要邮件异常：', mailErr);
      email = { error: msg };
    }

    return NextResponse.json({ ok: true, users: results.length, results, email });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/digest] 流水线异常：', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
