import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * 记录的删除 / 恢复 / 永久删除（PRD F5 软删除回收站）+ 捕获后快速编辑（V13）
 *
 * PATCH /api/notes/[id]
 *   软删/恢复（带 action）：body: { action: 'trash' | 'restore' }
 *     - trash：软删，set deleted_at = now()（默认删除动作，移入回收站，可恢复）
 *     - restore：恢复，set deleted_at = null
 *   就地编辑（无 action，V13 捕获后快速编辑）：body 含 raw_content? / why_important?
 *     - 更新正文 raw_content 与/或 why_important（最近捕获列表里就地改）。
 *     - 至少要给一个可编辑字段，否则 400。返回更新后的 note。
 *
 * DELETE /api/notes/[id]
 *   - 永久删除：硬删 notes 行本身。note_concepts / note_tags 经外键
 *     on delete cascade 自动清理关联。**派生的 concepts / cards 不删**——
 *     它们可能被其他 note 共享，且是知识库的原子单位，永久删除只清记录本身。
 *
 * 去 Supabase 改造：鉴权改 getCurrentUser()，授权改应用层——
 * 所有 notes 操作显式按 user_id 过滤（原靠 RLS 保证只能操作自己的记录）。
 */

/** Drizzle 行（camelCase）→ 应用层 Note（snake_case，与 /api/notes 列表契约一致） */
function rowToNote(row: typeof notes.$inferSelect) {
  return {
    id: row.id,
    user_id: row.userId,
    type: row.type,
    raw_content: row.rawContent,
    transcript: row.transcript,
    url: row.url,
    media_path: row.mediaPath,
    why_important: row.whyImportant,
    status: row.status,
    summary: row.summary,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

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

  let body: { action?: unknown; raw_content?: unknown; why_important?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const action = body.action;

  const db = getDb();

  // —— 分支一：软删 / 恢复（带 action）——
  if (action === 'trash' || action === 'restore') {
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

  // —— 分支二：捕获后快速编辑（无 action）——
  if (action !== undefined) {
    return NextResponse.json(
      { error: "参数错误：action 需为 'trash' 或 'restore'" },
      { status: 400 }
    );
  }

  // 收集可编辑字段：raw_content（正文）/ why_important（为什么重要）。
  const patch: { rawContent?: string; whyImportant?: string | null } = {};
  if (typeof body.raw_content === 'string') {
    const text = body.raw_content.trim();
    if (!text) {
      return NextResponse.json({ error: '正文不能为空' }, { status: 400 });
    }
    patch.rawContent = text;
  }
  if (typeof body.why_important === 'string') {
    // 允许清空（传空串 → null）。
    const why = body.why_important.trim();
    patch.whyImportant = why ? why : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: '参数错误：编辑需提供 raw_content 或 why_important' },
      { status: 400 }
    );
  }

  // 仅未软删的本人记录可编辑（回收站里的不改）。
  const updated = await db
    .update(notes)
    .set(patch)
    .where(
      and(
        eq(notes.id, noteId),
        eq(notes.userId, user.id),
        isNull(notes.deletedAt)
      )
    )
    .returning();
  if (updated.length === 0) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, note: rowToNote(updated[0]) });
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
