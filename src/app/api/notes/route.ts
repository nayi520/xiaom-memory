import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import type { Note } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 记录列表 / 新建（去 Supabase 改造）—— 取代浏览器端 supabase.from('notes')。
 *
 * GET  /api/notes?limit=3   → 最近 N 条非软删记录（默认 3，上限 50）
 * POST /api/notes           → 新建文本/语音记录（body: { type, raw_content?, why_important?, media_path? }）
 *
 * 鉴权 getCurrentUser()，授权改应用层：显式按 user_id 过滤 / 落 user_id。
 */

const ALLOWED_TYPES = new Set(['text', 'voice', 'link', 'image']);

/** Drizzle 行（camelCase）→ 应用层 Note（snake_case，前端契约） */
function rowToNote(row: typeof notes.$inferSelect): Note {
  return {
    id: row.id,
    user_id: row.userId,
    type: row.type as Note['type'],
    raw_content: row.rawContent,
    transcript: row.transcript,
    url: row.url,
    media_path: row.mediaPath,
    why_important: row.whyImportant,
    status: row.status as Note['status'],
    summary: row.summary,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get('limit') ?? '3');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 50) : 3;

  const rows = await getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.userId, user.id), isNull(notes.deletedAt)))
    .orderBy(desc(notes.createdAt))
    .limit(limit);

  return NextResponse.json({ notes: rows.map(rowToNote) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: {
    type?: unknown;
    raw_content?: unknown;
    why_important?: unknown;
    media_path?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const type = typeof body.type === 'string' ? body.type : '';
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      { error: "参数错误：type 需为 'text' | 'voice' | 'link' | 'image'" },
      { status: 400 }
    );
  }
  const rawContent =
    typeof body.raw_content === 'string' ? body.raw_content : null;
  const whyImportant =
    typeof body.why_important === 'string' && body.why_important.trim()
      ? body.why_important.trim()
      : null;
  const mediaPath = typeof body.media_path === 'string' ? body.media_path : null;

  // L-1 加固：media_path 必须落在本人 OSS 前缀下，防被构造成他人对象 key（越权）。
  // 音频走 audio/{userId}/、图片（V13 图片捕获）走 images/{userId}/，二者均限本人。
  if (
    mediaPath &&
    !mediaPath.startsWith(`audio/${user.id}/`) &&
    !mediaPath.startsWith(`images/${user.id}/`)
  ) {
    return NextResponse.json({ error: 'media_path 非法' }, { status: 403 });
  }

  // 文本类要求有正文；语音/图片类要求有 media_path。
  if (type === 'text' && !rawContent?.trim()) {
    return NextResponse.json({ error: '文本内容不能为空' }, { status: 400 });
  }
  if (type === 'voice' && !mediaPath) {
    return NextResponse.json({ error: '语音记录缺少 media_path' }, { status: 400 });
  }
  if (type === 'image' && !mediaPath) {
    return NextResponse.json({ error: '图片记录缺少 media_path' }, { status: 400 });
  }

  try {
    const [row] = await getDb()
      .insert(notes)
      .values({
        userId: user.id,
        type,
        rawContent,
        whyImportant,
        mediaPath,
        status: 'inbox',
      })
      .returning();
    return NextResponse.json({ note: rowToNote(row) });
  } catch (err) {
    console.error('[notes] 新建失败：', err);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}
