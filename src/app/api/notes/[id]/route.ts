import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * 记录的删除 / 恢复 / 永久删除（PRD F5 软删除回收站）
 *
 * PATCH /api/notes/[id]  body: { action: 'trash' | 'restore' }
 *   - trash：软删，set deleted_at = now()（默认删除动作，移入回收站，可恢复）
 *   - restore：恢复，set deleted_at = null
 *
 * DELETE /api/notes/[id]
 *   - 永久删除：硬删 notes 行本身。note_concepts / note_tags 经外键
 *     on delete cascade 自动清理关联。**派生的 concepts / cards 不删**——
 *     它们可能被其他 note 共享，且是知识库的原子单位，永久删除只清记录本身。
 *
 * 鉴权与 client 选择沿用现有 route：createClient()（带会话）+ RLS 按 user_id 隔离，
 * 故无需显式 .eq('user_id')，RLS 保证只能操作自己的记录。
 */

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const noteId = params.id;
  if (!noteId) {
    return NextResponse.json({ error: '缺少记录 id' }, { status: 400 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const action = body.action;
  if (action !== 'trash' && action !== 'restore') {
    return NextResponse.json(
      { error: "参数错误：action 需为 'trash' 或 'restore'" },
      { status: 400 }
    );
  }

  // RLS 保证只能取到自己的记录
  const { data: note } = await supabase
    .from('notes')
    .select('id')
    .eq('id', noteId)
    .maybeSingle();
  if (!note) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  const deletedAt = action === 'trash' ? new Date().toISOString() : null;
  const { error: updErr } = await supabase
    .from('notes')
    .update({ deleted_at: deletedAt })
    .eq('id', noteId);
  if (updErr) {
    return NextResponse.json(
      { error: `操作失败：${updErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, action, deleted_at: deletedAt });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const noteId = params.id;
  if (!noteId) {
    return NextResponse.json({ error: '缺少记录 id' }, { status: 400 });
  }

  // RLS 保证只能取到自己的记录
  const { data: note } = await supabase
    .from('notes')
    .select('id')
    .eq('id', noteId)
    .maybeSingle();
  if (!note) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  // 永久删除：硬删 note 行本身。
  // note_concepts / note_tags 外键 on delete cascade 自动清关联；
  // 派生的 concepts / cards 可能被其他记录共享，保留不删。
  const { error: delErr } = await supabase
    .from('notes')
    .delete()
    .eq('id', noteId);
  if (delErr) {
    return NextResponse.json(
      { error: `永久删除失败：${delErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, deleted: true });
}
