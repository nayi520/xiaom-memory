import { NextResponse } from 'next/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/trash —— 回收站记录列表（JSON，供 iOS 原生回收站用）
 *
 * 契约：{ notes: [{ id, type, rawContent, summary, deletedAt }] }（camelCase）
 *   - 仅软删记录（deleted_at 非空），按删除时间倒序。
 *   - 与服务端 /trash 页同口径（features/trash 逻辑），仅返回 JSON 而非 HTML。
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤——只会看到自己的记录。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const rows = await getDb()
    .select({
      id: notes.id,
      type: notes.type,
      rawContent: notes.rawContent,
      summary: notes.summary,
      deletedAt: notes.deletedAt,
    })
    .from(notes)
    .where(and(eq(notes.userId, user.id), isNotNull(notes.deletedAt)))
    .orderBy(desc(notes.deletedAt));

  return NextResponse.json({
    notes: rows.map((r) => ({
      id: r.id,
      type: r.type,
      rawContent: r.rawContent,
      summary: r.summary,
      deletedAt:
        r.deletedAt instanceof Date
          ? r.deletedAt.toISOString()
          : String(r.deletedAt),
    })),
  });
}
