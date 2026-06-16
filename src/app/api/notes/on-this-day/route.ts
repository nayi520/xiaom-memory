import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notes/on-this-day —— 历史上的今天（V15 知识库深化）
 *
 * 返回与今天「同月同日」的往期记录（往年/往月同一日历日），用于首页/知识库回顾。
 *   - 月日比对按北京时间（Asia/Shanghai），与用户主观「今天」一致；
 *   - 排除今天当天（即便去年/前年同月日有记录，今天产生的不算「历史」）；
 *   - 排除软删（deleted_at is null）。
 *
 * 契约：{ notes: [{ id, type, rawContent, summary, createdAt }] }（按时间倒序；无则空数组）。
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */

const TZ = 'Asia/Shanghai';
const MAX = 30;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const db = getDb();

  // 在北京时区下比对「月-日」：created_at 折算到 Asia/Shanghai 后取 MM-DD，
  // 与“今天（北京）”的 MM-DD 相等；且其北京日历日 < 今天（排除今天当天）。
  const rows = await db
    .select({
      id: notes.id,
      type: notes.type,
      rawContent: notes.rawContent,
      summary: notes.summary,
      createdAt: notes.createdAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, user.id),
        isNull(notes.deletedAt),
        sql`to_char(${notes.createdAt} AT TIME ZONE ${TZ}, 'MM-DD') = to_char(now() AT TIME ZONE ${TZ}, 'MM-DD')`,
        sql`(${notes.createdAt} AT TIME ZONE ${TZ})::date < (now() AT TIME ZONE ${TZ})::date`
      )
    )
    .orderBy(desc(notes.createdAt))
    .limit(MAX);

  const isoOf = (v: Date | string) =>
    v instanceof Date ? v.toISOString() : String(v);

  return NextResponse.json({
    notes: rows.map((r) => ({
      id: r.id,
      type: r.type,
      rawContent: r.rawContent,
      summary: r.summary,
      createdAt: isoOf(r.createdAt),
    })),
  });
}
