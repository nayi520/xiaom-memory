import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { tags as tagsTable } from '@/lib/db/schema';
import { enforceAiRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tags/delete —— 删除标签（V32 标签管理）。
 *
 * body: { tagId: string }
 *   删除标签本身；其 note_tags 关联经 note_tags.tag_id FK 的 ON DELETE CASCADE 自动清理
 *   （schema：note_tags.tagId references tags.id onDelete:'cascade'）。**记录本身不动**。
 *
 * 契约（200）：{ ok:true, tagId }。
 *   400 缺 tagId；401 未登录；404 标签不存在或非本人；429 限流。
 *
 * 鉴权 getCurrentUser()，授权严格按 tags.user_id 过滤（多租户：只能删本人标签）。
 * 删除语句自带 user_id 过滤；affected rows=0 视为不存在/非本人 → 404，避免越权探测。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const rl = enforceAiRateLimit(user.id, 'export');
  if (!rl.ok) {
    return NextResponse.json(
      { error: `操作过于频繁，请 ${rl.retryAfter}s 后再试` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  let body: { tagId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const tagId = typeof body.tagId === 'string' ? body.tagId.trim() : '';
  if (!tagId) {
    return NextResponse.json({ error: '缺少 tagId' }, { status: 400 });
  }

  const db = getDb();

  let deleted: { id: string }[] = [];
  try {
    // 删除即归属校验：带 user_id 过滤，returning 判定是否真的删到（他人/不存在 → 空）。
    deleted = await db
      .delete(tagsTable)
      .where(and(eq(tagsTable.id, tagId), eq(tagsTable.userId, user.id)))
      .returning({ id: tagsTable.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `删除失败：${msg}` }, { status: 500 });
  }

  if (deleted.length === 0) {
    return NextResponse.json({ error: '标签不存在' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, tagId });
}
