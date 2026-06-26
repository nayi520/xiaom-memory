/**
 * 标签合并的数据库事务原语（V32 标签管理）—— 服务端用，供 merge / rename-合并 复用。
 *
 * 把「把若干源标签的 note_tags 重指到目标、去重、删源标签」收敛到一个事务函数，
 * 保证一致（任一步失败整体回滚，无悬挂 note_tags、无残留源标签）。
 *
 * 去重要点（note_tags 主键 (note_id, tag_id)）：
 *   重指 insert ... select 时若目标标签已挂同一记录，会撞主键 → 用 ON CONFLICT DO NOTHING 跳过；
 *   随后删除源标签，其残留的 (note_id, source) 行经 note_tags.tag_id FK 的 ON DELETE CASCADE 自动清理。
 *
 * 归属：调用方**必须先校验**目标与所有源标签都归属当前用户（按 tags.user_id），本函数只做迁移+删除。
 * 这里删除源标签时仍带 user_id 二次过滤，纵深防御。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * 在一个事务内：把 sourceIds 的 note_tags 全部重指到 targetId、去重、删除这些源标签。
 *
 * @param db        Drizzle 实例（getDb()）。
 * @param userId    当前用户 id（删除源标签时二次过滤）。
 * @param targetId  目标标签 id（保留）。
 * @param sourceIds 要并入并删除的源标签 id（已由调用方去重、剔除目标自身、校验归属）。
 */
export async function mergeTagsTx(
  db: Database,
  userId: string,
  targetId: string,
  sourceIds: readonly string[]
): Promise<void> {
  if (sourceIds.length === 0) return;

  // 显式 ::uuid 转型（与 recommend 路由同口径），避免 PG 在 in (...) 字面量上无法推断类型。
  const sourceList = sql`(${sql.join(
    sourceIds.map((id) => sql`${id}::uuid`),
    sql`, `
  )})`;

  await db.transaction(async (tx) => {
    // 1) 把所有源标签挂着的记录重指到目标标签；目标已挂同一记录则跳过（去重，避免 PK 冲突）。
    await tx.execute(sql`
      insert into note_tags (note_id, tag_id)
      select distinct nt.note_id, ${targetId}::uuid
      from note_tags nt
      where nt.tag_id in ${sourceList}
      on conflict do nothing
    `);

    // 2) 删除源标签（带 user_id 二次过滤）。其残留的 note_tags 行经 FK ON DELETE CASCADE 自动清理。
    await tx.execute(sql`
      delete from tags
      where user_id = ${userId}::uuid
        and id in ${sourceList}
    `);
  });
}
