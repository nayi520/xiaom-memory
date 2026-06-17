import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { cards, concepts, noteConcepts, notes } from '@/lib/db/schema';
import { createAnthropicClient } from '@/lib/llm';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { consumeQuota } from '@/lib/quota';
import { initialFsrsState } from '@/features/digest/pipeline';
import {
  GLOBAL_SYSTEM,
  buildGenCardsPrompt,
  type GenCardsResult,
} from '@/features/digest/prompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/generate-cards —— 概念 AI 出题（V16 AI 增强）
 *
 * body: { conceptId: string, count?: number(默认 3，范围 1~10) }
 *   - conceptId：必填，须为本人概念（经 user_id 校验，他人/不存在 → 404）。
 *   - count    ：期望生成卡片数，缺省 3，钳制到 [1,10]。
 *
 * 流程：鉴权 → 概念归属校验 → 取概念 summary + 关联记录摘录 → qwen（haiku/qwen-plus）出 N 道 Q/A
 *      → 复用 V15 建卡逻辑批量落库（initialFsrsState 明天 + status active）→ 返回新建卡片。
 *
 * 契约：{ ok: true, created: number, cards: [{ id, conceptId, question, answer }] }
 *   401 未登录；404 概念不存在或非本人；400 参数非法；429 限流/配额；503 缺 key；500 其它。
 *
 * 成本/滥用闸：先突发限流（gen，分钟级），再每日配额（kind 'gen'，既有 usage_counters，无迁移）。
 * 鉴权 getCurrentUser()，授权应用层——卡片归属经 concept→user_id 校验。
 */

/** 关联记录摘录：取关联且未软删的最近若干条，每条截断，拼成行。 */
const NOTES_FOR_GEN = 6;
const NOTE_SNIPPET_MAX = 200;
const DEFAULT_COUNT = 3;
const MAX_COUNT = 10;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { conceptId?: unknown; count?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const conceptId = typeof body.conceptId === 'string' ? body.conceptId : null;
  if (!conceptId) {
    return NextResponse.json({ error: '缺少 conceptId' }, { status: 400 });
  }
  // count 钳制到 [1, MAX_COUNT]，非法/缺省回退默认。
  let count = DEFAULT_COUNT;
  if (body.count !== undefined) {
    const n = Number(body.count);
    if (Number.isFinite(n)) count = Math.min(MAX_COUNT, Math.max(1, Math.trunc(n)));
  }

  const db = getDb();

  // 概念归属校验 + 取 summary（显式按 user_id 过滤，确保只能给自己的概念出题）。
  const conceptRows = await db
    .select({ id: concepts.id, name: concepts.name, summary: concepts.summary })
    .from(concepts)
    .where(and(eq(concepts.id, conceptId), eq(concepts.userId, user.id)))
    .limit(1);
  const concept = conceptRows[0];
  if (!concept) {
    return NextResponse.json({ error: '概念不存在' }, { status: 404 });
  }

  // 缺 key 降级：LLM 走 DASHSCOPE_API_KEY，先于产生成本明确报 503。
  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，AI 出题暂不可用' },
      { status: 503 }
    );
  }

  // 成本/滥用闸：先突发限流（短窗口高频），再每日配额。两道都过才产生 AI 成本。
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

  // 取关联且未软删的最近记录，做摘录（让题目更贴合用户语境）。
  const noteRows = await db
    .select({
      summary: notes.summary,
      rawContent: notes.rawContent,
      transcript: notes.transcript,
    })
    .from(noteConcepts)
    .innerJoin(notes, eq(notes.id, noteConcepts.noteId))
    .where(and(eq(noteConcepts.conceptId, concept.id), isNull(notes.deletedAt)))
    .orderBy(desc(notes.createdAt))
    .limit(NOTES_FOR_GEN);

  const notesExcerpt =
    noteRows
      .map((n) => (n.summary || n.rawContent || n.transcript || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((t) => `- ${t.length > NOTE_SNIPPET_MAX ? `${t.slice(0, NOTE_SNIPPET_MAX)}…` : t}`)
      .join('\n') || '（暂无相关记录）';

  try {
    const llm = createAnthropicClient();
    const result = await llm.json<GenCardsResult>(
      buildGenCardsPrompt({
        concept_name: concept.name,
        concept_explanation: concept.summary ?? '（暂无解释）',
        notes_excerpt: notesExcerpt,
        count: String(count),
      }),
      { model: 'haiku', task: 'GEN_CARDS', system: GLOBAL_SYSTEM }
    );

    // 过滤非法卡片（问/答非空）、限到 count 张、trim。
    const valid = (result.cards ?? [])
      .filter(
        (c) =>
          c &&
          typeof c.question === 'string' &&
          typeof c.answer === 'string' &&
          c.question.trim().length > 0 &&
          c.answer.trim().length > 0
      )
      .slice(0, count)
      .map((c) => ({ question: c.question.trim(), answer: c.answer.trim() }));

    if (valid.length === 0) {
      // LLM 没能产出有效卡片：不落库，返回 created:0（前端提示可重试）。
      return NextResponse.json({ ok: true, created: 0, cards: [] });
    }

    // 复用 V15 建卡口径：新卡到期日明天、status active；首次评分后 ts-fsrs 接管补全字段。
    const tomorrow = new Date();
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const fsrsState = initialFsrsState(tomorrow.toISOString());

    const inserted = await db
      .insert(cards)
      .values(
        valid.map((c) => ({
          conceptId: concept.id,
          question: c.question,
          answer: c.answer,
          fsrsState,
          status: 'active' as const,
        }))
      )
      .returning({
        id: cards.id,
        conceptId: cards.conceptId,
        question: cards.question,
        answer: cards.answer,
      });

    return NextResponse.json({ ok: true, created: inserted.length, cards: inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[generate-cards] AI 出题失败：', err);
    return NextResponse.json({ error: `AI 出题失败：${msg}` }, { status: 500 });
  }
}
