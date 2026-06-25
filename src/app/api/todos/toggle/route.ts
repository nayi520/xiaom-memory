import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes as notesTable, todoCompletions } from '@/lib/db/schema';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { todoItemKey } from '@/features/todos/parse';

export const dynamic = 'force-dynamic';

/**
 * 勾选 / 取消勾选某条行动项（V28）。
 *
 * POST /api/todos/toggle { noteId, itemKey, text, done }
 *   - done=true ：upsert todo_completions（(user_id, note_id, item_key) 唯一，重复幂等）。
 *   - done=false：删除该行（幂等：本就没有也回 ok）。
 *   - 校验该 note 属本人且未软删（他人/不存在 → 404）。
 *   - itemKey：以服务端按 text 归一化重算为准（防客户端伪造/口径漂移）；text 缺失时退回传入的 itemKey。
 *
 * 鉴权 getCurrentUser()；授权应用层（按 user.id + note 归属）。接轻量限流（按 userId）。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 轻量限流：复用通用 AI 端点档位中的 'clip'（每分钟较宽松），避免脚本狂刷写库。
  const rl = enforceAiRateLimit(user.id, 'clip');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  let body: { noteId?: unknown; itemKey?: unknown; text?: unknown; done?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const noteId = typeof body.noteId === 'string' ? body.noteId.trim() : '';
  if (!noteId) {
    return NextResponse.json({ error: '缺少 noteId' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  const providedKey = typeof body.itemKey === 'string' ? body.itemKey.trim() : '';
  // 优先用 text 重算 key（稳定、防伪）；text 为空时退回客户端传入的 itemKey。
  const itemKey = text.trim() ? todoItemKey(text) : providedKey;
  if (!itemKey) {
    return NextResponse.json({ error: '缺少 itemKey 或 text' }, { status: 400 });
  }

  const done =
    typeof body.done === 'boolean'
      ? body.done
      : body.done === 'true'
        ? true
        : body.done === 'false'
          ? false
          : null;
  if (done === null) {
    return NextResponse.json({ error: 'done 必须是布尔值' }, { status: 400 });
  }

  const db = getDb();

  // 校验记录归属（本人 + 未软删）。
  const owned = await db
    .select({ id: notesTable.id })
    .from(notesTable)
    .where(
      and(
        eq(notesTable.id, noteId),
        eq(notesTable.userId, user.id),
        // 软删记录不允许再改其待办状态（已不在行动项中心展示）。
        isNull(notesTable.deletedAt)
      )
    )
    .limit(1);
  if (!owned[0]) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  try {
    if (done) {
      // upsert：命中唯一键则保持（幂等）；done_at 不刷新，保留首次完成时间。
      await db
        .insert(todoCompletions)
        .values({ userId: user.id, noteId, itemKey })
        .onConflictDoNothing({
          target: [
            todoCompletions.userId,
            todoCompletions.noteId,
            todoCompletions.itemKey,
          ],
        });
    } else {
      await db
        .delete(todoCompletions)
        .where(
          and(
            eq(todoCompletions.userId, user.id),
            eq(todoCompletions.noteId, noteId),
            eq(todoCompletions.itemKey, itemKey)
          )
        );
    }
    return NextResponse.json({ ok: true, done, itemKey });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `保存失败：${msg}` }, { status: 500 });
  }
}
