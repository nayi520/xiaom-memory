import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getTodoLists } from '@/features/todos/store';

export const dynamic = 'force-dynamic';

/**
 * 行动项中心聚合（V28）。
 *
 * GET /api/todos → { open: TodoItem[], done: TodoItem[] }
 *   每项 { noteId, noteType, noteTitle, text, itemKey, createdAt }。
 *   待办文本实时解析自 note.raw_content；完成态 = 源 `- [x]` 或命中 todo_completions。
 *   严格按 user.id 过滤、排除 deleted_at。鉴权 getCurrentUser()，授权应用层。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  try {
    const lists = await getTodoLists(getDb(), user.id);
    return NextResponse.json(lists);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `读取行动项失败：${msg}` }, { status: 500 });
  }
}
