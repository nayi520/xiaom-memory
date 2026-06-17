/**
 * 标签清单查询（V16）—— 复用于 JSON API（GET /api/library/tags）与服务端页面。
 *
 * 取某用户的全部标签（tags 表，user_id 过滤），附「关联记录数」count：
 *   count = 经 note_tags 关联、且记录未软删（notes.deleted_at is null）的去重笔记数。
 * 授权严格按 tags.user_id 显式过滤；按 count 降序、再按名称（zh-CN）排序，便于做 chips。
 *
 * 数据访问走 Drizzle（与 library/tree、concept-detail 同口径），不改 db 底层封装。
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  tags as tagsTable,
  noteTags,
  notes as notesTable,
} from '@/lib/db/schema';

export interface TagWithCount {
  id: string;
  name: string;
  /** 关联且未软删的去重记录数（可能为 0）。 */
  count: number;
}

/**
 * 取某用户的全部标签（带关联记录数）。
 * 左连接 note_tags→notes（排除软删），按标签聚合计数；空库返回 []。
 */
export async function listTagsWithCount(
  db: Database,
  userId: string
): Promise<TagWithCount[]> {
  const rows = await db
    .select({
      id: tagsTable.id,
      name: tagsTable.name,
      // 去重计数未软删的关联记录；左连接下无关联记录时 count 为 0。
      count: sql<number>`count(distinct ${notesTable.id})`,
    })
    .from(tagsTable)
    .leftJoin(noteTags, eq(noteTags.tagId, tagsTable.id))
    .leftJoin(
      notesTable,
      and(eq(notesTable.id, noteTags.noteId), isNull(notesTable.deletedAt))
    )
    .where(eq(tagsTable.userId, userId))
    .groupBy(tagsTable.id, tagsTable.name);

  return rows
    .map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }))
    .filter((t) => t.name?.trim())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}
