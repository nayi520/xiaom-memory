import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { runLlmCheck } from '@/lib/llm-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 自检会真打 chat ping + 一段 json 总结，单次几秒；给宽裕上限兜底慢供应商。
export const maxDuration = 60;

/**
 * GET /api/check-llm —— AI 供应商自检（登录态）
 *
 * 对**当前配置的 chat LLM 供应商**（env LLM_PROVIDER，默认 dashscope）实测两项：
 *   (a) chat ping：一句最简提示，返回 ok / 延迟 ms / 实际模型名 / 错误；
 *   (b) json 总结实测：用固定示例转写跑 P8 prompt（llm.json），返回 success + 示例摘要(+要点)。
 *
 * 用途：用户把文本 AI 切到智谱 GLM / Kimi(moonshot) 后，一键验证 provider/key 是否通 + 看示例总结判断质量。
 *
 * 返回契约：
 *   { provider, baseUrl, modelFast, modelStrong, jsonMode, apiKeyEnv, hasKey,
 *     ping:{ ok, ms, model, error? }, summary:{ ok, sample?, keyPoints?, error? } }
 *
 * 优雅降级：缺 key / 报错均**不崩**，由 runLlmCheck 把每项转成 { ok:false, error }（指明 provider 与原因）。
 * 成本/滥用闸：这是付费调用，按 userId 限流（check 档，默认 4 次/分）。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 付费调用：每次自检真打两次 LLM，按 userId 限流防被刷。
  const rl = enforceAiRateLimit(user.id, 'check');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  // runLlmCheck 内部各项已优雅降级、不抛；这里仍兜底以防意外，避免 500。
  try {
    const result = await runLlmCheck();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[check-llm] 自检异常：', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `自检失败：${message}` },
      { status: 500 }
    );
  }
}
