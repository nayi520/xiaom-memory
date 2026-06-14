import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { createAnthropicClient } from '@/lib/llm';
import { embed, EmbeddingKeyMissingError } from '@/lib/embeddings';
import { answerQuestion } from '@/features/ask';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/ask —— 知识库 RAG 问答（P6，仅当前登录用户）
 *
 * body: { question: string }
 * 流程：鉴权 → embed(question) → pgvector 召回当前 userId 概念 top-K（严格过滤）
 *      → 基于检索上下文用 sonnet 作答（注明来源、检索不到就说不知道、禁止编造）。
 * 契约：{ answer: string, sources: [{ conceptId, title, snippet }] }（camelCase）。
 * 降级：缺 DASHSCOPE_API_KEY → 503 { error }（embedding 与 LLM 同 key），不崩溃。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const question =
    typeof (body as { question?: unknown })?.question === 'string'
      ? ((body as { question: string }).question).trim()
      : '';
  if (!question) {
    return NextResponse.json({ error: '请输入问题' }, { status: 400 });
  }

  // 缺 key 降级：embedding 与 LLM 同走 DASHSCOPE_API_KEY，先于检索/作答明确报 503。
  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，问答暂不可用' },
      { status: 503 }
    );
  }

  try {
    const questionEmbedding = await embed(question);
    const result = await answerQuestion(user.id, question, {
      db: getDb(),
      llm: createAnthropicClient(),
      questionEmbedding,
    });
    return NextResponse.json(result);
  } catch (err) {
    // embedding key 在运行期才发现缺失（理论上前面已拦）→ 同样 503 优雅降级
    if (err instanceof EmbeddingKeyMissingError) {
      return NextResponse.json(
        { error: '未配置 DASHSCOPE_API_KEY，问答暂不可用' },
        { status: 503 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ask] 问答失败：', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
