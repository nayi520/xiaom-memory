import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notes/timeline —— 记录时间线（JSON，游标分页，供 /timeline 页与 iOS 原生端用）
 *
 * 查询参数：
 *   - limit：每页条数，默认 30，范围 1~50。
 *   - before：游标（上一页 nextCursor，ISO 时间）。仅取 created_at < before 的更早记录。
 *
 * 契约：{
 *   notes: [{ id, type, rawContent, summary, createdAt, status }],  // 未删记录，按 createdAt 倒序
 *   nextCursor: string | null                                       // 还有更多则为本页末条 createdAt，否则 null
 * }
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤；仅未软删记录（deleted_at is null）。
 * 游标用 created_at 的 ISO 串（timestamptz 微秒精度，个人库下不会撞点）。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get('limit') ?? '30');
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, Math.trunc(limitRaw)), 50)
    : 30;

  // before 游标：解析为 Date，非法值忽略（视为首页）。
  const beforeRaw = searchParams.get('before');
  let before: Date | null = null;
  if (beforeRaw) {
    const parsed = new Date(beforeRaw);
    if (!Number.isNaN(parsed.getTime())) before = parsed;
  }

  const where = and(
    eq(notes.userId, user.id),
    isNull(notes.deletedAt),
    before ? lt(notes.createdAt, before) : undefined
  );

  // 多取 1 条判断是否还有下一页。
  const rows = await getDb()
    .select({
      id: notes.id,
      type: notes.type,
      rawContent: notes.rawContent,
      summary: notes.summary,
      createdAt: notes.createdAt,
      status: notes.status,
    })
    .from(notes)
    .where(where)
    .orderBy(desc(notes.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const isoOf = (v: Date | string) =>
    v instanceof Date ? v.toISOString() : String(v);

  const items = page.map((r) => ({
    id: r.id,
    type: r.type,
    rawContent: r.rawContent,
    summary: r.summary,
    createdAt: isoOf(r.createdAt),
    status: r.status,
  }));

  const nextCursor =
    hasMore && items.length > 0 ? items[items.length - 1].createdAt : null;

  return NextResponse.json({ notes: items, nextCursor });
}
