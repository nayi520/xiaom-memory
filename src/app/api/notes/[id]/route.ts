import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

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
 * 去 Supabase 改造：鉴权改 getCurrentUser()，授权改应用层——
 * 所有 notes 操作显式按 user_id 过滤（原靠 RLS 保证只能操作自己的记录）。
 */

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
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

  const db = getDb();
  const deletedAt = action === 'trash' ? new Date() : null;
  // 显式按 user_id 过滤：只更新自己的记录，returning 用于判断是否存在。
  const updated = await db
    .update(notes)
    .set({ deletedAt })
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .returning({ id: notes.id });
  if (updated.length === 0) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    action,
    deleted_at: deletedAt ? deletedAt.toISOString() : null,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const noteId = params.id;
  if (!noteId) {
    return NextResponse.json({ error: '缺少记录 id' }, { status: 400 });
  }

  const db = getDb();
  // 永久删除：硬删 note 行本身（显式按 user_id 过滤）。
  // note_concepts / note_tags 外键 on delete cascade 自动清关联；
  // 派生的 concepts / cards 可能被其他记录共享，保留不删。
  const deleted = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .returning({ id: notes.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: true });
}
