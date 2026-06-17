import { NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts } from '@/lib/db/schema';
import { createAnthropicClient } from '@/lib/llm';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { consumeQuota } from '@/lib/quota';
import { GLOBAL_SYSTEM, buildStudyGuidePrompt } from '@/features/digest/prompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/study-guide —— 学习指南 / 领域总结（V16 AI 增强）
 *
 * body（二选一，至少其一）：
 *   - { domain: string }       ：对该领域下本人全部概念生成学习指南。
 *   - { conceptIds: string[] } ：对指定的一组本人概念生成学习指南（最多 50 个）。
 *   两者都给时以 conceptIds 为准。
 *
 * 流程：鉴权 → 取范围内本人概念（name + summary，严格 user_id 过滤）
 *      → qwen（haiku/qwen-plus）生成结构化 Markdown 学习指南 → 返回。
 *
 * 契约：{ ok: true, markdown: string }
 *   401 未登录；400 参数非法 / 范围为空；404 范围内无本人概念；429 限流/配额；503 缺 key；500 其它。
 *
 * 成本/滥用闸：先突发限流（gen，分钟级），再每日配额（kind 'gen'，复用 usage_counters，无迁移）。
 * 鉴权 getCurrentUser()，授权应用层——概念集严格按 user_id 过滤。
 */

/** 拼进提示词的概念上限（控成本/防超长）。 */
const MAX_CONCEPTS = 50;
/** 单概念解释截断字数。 */
const EXPLANATION_MAX = 220;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { domain?: unknown; conceptIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const domain =
    typeof body.domain === 'string' && body.domain.trim() ? body.domain.trim() : null;
  const conceptIds = Array.isArray(body.conceptIds)
    ? body.conceptIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];

  if (!domain && conceptIds.length === 0) {
    return NextResponse.json(
      { error: '请提供 domain 或 conceptIds（至少其一）' },
      { status: 400 }
    );
  }

  const db = getDb();

  // 取范围内本人概念（显式按 user_id 过滤；conceptIds 优先于 domain）。
  const rows = await db
    .select({ name: concepts.name, summary: concepts.summary })
    .from(concepts)
    .where(
      conceptIds.length > 0
        ? and(eq(concepts.userId, user.id), inArray(concepts.id, conceptIds.slice(0, MAX_CONCEPTS)))
        : and(eq(concepts.userId, user.id), eq(concepts.domain, domain as string))
    )
    .orderBy(asc(concepts.createdAt))
    .limit(MAX_CONCEPTS);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: '该范围内还没有概念，先记录并整理一些内容再来生成' },
      { status: 404 }
    );
  }

  // 缺 key 降级：LLM 走 DASHSCOPE_API_KEY，先于产生成本明确报 503。
  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，学习指南暂不可用' },
      { status: 503 }
    );
  }

  // 成本/滥用闸：先突发限流，再每日配额。两道都过才产生 AI 成本。
  const rl = enforceAiRateLimit(user.id, 'gen');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }
  const quota = await consumeQuota(user.id, 'gen');
  if (!quota.ok) {
    return NextResponse.json(
      { error: '今日 AI 生成额度已用尽', kind: 'gen', limit: quota.limit },
      { status: 429 }
    );
  }

  const scopeLabel =
    conceptIds.length > 0 ? `选定的 ${rows.length} 个概念` : `领域：${domain}`;
  const conceptsBlock = rows
    .map((c) => {
      const exp = (c.summary ?? '').replace(/\s+/g, ' ').trim() || '（暂无解释）';
      const clipped = exp.length > EXPLANATION_MAX ? `${exp.slice(0, EXPLANATION_MAX)}…` : exp;
      return `- ${c.name}：${clipped}`;
    })
    .join('\n');

  try {
    const llm = createAnthropicClient();
    const markdown = await llm.text(
      buildStudyGuidePrompt({ scope_label: scopeLabel, concepts_block: conceptsBlock }),
      { model: 'haiku', task: 'STUDY_GUIDE', system: GLOBAL_SYSTEM }
    );
    return NextResponse.json({ ok: true, markdown: markdown.trim() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[study-guide] 学习指南生成失败：', err);
    return NextResponse.json({ error: `学习指南生成失败：${msg}` }, { status: 500 });
  }
}
