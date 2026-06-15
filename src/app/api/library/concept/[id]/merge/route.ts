import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * POST /api/library/concept/{id}/merge —— 合并概念（V8 概念管理）
 *
 * body: { targetId }
 *   把源概念 {id} 的全部关联迁移到目标概念 {targetId}，随后删除源概念：
 *     - cards.concept_id          ：id → target（cards 有独立主键，直接 UPDATE）。
 *     - note_concepts(noteId,conceptId)：插入 (noteId, target) 去重后删源（PK 冲突走 ON CONFLICT DO NOTHING）。
 *     - concept_links(a,b)        ：两端任一指向 id 的边改指向 target，跳过自链接(a==b)与重复(PK)，再删源边。
 *   全程单事务，任一步失败整体回滚，保证一致。
 *
 * 契约：{ ok: true, concept }（concept = 目标概念 {id,name,summary,domain,topic}）。
 *   401 未登录；400 参数非法（缺 targetId / 与 id 相同）；404 源或目标概念不存在或非本人。
 *
 * 鉴权 getCurrentUser()，授权严格按 concepts.user_id 过滤——源与目标都必须归属当前用户。
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const sourceId = params.id;
  if (!sourceId) {
    return NextResponse.json({ error: '缺少概念 id' }, { status: 400 });
  }

  let body: { targetId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId) {
    return NextResponse.json({ error: '缺少 targetId' }, { status: 400 });
  }
  if (targetId === sourceId) {
    return NextResponse.json({ error: '不能把概念合并到自己' }, { status: 400 });
  }

  const db = getDb();

  // 归属校验：源与目标都必须存在且归属当前用户（显式按 user_id 过滤）。
  const owned = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.userId, user.id), inArray(concepts.id, [sourceId, targetId])));
  const ownedIds = new Set(owned.map((r) => r.id));
  if (!ownedIds.has(sourceId)) {
    return NextResponse.json({ error: '源概念不存在' }, { status: 404 });
  }
  if (!ownedIds.has(targetId)) {
    return NextResponse.json({ error: '目标概念不存在' }, { status: 404 });
  }

  // 迁移关联 + 删除源概念，单事务保证一致。
  try {
    await db.transaction(async (tx) => {
      // 1) cards：直接改指向目标（cards 有独立主键，无 PK 冲突）。
      await tx.execute(sql`
        update cards set concept_id = ${targetId} where concept_id = ${sourceId}
      `);

      // 2) note_concepts：插入 (note_id, target) 去重，再删源行（避免 PK 冲突）。
      await tx.execute(sql`
        insert into note_concepts (note_id, concept_id)
        select note_id, ${targetId} from note_concepts where concept_id = ${sourceId}
        on conflict do nothing
      `);
      await tx.execute(sql`
        delete from note_concepts where concept_id = ${sourceId}
      `);

      // 3) concept_links：两端任一指向源的边改指向目标。
      //    - 跳过会变成自链接的边（另一端已是目标）；
      //    - ON CONFLICT DO NOTHING 去重已存在的边（PK = (concept_a, concept_b)）；
      //    - 最后删除所有仍触及源的边。
      await tx.execute(sql`
        insert into concept_links (concept_a, concept_b, relation_type, reason)
        select ${targetId}, concept_b, relation_type, reason
        from concept_links where concept_a = ${sourceId} and concept_b <> ${targetId}
        on conflict do nothing
      `);
      await tx.execute(sql`
        insert into concept_links (concept_a, concept_b, relation_type, reason)
        select concept_a, ${targetId}, relation_type, reason
        from concept_links where concept_b = ${sourceId} and concept_a <> ${targetId}
        on conflict do nothing
      `);
      await tx.execute(sql`
        delete from concept_links where concept_a = ${sourceId} or concept_b = ${sourceId}
      `);

      // 4) 删除源概念（再次按 user_id 过滤）。
      //    其余指向源的外键（如残留关联）均已迁移/清理。
      await tx
        .delete(concepts)
        .where(and(eq(concepts.id, sourceId), eq(concepts.userId, user.id)));
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `概念合并失败：${msg}` }, { status: 500 });
  }

  // 回读目标概念返回（契约 concept 形状）。
  const after = await db
    .select({
      id: concepts.id,
      name: concepts.name,
      summary: concepts.summary,
      domain: concepts.domain,
      topic: concepts.topic,
    })
    .from(concepts)
    .where(eq(concepts.id, targetId))
    .limit(1);

  return NextResponse.json({ ok: true, concept: after[0] ?? null });
}
