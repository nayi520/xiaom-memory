import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { createAnthropicClient } from '@/lib/llm';
import { embed, EmbeddingKeyMissingError } from '@/lib/embeddings';
import {
  answerQuestion,
  answerQuestionStream,
  type AskTurn,
} from '@/features/ask';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/ask —— 知识库 RAG 问答（P6，仅当前登录用户）
 *
 * body: { question: string, history?: [{role,content}], stream?: boolean }
 * 流程：鉴权 → embed(question) → pgvector 召回当前 userId 概念 top-K（严格过滤）
 *      → 基于检索上下文用 qwen 作答（注明来源、检索不到就说不知道、禁止编造）。
 *
 * 两种输出（V9）：
 *  - **非流式（默认，向后兼容）**：返回 JSON，既有字段不变
 *    `{ answer, sources:[{n,conceptId,title,snippet}], suggestions:[...] }`
 *    （n / suggestions 为新增字段，旧客户端忽略即可；answer/sources.conceptId/title/snippet 不变）。
 *  - **流式（opt-in）**：body `{stream:true}` 或 `?stream=1` 或 `Accept: text/event-stream` 触发。
 *    SSE：每行 `data: <json>`，`json.type ∈ sources|token|suggestions|done|error`。
 *    先发 sources，再逐 token 透传 qwen 流式答案，（如有）suggestions，最后 done。
 *
 * 降级：缺 DASHSCOPE_API_KEY → 503 { error }（embedding 与 LLM 同 key），不崩溃。
 *      流式途中错误 → SSE 末帧 `{type:'error',message}`。
 */

/** 判断本次是否走流式：body.stream / ?stream=1 / Accept: text/event-stream 任一即可。 */
function wantsStream(request: Request, bodyStream: unknown): boolean {
  if (bodyStream === true) return true;
  const url = new URL(request.url);
  const q = url.searchParams.get('stream');
  if (q === '1' || q === 'true') return true;
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/event-stream');
}

/** 解析 history：仅取 role∈user|assistant 且 content 为字符串的项（深度截断在 feature 层 clampHistory）。 */
function parseHistory(raw: unknown): AskTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const turns = raw.filter(
    (t): t is AskTurn =>
      !!t &&
      typeof t === 'object' &&
      ((t as { role?: unknown }).role === 'user' ||
        (t as { role?: unknown }).role === 'assistant') &&
      typeof (t as { content?: unknown }).content === 'string'
  );
  return turns.length > 0 ? turns : undefined;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // 防 Nginx / 反代缓冲，确保 token 实时下发。
  'X-Accel-Buffering': 'no',
} as const;

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
      ? (body as { question: string }).question.trim()
      : '';
  if (!question) {
    return NextResponse.json({ error: '请输入问题' }, { status: 400 });
  }

  const history = parseHistory((body as { history?: unknown })?.history);
  const stream = wantsStream(request, (body as { stream?: unknown })?.stream);

  // 缺 key 降级：embedding 与 LLM 同走 DASHSCOPE_API_KEY，先于检索/作答明确报 503。
  // 流式与非流式都先以 503 JSON 返回（流式尚未开帧，回 JSON 错误对客户端更友好）。
  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，问答暂不可用' },
      { status: 503 }
    );
  }

  // ---------- 流式（opt-in） ----------
  if (stream) {
    const encoder = new TextEncoder();
    const send = (
      controller: ReadableStreamDefaultController,
      obj: unknown
    ) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

    const sse = new ReadableStream({
      async start(controller) {
        try {
          const questionEmbedding = await embed(question);
          const gen = answerQuestionStream(user.id, question, {
            db: getDb(),
            llm: createAnthropicClient(),
            questionEmbedding,
            history,
          });
          for await (const evt of gen) {
            send(controller, evt);
          }
        } catch (err) {
          const message =
            err instanceof EmbeddingKeyMissingError
              ? '未配置 DASHSCOPE_API_KEY，问答暂不可用'
              : err instanceof Error
                ? err.message
                : String(err);
          console.error('[ask] 流式问答失败：', err);
          // 已开帧，无法改 HTTP 状态码 → 以 error 事件告知客户端。
          send(controller, { type: 'error', message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(sse, { headers: SSE_HEADERS });
  }

  // ---------- 非流式（默认，向后兼容） ----------
  try {
    const questionEmbedding = await embed(question);
    const result = await answerQuestion(user.id, question, {
      db: getDb(),
      llm: createAnthropicClient(),
      questionEmbedding,
      history,
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
