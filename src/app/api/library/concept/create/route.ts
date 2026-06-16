import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts } from '@/lib/db/schema';
import { embed, EmbeddingKeyMissingError } from '@/lib/embeddings';
import { consumeQuota } from '@/lib/quota';

export const dynamic = 'force-dynamic';

/**
 * POST /api/library/concept/create —— 手动新建概念（V15 知识库深化）
 *
 * body: { name, summary?, domain?, topic? }
 *   - name              ：必填，trim 后非空（concepts.name NOT NULL）。
 *   - summary/domain/topic：可选，trim 后空串视为 null。
 *
 * 可选生成 embedding：仅当已配 DASHSCOPE_API_KEY 且 name/summary 有内容时尝试，
 *   失败/未配 key 不阻塞建概念（embedding 留 null，后续可由流水线/再编辑补）。
 *   计 embedding 配额；超额则跳过向量化（仍建概念）。
 *
 * 契约：{ ok: true, concept: { id, name, summary, domain, topic } }。
 *   401 未登录；400 参数非法。
 *
 * 鉴权 getCurrentUser()，授权应用层——概念归属当前 user.id（与既有概念读写同口径）。
 * 与既有 POST /api/library/concept（用户修正）分路，互不影响。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { name?: unknown; summary?: unknown; domain?: unknown; topic?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: '概念名必须是非空字符串' }, { status: 400 });
  }
  const name = body.name.trim();

  const optional = (v: unknown, label: string): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new Error(`${label} 必须是字符串`);
    return v.trim() || null;
  };
  let summary: string | null;
  let domain: string | null;
  let topic: string | null;
  try {
    summary = optional(body.summary, 'summary');
    domain = optional(body.domain, 'domain');
    topic = optional(body.topic, 'topic');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '参数非法' },
      { status: 400 }
    );
  }

  // 可选生成 embedding（名 + 解释拼一段供向量化）；任何失败都不阻塞建概念。
  let embedding: number[] | null = null;
  const embedSource = [name, summary].filter(Boolean).join('：');
  if (embedSource && process.env.DASHSCOPE_API_KEY) {
    const quota = await consumeQuota(user.id, 'embedding');
    if (quota.ok) {
      try {
        embedding = await embed(embedSource);
      } catch (err) {
        if (!(err instanceof EmbeddingKeyMissingError)) {
          console.error(
            '[library] 手动建概念 embedding 失败（不阻塞）：',
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  }

  const db = getDb();
  try {
    const rows = await db
      .insert(concepts)
      .values({ userId: user.id, name, summary, domain, topic, embedding })
      .returning({
        id: concepts.id,
        name: concepts.name,
        summary: concepts.summary,
        domain: concepts.domain,
        topic: concepts.topic,
      });
    return NextResponse.json({ ok: true, concept: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `概念创建失败：${msg}` }, { status: 500 });
  }
}
