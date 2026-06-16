import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts, corrections } from '@/lib/db/schema';
import { getConceptDetail } from '@/features/library/concept-detail';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/concept/{id} —— 概念详情（JSON，供 iOS 原生端用）
 *
 * 契约：{ concept: {id,title,summary}, notes: [{id,rawContent,type,createdAt}],
 *        links: [{conceptId,title}], tags: [string],
 *        backlinks: { concepts: [{conceptId,title}], notes: [{id,title,type,createdAt}] } }
 *   - concept.summary = concepts.summary（解释，可能为 null）
 *   - notes：关联且未软删的原始记录，按 createdAt 倒序；rawContent 可能为 null（语音/链接类记录）
 *   - links：关联概念（仅含对端仍存在的本人概念）
 *   - tags：来自关联记录的标签（去重）
 *   - backlinks（V15，向后兼容新增）：引用本概念的概念（= links，concept_links 双向）
 *     与记录（= notes，note_concepts→notes，title 取正文截断）。
 *
 * 复用 features/library/concept-detail.ts（与概念详情页同口径）。
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤；不存在/非本人 → 404。
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const detail = await getConceptDetail(getDb(), user.id, params.id);
  if (!detail) {
    return NextResponse.json({ error: '概念不存在' }, { status: 404 });
  }

  return NextResponse.json(detail);
}

/**
 * PATCH /api/library/concept/{id} —— 编辑/重命名概念（V8 概念管理）
 *
 * body: { name?, summary?, domain?, topic? }（至少一个；均为字符串）
 *   - name   ：若提供，trim 后须非空（concepts.name 为 NOT NULL）。
 *   - summary/domain/topic：trim 后空串视为置空（写 null）。
 *   - 仅写实际发生变化的列；同时为每个变更字段写一条 corrections（回填后续提示词，
 *     与既有 POST /api/library/concept 同口径：summary 的 corrections.field 记为 'explanation'）。
 *
 * 契约：{ ok: true, concept }（concept = 更新后的 {id,name,summary,domain,topic}）。
 *   401 未登录；404 概念不存在或非本人；400 参数非法 / 无可改字段。
 *
 * 鉴权 getCurrentUser()，授权严格按 concepts.user_id 过滤（只能改自己的概念）。
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const conceptId = params.id;
  if (!conceptId) {
    return NextResponse.json({ error: '缺少概念 id' }, { status: 400 });
  }

  let body: { name?: unknown; summary?: unknown; domain?: unknown; topic?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  // 字段解析：未提供（undefined）的字段不参与变更；提供的须是字符串。
  // name 单独处理（trim 后非空校验）；summary/domain/topic 空串 → null。
  type Col = 'name' | 'summary' | 'domain' | 'topic';
  const FIELD_OF: Record<Col, string> = {
    name: 'name',
    summary: 'explanation', // 与既有 corrections 口径一致（解释列对应 field='explanation'）
    domain: 'domain',
    topic: 'topic',
  };
  const provided: Partial<Record<Col, string | null>> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: '概念名必须是非空字符串' }, { status: 400 });
    }
    provided.name = body.name.trim();
  }
  for (const col of ['summary', 'domain', 'topic'] as const) {
    const v = body[col];
    if (v !== undefined) {
      if (typeof v !== 'string') {
        return NextResponse.json({ error: `${col} 必须是字符串` }, { status: 400 });
      }
      provided[col] = v.trim() || null;
    }
  }

  if (Object.keys(provided).length === 0) {
    return NextResponse.json(
      { error: '参数错误：需要 name / summary / domain / topic 中的至少一项' },
      { status: 400 }
    );
  }

  const db = getDb();

  // 归属校验 + 取当前值（用于 diff 与 corrections.old_value），显式按 user_id 过滤。
  const currentRows = await db
    .select({
      id: concepts.id,
      name: concepts.name,
      summary: concepts.summary,
      domain: concepts.domain,
      topic: concepts.topic,
    })
    .from(concepts)
    .where(and(eq(concepts.id, conceptId), eq(concepts.userId, user.id)))
    .limit(1);
  const current = currentRows[0];
  if (!current) {
    return NextResponse.json({ error: '概念不存在' }, { status: 404 });
  }

  // 仅保留真正发生变化的列。
  const changes: { col: Col; oldValue: string | null; newValue: string | null }[] = [];
  for (const col of Object.keys(provided) as Col[]) {
    const next = provided[col] ?? null;
    const prev = current[col] ?? null;
    if (next !== prev) changes.push({ col, oldValue: prev, newValue: next });
  }

  if (changes.length === 0) {
    // 无实际变化：返回当前概念（幂等，便于前端统一处理）。
    return NextResponse.json({ ok: true, concept: current });
  }

  // 更新概念 + 写修正日志，用事务保证一致（任一失败整体回滚）。
  try {
    await db.transaction(async (tx) => {
      const patch: Partial<typeof concepts.$inferInsert> = {};
      for (const c of changes) {
        if (c.col === 'name') {
          // name NOT NULL：仅在 newValue 非空时进入 changes，此处必为 string。
          if (c.newValue !== null) patch.name = c.newValue;
        } else {
          patch[c.col] = c.newValue;
        }
      }
      await tx
        .update(concepts)
        .set(patch)
        .where(and(eq(concepts.id, conceptId), eq(concepts.userId, user.id)));

      await tx.insert(corrections).values(
        changes.map((c) => ({
          userId: user.id,
          targetType: 'concept',
          targetId: conceptId,
          field: FIELD_OF[c.col],
          oldValue: c.oldValue,
          newValue: c.newValue,
        }))
      );
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `概念更新失败：${msg}` }, { status: 500 });
  }

  // 回读更新后的概念返回（契约 concept 形状）。
  const after = await db
    .select({
      id: concepts.id,
      name: concepts.name,
      summary: concepts.summary,
      domain: concepts.domain,
      topic: concepts.topic,
    })
    .from(concepts)
    .where(eq(concepts.id, conceptId))
    .limit(1);

  return NextResponse.json({ ok: true, concept: after[0] ?? null });
}
