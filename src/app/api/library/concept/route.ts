import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/library/concept —— 用户修正概念（名称 / 解释 / 领域 / 主题）
 * body: { conceptId, name, explanation, domain, topic }
 * 每个变更字段写一条 corrections（target_type='concept'，old/new jsonb），
 * 阶段 2 流水线会取最近 5 条修正回填 P1 提示词。
 * 注：解释对应 concepts.summary 列，corrections.field 记为 'explanation'（与 P1 输出语义一致）。
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  // RLS 保证只能取到自己的概念
  const { data: current, error: getErr } = await supabase
    .from('concepts')
    .select('id, name, summary, domain, topic')
    .eq('id', conceptId)
    .maybeSingle();
  if (getErr || !current) {
    return NextResponse.json({ error: '概念不存在' }, { status: 404 });
  }

  // 字段映射：corrections.field（语义名）→ concepts 列
  const changes: { field: string; column: string; oldValue: string | null; newValue: string | null }[] = [];
  const compare = (field: string, column: string, oldVal: string | null, newVal: string) => {
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

  // 1) 更新概念
  const patch: Record<string, string | null> = {};
  for (const c of changes) patch[c.column] = c.newValue;
  const { error: updErr } = await supabase
    .from('concepts')
    .update(patch)
    .eq('id', conceptId);
  if (updErr) {
    return NextResponse.json(
      { error: `概念更新失败：${updErr.message}` },
      { status: 500 }
    );
  }

  // 2) 写修正记录（用于回填后续提示词）
  const { error: corrErr } = await supabase.from('corrections').insert(
    changes.map((c) => ({
      user_id: user.id,
      target_type: 'concept',
      target_id: conceptId,
      field: c.field,
      // jsonb 列：直接传值（字符串/ null），PostgREST 自动按 JSON 存
      old_value: c.oldValue,
      new_value: c.newValue,
    }))
  );
  if (corrErr) {
    // 修正日志失败不回滚业务更新，但要明确告知
    return NextResponse.json(
      { error: `已保存，但修正日志写入失败：${corrErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, changed: changes.length });
}
