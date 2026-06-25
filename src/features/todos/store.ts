/**
 * 行动项中心取数（V28）——按 user_id 严格过滤、排除 deleted_at，加载候选记录 + 完成态。
 *
 * 与纯聚合（index.ts buildTodoLists）分层：本文件只负责 DB 查询（注入式 Database），
 * 取数后交给纯函数合成 { open, done }。授权走应用层（无 RLS），全部显式 user_id 过滤。
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { notes as notesTable, todoCompletions } from '@/lib/db/schema';
import { buildTodoLists, type TodoLists } from './index';

/**
 * 取某用户的行动项聚合 { open, done }。
 *
 * - 候选记录：本人、未软删（deleted_at is null）、raw_content 含任务标记（`- [`，含 *\+ 列表符）。
 *   用 LIKE 预筛缩小集合（避免扫全量），真正的语法判定在纯解析层做。
 * - 完成态：本人在 todo_completions 的全部行（命中 (note_id,item_key) 即视为已完成）。
 * - 记录按 createdAt 倒序传入聚合层（新记录的待办在前）。
 */
export async function getTodoLists(db: Database, userId: string): Promise<TodoLists> {
  const [noteRows, completionRows] = await Promise.all([
    db
      .select({
        id: notesTable.id,
        type: notesTable.type,
        rawContent: notesTable.rawContent,
        summary: notesTable.summary,
        createdAt: notesTable.createdAt,
      })
      .from(notesTable)
      .where(
        and(
          eq(notesTable.userId, userId),
          isNull(notesTable.deletedAt),
          // 预筛：任务清单标记形如「<符号> [ ]」，正文必含「[ 」之类——用 '%- [%' 等价子串。
          // 实义判定（- [ ] / * [x] / 缩进等）在 parseTodos 完成，这里只为减少扫描量。
          sql`${notesTable.rawContent} like '%[ ]%' or ${notesTable.rawContent} like '%[x]%' or ${notesTable.rawContent} like '%[X]%'`
        )
      )
      .orderBy(desc(notesTable.createdAt)),
    db
      .select({
        noteId: todoCompletions.noteId,
        itemKey: todoCompletions.itemKey,
      })
      .from(todoCompletions)
      .where(eq(todoCompletions.userId, userId)),
  ]);

  const completedKeys = new Set<string>(
    completionRows.map((r) => `${r.noteId}:${r.itemKey}`)
  );

  return buildTodoLists(noteRows, completedKeys);
}
