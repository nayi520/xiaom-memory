import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notes/[id]/restore —— 从回收站恢复记录（JSON，供 iOS 原生回收站用）
 *
 * 契约：{ ok: true }
 *   - 恢复 = 把 deleted_at 置 null（记录重新出现在最近记录 / 知识库 / 搜索）。
 *   - 与 PATCH /api/notes/[id] { action:'restore' } 同语义，仅换成 iOS 友好的独立端点 + 极简契约。
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤——只能恢复自己的记录；
 * 不存在 / 非本人 → 404。
 */
export async function POST(
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

  // 显式按 user_id 过滤：只恢复自己的记录，returning 判断归属/存在。
  const updated = await getDb()
    .update(notes)
    .set({ deletedAt: null })
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .returning({ id: notes.id });
  if (updated.length === 0) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
