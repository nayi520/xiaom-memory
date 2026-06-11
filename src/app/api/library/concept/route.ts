import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts, corrections } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * POST /api/library/concept —— 用户修正概念（名称 / 解释 / 领域 / 主题）
 * body: { conceptId, name, explanation, domain, topic }
 * 每个变更字段写一条 corrections（target_type='concept'，old/new jsonb），
 * 阶段 2 流水线会取最近 5 条修正回填 P1 提示词。
 * 注：解释对应 concepts.summary 列，corrections.field 记为 'explanation'（与 P1 输出语义一致）。
 *
 * 去 Supabase 改造：鉴权 getCurrentUser()，授权改应用层——
 * concepts 读/写显式按 user_id 过滤（原靠 RLS）。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const conceptId = typeof body.conceptId === 'string' ? body.conceptId : null;
  if (!conceptId) {
    return NextResponse.json({ error: '缺少 conceptId' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: '概念名不能为空' }, { status: 400 });
  }
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
  const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';

  const db = getDb();

  // 显式按 user_id 过滤：只能取/改自己的概念。
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

  // 字段映射：corrections.field（语义名）→ concepts 列
  const changes: { field: string; column: 'name' | 'summary' | 'domain' | 'topic'; oldValue: string | null; newValue: string | null }[] = [];
  const compare = (
    field: string,
    column: 'name' | 'summary' | 'domain' | 'topic',
    oldVal: string | null,
    newVal: string
  ) => {
    const next = newVal || null;
    if ((oldVal ?? null) !== next) {
      changes.push({ field, column, oldValue: oldVal ?? null, newValue: next });
    }
  };
  compare('name', 'name', current.name, name);
  compare('explanation', 'summary', current.summary, explanation);
  compare('domain', 'domain', current.domain, domain);
  compare('topic', 'topic', current.topic, topic);

  if (changes.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  // 1) 更新概念（再次按 user_id 过滤）
  const patch: Partial<typeof concepts.$inferInsert> = {};
  for (const c of changes) {
    // name 为 notNull（仅在 newValue 非空时进入 changes），summary/domain/topic 可空。
    if (c.column === 'name') {
      if (c.newValue !== null) patch.name = c.newValue;
    } else {
      patch[c.column] = c.newValue;
    }
  }
  try {
    await db
      .update(concepts)
      .set(patch)
      .where(and(eq(concepts.id, conceptId), eq(concepts.userId, user.id)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `概念更新失败：${msg}` },
      { status: 500 }
    );
  }

  // 2) 写修正记录（用于回填后续提示词）。old/new 为 jsonb 列，直接传字符串/null。
  try {
    await db.insert(corrections).values(
      changes.map((c) => ({
        userId: user.id,
        targetType: 'concept',
        targetId: conceptId,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
      }))
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 修正日志失败不回滚业务更新，但要明确告知
    return NextResponse.json(
      { error: `已保存，但修正日志写入失败：${msg}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, changed: changes.length });
}
