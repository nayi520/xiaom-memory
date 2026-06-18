import { NextResponse } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * POST /api/trash/empty —— 清空回收站（V21 数据管理 & 掌控感）
 *
 * 契约（与 iOS 对齐）：{ ok: true, deleted: int }（deleted = 本次永久删除的条数）
 *
 * 把当前用户回收站里**全部**已软删记录（deleted_at 非空）一次性硬删。
 *   - **严格归属 + 仅对已软删生效**：where 同时限定 user_id 与 deleted_at 非空，
 *     绝不会动到他人记录，也绝不会动到活动记录（未在回收站的记录受保护）。
 *   - 级联：note_concepts / note_tags 经外键 on delete cascade 自动清关联；
 *     派生的 concepts / cards 可能被其他记录共享，保留不删。
 *   - OSS 媒体对象（media_path）暂留，待后续统一清理（与单条永久删除一致）。
 *   - 不可恢复：强二次确认在前端 UI 完成（文案明确「不可恢复」）。
 *
 * 鉴权 getCurrentUser()；授权应用层显式按 user.id 过滤。
 * 用 POST（带副作用、非幂等语义上更贴切；与契约一致）。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const deleted = await getDb()
      .delete(notes)
      .where(and(eq(notes.userId, user.id), isNotNull(notes.deletedAt)))
      .returning({ id: notes.id });
    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (err) {
    console.error('[trash/empty] 清空失败：', err);
    return NextResponse.json({ error: '清空回收站失败' }, { status: 500 });
  }
}
