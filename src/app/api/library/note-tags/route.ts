import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { corrections, notes, noteTags, tags } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/note-tags?noteId=...  —— 读某记录的当前标签（V13 捕获后就地编辑用）
 *
 * 供「最近记录」就地标签编辑预加载当前标签，避免整体替换时误清空已有标签。
 * 鉴权 getCurrentUser()，授权改应用层——显式按 user_id 过滤确认记录归属。
 * 返回 { tags: string[] }。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const noteId = searchParams.get('noteId');
  if (!noteId) {
    return NextResponse.json({ error: '缺少 noteId' }, { status: 400 });
  }

  const db = getDb();
  // 确认记录归属当前用户（他人记录视为不存在）。
  const noteRows = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .limit(1);
  if (noteRows.length === 0) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  const tagRows = await db
    .select({ name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(eq(noteTags.noteId, noteId));

  return NextResponse.json({ tags: tagRows.map((r) => r.name).filter(Boolean) });
}

/**
 * POST /api/library/note-tags —— 用户修正记录标签
 * body: { noteId, tags: string[] }
 * 整体替换 note_tags 关联，差异写一条 corrections
 * （target_type='note', field='tags', old/new 为标签数组）。
 *
 * 去 Supabase 改造：鉴权 getCurrentUser()，授权改应用层——
 * notes / tags 读写显式按 user_id 过滤（原靠 RLS）。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { noteId?: unknown; tags?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const noteId = typeof body.noteId === 'string' ? body.noteId : null;
  if (!noteId || !Array.isArray(body.tags)) {
    return NextResponse.json(
      { error: '参数错误：需要 noteId 与 tags(string[])' },
      { status: 400 }
    );
  }
  const nextTags = Array.from(
    new Set(
      body.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20)
    )
  );

  const db = getDb();

  // 显式按 user_id 过滤：确认记录归属当前用户。
  const noteRows = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .limit(1);
  if (noteRows.length === 0) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  // 当前标签（经 tags join 取名称）
  let oldTags: string[] = [];
  try {
    const currentRows = await db
      .select({ name: tags.name })
      .from(noteTags)
      .innerJoin(tags, eq(tags.id, noteTags.tagId))
      .where(eq(noteTags.noteId, noteId));
    oldTags = currentRows.map((r) => r.name).filter(Boolean);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `读取当前标签失败：${msg}` },
      { status: 500 }
    );
  }

  const same =
    oldTags.length === nextTags.length &&
    [...oldTags].sort().join(' ') === [...nextTags].sort().join(' ');
  if (same) {
    return NextResponse.json({ ok: true, changed: false, tags: nextTags });
  }

  // 1) upsert 新标签（user_id+name 唯一），拿到 id
  let tagIds: string[] = [];
  if (nextTags.length > 0) {
    try {
      const tagRows = await db
        .insert(tags)
        .values(nextTags.map((name) => ({ userId: user.id, name })))
        .onConflictDoUpdate({
          target: [tags.userId, tags.name],
          set: { name: sql`excluded.name` },
        })
        .returning({ id: tags.id });
      tagIds = tagRows.map((t) => t.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `标签写入失败：${msg}` },
        { status: 500 }
      );
    }
  }

  // 2) 整体替换 note_tags
  try {
    await db.delete(noteTags).where(eq(noteTags.noteId, noteId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `旧标签关联清除失败：${msg}` },
      { status: 500 }
    );
  }
  if (tagIds.length > 0) {
    try {
      await db
        .insert(noteTags)
        .values(tagIds.map((tagId) => ({ noteId, tagId })))
        .onConflictDoNothing();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `标签关联失败：${msg}` },
        { status: 500 }
      );
    }
  }

  // 3) 写修正记录（回填后续提示词）。old/new 为标签数组（jsonb）。
  try {
    await db.insert(corrections).values({
      userId: user.id,
      targetType: 'note',
      targetId: noteId,
      field: 'tags',
      oldValue: oldTags,
      newValue: nextTags,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `已保存，但修正日志写入失败：${msg}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, changed: true, tags: nextTags });
}
