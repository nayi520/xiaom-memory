import { NextResponse } from 'next/server';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import { MEETING_MIN_CHARS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notes/timeline —— 记录时间线（JSON，游标分页，供 /timeline 页与 iOS 原生端用）
 *
 * 查询参数：
 *   - limit：每页条数，默认 30，范围 1~50。
 *   - before：游标（上一页 nextCursor，ISO 时间）。仅取 created_at < before 的更早记录。
 *   - type：可选记录类型筛选。text/voice/link/image 按 notes.type 精确过滤；
 *           meeting = 长语音（type='voice' 且 char_length(trim(transcript)) ≥ MEETING_MIN_CHARS），
 *           用 SQL 表达、不取整段 transcript。空/未知值 = 不筛选（全部类型）。
 *
 * 契约：{
 *   notes: [{ id, type, rawContent, summary, createdAt, status, isMeeting }],  // 未删记录，按 createdAt 倒序
 *   nextCursor: string | null                                                  // 还有更多则为本页末条 createdAt，否则 null
 * }
 *   isMeeting：该语音转写是否达到会议阈值（由 SQL 判定，非语音恒为 false）；前端据此显示「会议」徽标。
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤；仅未软删记录（deleted_at is null）。
 * 游标用 created_at 的 ISO 串（timestamptz 微秒精度，个人库下不会撞点）。
 */

/** SQL 表达式：该记录是否为「会议」（语音且转写字数达阈值）。避免 SELECT 整段 transcript。 */
const isMeetingSql = sql<boolean>`(${notes.type} = 'voice' and char_length(coalesce(trim(${notes.transcript}), '')) >= ${MEETING_MIN_CHARS})`;

/** 记录类型筛选维度（与前端时间线筛选 chips 一致；meeting 为派生维度）。 */
const NOTE_TYPES = ['text', 'voice', 'link', 'image'] as const;
type NoteTypeFilter = (typeof NOTE_TYPES)[number] | 'meeting';
function normalizeTypeFilter(raw: string | null): NoteTypeFilter | null {
  if (raw === 'meeting') return 'meeting';
  return (NOTE_TYPES as readonly string[]).includes(raw ?? '')
    ? (raw as NoteTypeFilter)
    : null;
}

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

  // 类型筛选：meeting → type='voice' AND 转写字数 ≥ 阈值（SQL 表达）；其余按 notes.type 精确匹配。
  const typeFilter = normalizeTypeFilter(searchParams.get('type'));
  const typeWhere =
    typeFilter === 'meeting'
      ? and(eq(notes.type, 'voice'), gte(sql`char_length(coalesce(trim(${notes.transcript}), ''))`, MEETING_MIN_CHARS))
      : typeFilter
        ? eq(notes.type, typeFilter)
        : undefined;

  const where = and(
    eq(notes.userId, user.id),
    isNull(notes.deletedAt),
    typeWhere,
    before ? lt(notes.createdAt, before) : undefined
  );

  // 多取 1 条判断是否还有下一页。**不取整段 transcript**，只用 SQL 算出 isMeeting 布尔。
  const rows = await getDb()
    .select({
      id: notes.id,
      type: notes.type,
      rawContent: notes.rawContent,
      summary: notes.summary,
      createdAt: notes.createdAt,
      status: notes.status,
      isMeeting: isMeetingSql,
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
    // drizzle 把该 SQL 布尔列标注为 boolean（postgres.js 返回原生 true/false），显式收敛防 null。
    isMeeting: r.isMeeting === true,
  }));

  const nextCursor =
    hasMore && items.length > 0 ? items[items.length - 1].createdAt : null;

  return NextResponse.json({ notes: items, nextCursor });
}
